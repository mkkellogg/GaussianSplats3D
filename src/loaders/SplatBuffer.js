import * as THREE from 'three';

/**
 * SplatBuffer: Container for splat data from a single scene/file and capable of (mediocre) compression.
 */
export class SplatBuffer {

    static CenterComponentCount = 3;
    static ScaleComponentCount = 3;
    static RotationComponentCount = 4;
    static ColorComponentCount = 4;

    static CompressionLevels = {
        0: {
            BytesPerCenter: 12,
            BytesPerScale: 12,
            BytesPerColor: 4,
            BytesPerRotation: 16,
            ScaleRange: 1
        },
        1: {
            BytesPerCenter: 6,
            BytesPerScale: 6,
            BytesPerColor: 4,
            BytesPerRotation: 8,
            ScaleRange: 32767
        }
    };

    static CovarianceSizeFloats = 6;
    static CovarianceSizeBytes = 24;

    static HeaderSizeBytes = 4096;
    static SectionHeaderSizeBytes = 1024;

    static BucketDescriptorSizeBytes = 12;
    static BucketDescriptorSizeFloats = 3;

    constructor(bufferData) {
        this.globalSplatIndexToLocalSplatIndexMap = {};
        this.globalSplatIndexToSectionMap = {};

        this.headerBufferData = new ArrayBuffer(SplatBuffer.HeaderSizeBytes);
        this.headerArrayUint8 = new Uint8Array(this.headerBufferData, 0, SplatBuffer.HeaderSizeBytes);
        this.headerArrayUint16 = new Uint16Array(this.headerBufferData, 0, SplatBuffer.HeaderSizeBytes / 2);
        this.headerArrayUint32 = new Uint32Array(this.headerBufferData, 0, SplatBuffer.HeaderSizeBytes / 4);
        this.headerArrayFloat32 = new Float32Array(this.headerBufferData, 0, SplatBuffer.HeaderSizeBytes / 4);
        new Uint8Array(this.headerBufferData, 0, SplatBuffer.HeaderSizeBytes).set(new Uint8Array(bufferData, 0, SplatBuffer.HeaderSizeBytes));
        this.versionMajor = this.headerArrayUint8[0];
        this.versionMinor = this.headerArrayUint8[1];
        this.headerExtraK = this.headerArrayUint8[2];
        this.sectionCount = this.headerArrayUint8[3];
        this.splatCount = this.headerArrayUint32[1];
        this.compressionLevel = this.headerArrayUint16[4];

        this.bytesPerCenter = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerCenter;
        this.bytesPerScale = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerScale;
        this.bytesPerColor = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerColor;
        this.bytesPerRotation = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerRotation;
        this.bytesPerSplat = this.bytesPerCenter + this.bytesPerScale + this.bytesPerColor + this.bytesPerRotation;

        this.sectionHeaderBufferData = new ArrayBuffer(this.sectionCount * SplatBuffer.SectionHeaderSizeBytes);
        this.sectionHeaderArrayUint8 = new Uint8Array(this.sectionHeaderBufferData, 0, this.sectionCount * SplatBuffer.SectionHeaderSizeBytes);
        this.sectionHeaderArrayUint16 = new Uint16Array(this.sectionHeaderBufferData, 0, this.sectionCount * SplatBuffer.SectionHeaderSizeBytes / 2);
        this.sectionHeaderArrayUint32 = new Uint32Array(this.sectionHeaderBufferData, 0, this.sectionCount * SplatBuffer.SectionHeaderSizeBytes / 4);
        this.sectionHeaderArrayFloat32 = new Float32Array(this.sectionHeaderBufferData, 0, this.sectionCount * SplatBuffer.SectionHeaderSizeBytes / 4);
        new Uint8Array(this.sectionHeaderBufferData, 0, this.sectionCount * SplatBuffer.SectionHeaderSizeBytes)
            .set(new Uint8Array(bufferData, SplatBuffer.HeaderSizeBytes, this.sectionCount * SplatBuffer.SectionHeaderSizeBytes));
        this.sections = [];
        let sectionHeaderBase8 = 0;
        let sectionHeaderBase16 = sectionHeaderBase8 / 2;
        let sectionHeaderBase32 = sectionHeaderBase8 / 4;
        let sectionBase8 = 0;
        let splatCountOffset = 0;
        for (let i = 0; i < this.sectionCount; i++) {
            const splatCount = this.sectionHeaderArrayUint32[sectionHeaderBase32];
            const bucketSize = this.sectionHeaderArrayUint32[sectionHeaderBase32 + 1];
            const bucketCount = this.sectionHeaderArrayUint32[sectionHeaderBase32 + 2];
            const bucketBlockSize = this.sectionHeaderArrayFloat32[sectionHeaderBase32 + 3];
            const halfBucketBlockSize = bucketBlockSize / 2.0;
            const bytesPerBucket = this.sectionHeaderArrayUint16[sectionHeaderBase16 + 8];
            const compressionScaleRange = this.sectionHeaderArrayUint32[sectionHeaderBase32 + 5] ||
                                          SplatBuffer.CompressionLevels[this.compressionLevel].ScaleRange;
            const splatDataSizeBytes = this.bytesPerSplat * splatCount;
            const section = {
                splatCountOffset: splatCountOffset,
                splatCount: splatCount,
                bucketSize: bucketSize,
                bucketCount: bucketCount,
                bucketBlockSize: bucketBlockSize,
                halfBucketBlockSize: halfBucketBlockSize,
                bytesPerBucket: bytesPerBucket,
                compressionScaleRange: compressionScaleRange,
                compressionScaleFactor: halfBucketBlockSize / compressionScaleRange,
                base: sectionBase8,
                bucketsBase: sectionBase8 + splatDataSizeBytes,
                centerArray: null,
                scaleArray: null,
                colorArray: null,
                rotationArray: null
            };
            this.sections[i] = section;
            sectionBase8 += splatDataSizeBytes + section.bytesPerBucket * section.bucketCount;
            sectionHeaderBase8 += SplatBuffer.SectionHeaderSizeBytes;
            sectionHeaderBase16 = sectionHeaderBase8 / 2;
            sectionHeaderBase32 = sectionHeaderBase8 / 4;
            splatCountOffset += splatCount;
        }

        const allheadersSizeBytes = SplatBuffer.HeaderSizeBytes + (this.sectionCount * SplatBuffer.SectionHeaderSizeBytes);
        const dataBufferSizeBytes = bufferData.byteLength - allheadersSizeBytes;
        this.splatBufferData = new ArrayBuffer(dataBufferSizeBytes);
        new Uint8Array(this.splatBufferData).set(new Uint8Array(bufferData, allheadersSizeBytes, dataBufferSizeBytes));

        this.linkBufferArrays();
        this.buildMaps();
    }

    linkBufferArrays() {
        let sectionBase = 0;
        for (let i = 0; i < this.sectionCount; i++) {
            const section = this.sections[i];
            let FloatArray = (this.compressionLevel === 0) ? Float32Array : Uint16Array;
            section.centerArray = new FloatArray(this.splatBufferData, sectionBase, section.splatCount * SplatBuffer.CenterComponentCount);
            section.scaleArray = new FloatArray(this.splatBufferData, sectionBase + this.bytesPerCenter * section.splatCount,
                                                section.splatCount * SplatBuffer.ScaleComponentCount);
            section.colorArray = new Uint8Array(this.splatBufferData,
                                                sectionBase + (this.bytesPerCenter + this.bytesPerScale) * section.splatCount,
                                                section.splatCount * SplatBuffer.ColorComponentCount);
            section.rotationArray = new FloatArray(this.splatBufferData,
                                                  sectionBase + (this.bytesPerCenter + this.bytesPerScale + this.bytesPerColor) *
                                                  section.splatCount, section.splatCount * SplatBuffer.RotationComponentCount);
            sectionBase += this.bytesPerSplat * section.splatCount + SplatBuffer.BucketDescriptorSizeBytes * section.bucketCount;
        }
    }

    buildMaps() {
        let cumulativeSplatCount = 0;
        for (let i = 0; i < this.sectionCount; i++) {
            const section = this.sections[i];
            for (let j = 0; j < section.splatCount; j++) {
                const globalSplatIndex = cumulativeSplatCount + j;
                this.globalSplatIndexToLocalSplatIndexMap[globalSplatIndex] = j;
                this.globalSplatIndexToSectionMap[globalSplatIndex] = i;
            }
            cumulativeSplatCount += section.splatCount;
        }
    }

    fbf(f) {
        if (this.compressionLevel === 0) {
            return f;
        } else {
            return THREE.DataUtils.fromHalfFloat(f);
        }
    };

    getHeaderBufferData() {
        return this.headerBufferData;
    }

    getSectionHeaderBufferData() {
        return this.sectionHeaderBufferData;
    }

    getSplatBufferData() {
        return this.splatBufferData;
    }

    getSplatCount() {
        return this.splatCount;
    }

    getSplatCenter(globalSplatIndex, outCenter, transform) {
        const sectionIndex = this.globalSplatIndexToSectionMap[globalSplatIndex];
        const section = this.sections[sectionIndex];
        const localSplatIndex = globalSplatIndex - section.splatCountOffset;
        const centerBase = localSplatIndex * SplatBuffer.CenterComponentCount;
        if (this.compressionLevel > 0) {
            const sf = section.compressionScaleFactor;
            const sr = section.compressionScaleRange;
            const bucketIndex = Math.floor(localSplatIndex / section.bucketSize);
            const bucketCenter = new Float32Array(this.splatBufferData, section.bucketsBase + bucketIndex * section.bytesPerBucket,
                                                  section.bytesPerBucket / 4);
            outCenter.x = (section.centerArray[centerBase] - sr) * sf + bucketCenter[0];
            outCenter.y = (section.centerArray[centerBase + 1] - sr) * sf + bucketCenter[1];
            outCenter.z = (section.centerArray[centerBase + 2] - sr) * sf + bucketCenter[2];
        } else {
            outCenter.x = section.centerArray[centerBase];
            outCenter.y = section.centerArray[centerBase + 1];
            outCenter.z = section.centerArray[centerBase + 2];
        }
        if (transform) outCenter.applyMatrix4(transform);
    }

    getSplatScaleAndRotation = function() {

        const scaleMatrix = new THREE.Matrix4();
        const rotationMatrix = new THREE.Matrix4();
        const tempMatrix = new THREE.Matrix4();
        const tempPosition = new THREE.Vector3();

        return function(globalSplatIndex, outScale, outRotation, transform) {
            const sectionIndex = this.globalSplatIndexToSectionMap[globalSplatIndex];
            const section = this.sections[sectionIndex];
            const localSplatIndex = globalSplatIndex - section.splatCountOffset;
            const scaleBase = localSplatIndex * SplatBuffer.ScaleComponentCount;
            outScale.set(this.fbf(section.scaleArray[scaleBase]),
                         this.fbf(section.scaleArray[scaleBase + 1]),
                         this.fbf(section.scaleArray[scaleBase + 2]));
            const rotationBase = localSplatIndex * SplatBuffer.RotationComponentCount;
            outRotation.set(this.fbf(section.rotationArray[rotationBase + 1]),
                            this.fbf(section.rotationArray[rotationBase + 2]),
                            this.fbf(section.rotationArray[rotationBase + 3]),
                            this.fbf(section.rotationArray[rotationBase]));
            if (transform) {
                scaleMatrix.makeScale(outScale.x, outScale.y, outScale.z);
                rotationMatrix.makeRotationFromQuaternion(outRotation);
                tempMatrix.copy(scaleMatrix).multiply(rotationMatrix).multiply(transform);
                tempMatrix.decompose(tempPosition, outRotation, outScale);
            }
        };

    }();

    getSplatColor(globalSplatIndex, outColor, transform) {
        const sectionIndex = this.globalSplatIndexToSectionMap[globalSplatIndex];
        const section = this.sections[sectionIndex];
        const localSplatIndex = globalSplatIndex - section.splatCountOffset;
        const colorBase = localSplatIndex * SplatBuffer.ColorComponentCount;
        outColor.set(section.colorArray[colorBase], section.colorArray[colorBase + 1],
                     section.colorArray[colorBase + 2], section.colorArray[colorBase + 3]);
        // TODO: apply transform for spherical harmonics
    }

    fillSplatCenterArray(outCenterArray, destOffset, transform) {
        const splatCount = this.splatCount;
        const center = new THREE.Vector3();
        for (let i = 0; i < splatCount; i++) {
            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;
            const centerSrcBase = localSplatIndex * SplatBuffer.CenterComponentCount;
            const centerDestBase = (i + destOffset) * SplatBuffer.CenterComponentCount;
            if (this.compressionLevel > 0) {
                const bucketIndex = Math.floor(localSplatIndex / section.bucketSize);
                const bucketCenter = new Float32Array(this.splatBufferData, section.bucketsBase + bucketIndex * section.bytesPerBucket,
                                                      section.bytesPerBucket / 4);
                const sf = section.compressionScaleFactor;
                const sr = section.compressionScaleRange;
                center.x = (section.centerArray[centerSrcBase] - sr) * sf + bucketCenter[0];
                center.y = (section.centerArray[centerSrcBase + 1] - sr) * sf + bucketCenter[1];
                center.z = (section.centerArray[centerSrcBase + 2] - sr) * sf + bucketCenter[2];
            } else {
                center.x = section.centerArray[centerSrcBase];
                center.y = section.centerArray[centerSrcBase + 1];
                center.z = section.centerArray[centerSrcBase + 2];
            }
            if (transform) {
                center.applyMatrix4(transform);
            }
            outCenterArray[centerDestBase] = center.x;
            outCenterArray[centerDestBase + 1] = center.y;
            outCenterArray[centerDestBase + 2] = center.z;
        }
    }

    fillSplatCovarianceArray(covarianceArray, destOffset, transform) {
        const splatCount = this.splatCount;

        const scale = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const rotationMatrix = new THREE.Matrix3();
        const scaleMatrix = new THREE.Matrix3();
        const covarianceMatrix = new THREE.Matrix3();
        const transformedCovariance = new THREE.Matrix3();
        const transform3x3 = new THREE.Matrix3();
        const transform3x3Transpose = new THREE.Matrix3();
        const tempMatrix4 = new THREE.Matrix4();

        for (let i = 0; i < splatCount; i++) {
            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;

            const scaleBase = localSplatIndex * SplatBuffer.ScaleComponentCount;
            scale.set(this.fbf(section.scaleArray[scaleBase]),
                      this.fbf(section.scaleArray[scaleBase + 1]),
                      this.fbf(section.scaleArray[scaleBase + 2]));
            tempMatrix4.makeScale(scale.x, scale.y, scale.z);
            scaleMatrix.setFromMatrix4(tempMatrix4);

            const rotationBase = localSplatIndex * SplatBuffer.RotationComponentCount;
            rotation.set(this.fbf(section.rotationArray[rotationBase + 1]),
                         this.fbf(section.rotationArray[rotationBase + 2]),
                         this.fbf(section.rotationArray[rotationBase + 3]),
                         this.fbf(section.rotationArray[rotationBase]));
            tempMatrix4.makeRotationFromQuaternion(rotation);
            rotationMatrix.setFromMatrix4(tempMatrix4);

            covarianceMatrix.copy(rotationMatrix).multiply(scaleMatrix);
            transformedCovariance.copy(covarianceMatrix).transpose().premultiply(covarianceMatrix);
            const covBase = SplatBuffer.CovarianceSizeFloats * (i + destOffset);

            if (transform) {
                transform3x3.setFromMatrix4(transform);
                transform3x3Transpose.copy(transform3x3).transpose();
                transformedCovariance.multiply(transform3x3Transpose);
                transformedCovariance.premultiply(transform3x3);
            }

            covarianceArray[covBase] = transformedCovariance.elements[0];
            covarianceArray[covBase + 1] = transformedCovariance.elements[3];
            covarianceArray[covBase + 2] = transformedCovariance.elements[6];
            covarianceArray[covBase + 3] = transformedCovariance.elements[4];
            covarianceArray[covBase + 4] = transformedCovariance.elements[7];
            covarianceArray[covBase + 5] = transformedCovariance.elements[8];
        }
    }

    fillSplatColorArray(outColorArray, destOffset, transform) {
        const splatCount = this.splatCount;
        for (let i = 0; i < splatCount; i++) {

            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;

            const colorSrcBase = localSplatIndex * SplatBuffer.ColorComponentCount;
            const colorDestBase = (i + destOffset) * SplatBuffer.ColorComponentCount;
            outColorArray[colorDestBase] = section.colorArray[colorSrcBase];
            outColorArray[colorDestBase + 1] = section.colorArray[colorSrcBase + 1];
            outColorArray[colorDestBase + 2] = section.colorArray[colorSrcBase + 2];
            outColorArray[colorDestBase + 3] = section.colorArray[colorSrcBase + 3];

            // TODO: implement application of transform for spherical harmonics
        }
    }
}
