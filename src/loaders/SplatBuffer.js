import * as THREE from 'three';
import { UncompressedSplatArray } from './UncompressedSplatArray.js';
import { clamp } from '../Util.js';

/**
 * SplatBuffer: Container for splat data from a single scene/file and capable of (mediocre) compression.
 */
export class SplatBuffer {

    static CenterComponentCount = 3;
    static ScaleComponentCount = 3;
    static RotationComponentCount = 4;
    static ColorComponentCount = 4;
    static CovarianceComponentCount = 6;

    static SplatScaleOffsetFloat = 3;
    static SplatRotationOffsetFloat = 6;

    static CompressionLevels = {
        0: {
            BytesPerCenter: 12,
            BytesPerColor: 4,
            BytesPerScale: 12,
            BytesPerRotation: 16,
            ScaleRange: 1
        },
        1: {
            BytesPerCenter: 6,
            BytesPerColor: 4,
            BytesPerScale: 6,
            BytesPerRotation: 8,
            ScaleRange: 32767
        }
    };

    static CovarianceSizeFloats = 6;

    static HeaderSizeBytes = 4096;
    static SectionHeaderSizeBytes = 1024;

    static BucketStorageSizeBytes = 12;
    static BucketStorageSizeFloats = 3;

    static BucketBlockSize = 5.0;
    static BucketSize = 256;

    constructor(bufferData, secLoadedCountsToMax = true) {
        this.constructFromBuffer(bufferData, secLoadedCountsToMax);
    }

    fbf(f) {
        if (this.compressionLevel === 0) {
            return f;
        } else {
            return THREE.DataUtils.fromHalfFloat(f);
        }
    };

    getSplatCount() {
        return this.splatCount;
    }

    getMaxSplatCount() {
        return this.maxSplatCount;
    }

    getSplatCenter(globalSplatIndex, outCenter, transform) {
        const sectionIndex = this.globalSplatIndexToSectionMap[globalSplatIndex];
        const section = this.sections[sectionIndex];
        const localSplatIndex = globalSplatIndex - section.splatCountOffset;
        if (this.compressionLevel === 1) {
            const centerBase = localSplatIndex * this.uint16PerSplat;
            const bucketIndex = Math.floor(localSplatIndex / section.bucketSize);
            const bucketBase = bucketIndex * SplatBuffer.BucketStorageSizeFloats;
            const sf = section.compressionScaleFactor;
            const sr = section.compressionScaleRange;
            outCenter.x = (section.dataArrayUint16[centerBase] - sr) * sf + section.bucketArray[bucketBase];
            outCenter.y = (section.dataArrayUint16[centerBase + 1] - sr) * sf + section.bucketArray[bucketBase + 1];
            outCenter.z = (section.dataArrayUint16[centerBase + 2] - sr) * sf + section.bucketArray[bucketBase + 2];
        } else {
            const centerBase = localSplatIndex * this.float32PerSplat;
            outCenter.x = section.dataArrayFloat32[centerBase];
            outCenter.y = section.dataArrayFloat32[centerBase + 1];
            outCenter.z = section.dataArrayFloat32[centerBase + 2];
        }
        if (transform) outCenter.applyMatrix4(transform);
    }

    getSplatScaleAndRotation = function() {

        const scaleMatrix = new THREE.Matrix4();
        const rotationMatrix = new THREE.Matrix4();
        const tempMatrix = new THREE.Matrix4();
        const tempPosition = new THREE.Vector3();

        return function(index, outScale, outRotation, transform) {
            const sectionIndex = this.globalSplatIndexToSectionMap[index];
            const section = this.sections[sectionIndex];
            const localSplatIndex = index - section.splatCountOffset;

            const floatsPerSplat = this.compressionLevel === 1 ? this.uint16PerSplat : this.float32PerSplat;

            const sectionFloatArray = this.compressionLevel === 1 ? section.dataArrayUint16 : section.dataArrayFloat32;
            const splatFloatBase = floatsPerSplat * localSplatIndex;

            const scaleBase = splatFloatBase + SplatBuffer.SplatScaleOffsetFloat;
            outScale.set(this.fbf(sectionFloatArray[scaleBase]),
                         this.fbf(sectionFloatArray[scaleBase + 1]),
                         this.fbf(sectionFloatArray[scaleBase + 2]));

            const rotationBase = splatFloatBase + SplatBuffer.SplatRotationOffsetFloat;
            outRotation.set(this.fbf(sectionFloatArray[rotationBase + 1]),
                            this.fbf(sectionFloatArray[rotationBase + 2]),
                            this.fbf(sectionFloatArray[rotationBase + 3]),
                            this.fbf(sectionFloatArray[rotationBase]));

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
        const colorBase = this.bytesPerSplat * localSplatIndex + this.bytesPerCenter + this.bytesPerScale + this.bytesPerRotation;
        outColor.set(section.dataArrayUint8[colorBase], section.dataArrayUint8[colorBase + 1],
                     section.dataArrayUint8[colorBase + 2], section.dataArrayUint8[colorBase + 3]);
        // TODO: apply transform for spherical harmonics
    }

    fillSplatCenterArray(outCenterArray, transform, srcFrom, srcTo, destFrom) {
        const splatCount = this.splatCount;

        srcFrom = srcFrom || 0;
        srcTo = srcTo || splatCount - 1;
        if (destFrom === undefined) destFrom = srcFrom;

        const center = new THREE.Vector3();
        for (let i = srcFrom; i <= srcTo; i++) {
            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;
            const centerDestBase = (i - srcFrom + destFrom) * SplatBuffer.CenterComponentCount;
            if (this.compressionLevel === 1) {
                const centerBase = localSplatIndex * this.uint16PerSplat;
                const bucketIndex = Math.floor(localSplatIndex / section.bucketSize);
                const bucketBase = bucketIndex * SplatBuffer.BucketStorageSizeFloats;
                const sf = section.compressionScaleFactor;
                const sr = section.compressionScaleRange;
                center.x = (section.dataArrayUint16[centerBase] - sr) * sf + section.bucketArray[bucketBase];
                center.y = (section.dataArrayUint16[centerBase + 1] - sr) * sf + section.bucketArray[bucketBase + 1];
                center.z = (section.dataArrayUint16[centerBase + 2] - sr) * sf + section.bucketArray[bucketBase + 2];
            } else {
                const centerBase = localSplatIndex * this.float32PerSplat;
                center.x = section.dataArrayFloat32[centerBase];
                center.y = section.dataArrayFloat32[centerBase + 1];
                center.z = section.dataArrayFloat32[centerBase + 2];
            }
            if (transform) {
                center.applyMatrix4(transform);
            }
            outCenterArray[centerDestBase] = center.x;
            outCenterArray[centerDestBase + 1] = center.y;
            outCenterArray[centerDestBase + 2] = center.z;
        }
    }

    static computeCovariance = function() {

        const tempMatrix4 = new THREE.Matrix4();
        const scaleMatrix = new THREE.Matrix3();
        const rotationMatrix = new THREE.Matrix3();
        const covarianceMatrix = new THREE.Matrix3();
        const transformedCovariance = new THREE.Matrix3();
        const transform3x3 = new THREE.Matrix3();
        const transform3x3Transpose = new THREE.Matrix3();
        const thf = THREE.DataUtils.toHalfFloat.bind(THREE.DataUtils);

        return function(scale, rotation, transform, outCovariance, outOffset = 0, desiredOutputCompressionLevel) {

            tempMatrix4.makeScale(scale.x, scale.y, scale.z);
            scaleMatrix.setFromMatrix4(tempMatrix4);

            tempMatrix4.makeRotationFromQuaternion(rotation);
            rotationMatrix.setFromMatrix4(tempMatrix4);

            covarianceMatrix.copy(rotationMatrix).multiply(scaleMatrix);
            transformedCovariance.copy(covarianceMatrix).transpose().premultiply(covarianceMatrix);

            if (transform) {
                transform3x3.setFromMatrix4(transform);
                transform3x3Transpose.copy(transform3x3).transpose();
                transformedCovariance.multiply(transform3x3Transpose);
                transformedCovariance.premultiply(transform3x3);
            }

            if (desiredOutputCompressionLevel === 1) {
                outCovariance[outOffset] = thf(transformedCovariance.elements[0]);
                outCovariance[outOffset + 1] = thf(transformedCovariance.elements[3]);
                outCovariance[outOffset + 2] = thf(transformedCovariance.elements[6]);
                outCovariance[outOffset + 3] = thf(transformedCovariance.elements[4]);
                outCovariance[outOffset + 4] = thf(transformedCovariance.elements[7]);
                outCovariance[outOffset + 5] = thf(transformedCovariance.elements[8]);
            } else {
                outCovariance[outOffset] = transformedCovariance.elements[0];
                outCovariance[outOffset + 1] = transformedCovariance.elements[3];
                outCovariance[outOffset + 2] = transformedCovariance.elements[6];
                outCovariance[outOffset + 3] = transformedCovariance.elements[4];
                outCovariance[outOffset + 4] = transformedCovariance.elements[7];
                outCovariance[outOffset + 5] = transformedCovariance.elements[8];
            }

        };

    }();

    fillSplatCovarianceArray(covarianceArray, transform, srcFrom, srcTo, destFrom, desiredOutputCompressionLevel) {
        const splatCount = this.splatCount;

        const scale = new THREE.Vector3();
        const rotation = new THREE.Quaternion();

        srcFrom = srcFrom || 0;
        srcTo = srcTo || splatCount - 1;
        if (destFrom === undefined) destFrom = srcFrom;
        const floatsPerSplat = this.compressionLevel === 1 ? this.uint16PerSplat : this.float32PerSplat;

        for (let i = srcFrom; i <= srcTo; i++) {
            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;

            const sectionFloatArray = this.compressionLevel === 1 ? section.dataArrayUint16 : section.dataArrayFloat32;
            const splatFloatBase = floatsPerSplat * localSplatIndex;
            const covarianceDestBase = (i - srcFrom + destFrom) * SplatBuffer.CovarianceComponentCount;

            const scaleBase = splatFloatBase + SplatBuffer.SplatScaleOffsetFloat;
            scale.set(this.fbf(sectionFloatArray[scaleBase]),
                      this.fbf(sectionFloatArray[scaleBase + 1]),
                      this.fbf(sectionFloatArray[scaleBase + 2]));

            const rotationBase = splatFloatBase + SplatBuffer.SplatRotationOffsetFloat;
            rotation.set(this.fbf(sectionFloatArray[rotationBase + 1]),
                         this.fbf(sectionFloatArray[rotationBase + 2]),
                         this.fbf(sectionFloatArray[rotationBase + 3]),
                         this.fbf(sectionFloatArray[rotationBase]));

            SplatBuffer.computeCovariance(scale, rotation, transform, covarianceArray, covarianceDestBase, desiredOutputCompressionLevel);
        }
    }

    fillSplatColorArray(outColorArray, transform, srcFrom, srcTo, destFrom) {
        const splatCount = this.splatCount;

        srcFrom = srcFrom || 0;
        srcTo = srcTo || splatCount - 1;
        if (destFrom === undefined) destFrom = srcFrom;
        const splatColorOffset = this.bytesPerCenter + this.bytesPerScale + this.bytesPerRotation;

        for (let i = srcFrom; i <= srcTo; i++) {

            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;

            const colorSrcBase = this.bytesPerSplat * localSplatIndex + splatColorOffset;
            const colorDestBase = (i - srcFrom + destFrom) * SplatBuffer.ColorComponentCount;

            outColorArray[colorDestBase] = section.dataArrayUint8[colorSrcBase];
            outColorArray[colorDestBase + 1] = section.dataArrayUint8[colorSrcBase + 1];
            outColorArray[colorDestBase + 2] = section.dataArrayUint8[colorSrcBase + 2];
            outColorArray[colorDestBase + 3] = section.dataArrayUint8[colorSrcBase + 3];

            // TODO: implement application of transform for spherical harmonics
        }
    }

    static parseHeader(buffer) {
        const headerArrayUint8 = new Uint8Array(buffer, 0, SplatBuffer.HeaderSizeBytes);
        const headerArrayUint16 = new Uint16Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 2);
        const headerArrayUint32 = new Uint32Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 4);
        const versionMajor = headerArrayUint8[0];
        const versionMinor = headerArrayUint8[1];
        const maxSectionCount = headerArrayUint32[1];
        const sectionCount = headerArrayUint32[2];
        const maxSplatCount = headerArrayUint32[3];
        const splatCount = headerArrayUint32[4];
        const compressionLevel = headerArrayUint16[10];

        return {
            versionMajor,
            versionMinor,
            maxSectionCount,
            sectionCount,
            maxSplatCount,
            splatCount,
            compressionLevel
        };
    }

    static writeHeaderToBuffer(header, buffer) {
        const headerArrayUint8 = new Uint8Array(buffer);
        const headerArrayUint32 = new Uint32Array(buffer);
        const headerArrayUint16 = new Uint16Array(buffer);
        headerArrayUint8[0] = header.versionMajor;
        headerArrayUint8[1] = header.versionMinor;
        headerArrayUint8[2] = 0; // unused for now
        headerArrayUint8[3] = 0; // unused for now
        headerArrayUint32[1] = header.maxSectionCount;
        headerArrayUint32[2] = header.sectionCount;
        headerArrayUint32[3] = header.maxSplatCount;
        headerArrayUint32[4] = header.splatCount;
        headerArrayUint16[10] = header.compressionLevel;
    }

    static parseSectionHeaders(header, buffer, offset = 0) {
        const compressionLevel = header.compressionLevel;
        const bytesPerCenter = SplatBuffer.CompressionLevels[compressionLevel].BytesPerCenter;
        const bytesPerColor = SplatBuffer.CompressionLevels[compressionLevel].BytesPerColor;
        const bytesPerScale = SplatBuffer.CompressionLevels[compressionLevel].BytesPerScale;
        const bytesPerRotation = SplatBuffer.CompressionLevels[compressionLevel].BytesPerRotation;

        const maxSectionCount = header.maxSectionCount;
        const sectionHeaderArrayUint16 = new Uint16Array(buffer, offset, maxSectionCount * SplatBuffer.SectionHeaderSizeBytes / 2);
        const sectionHeaderArrayUint32 = new Uint32Array(buffer, offset, maxSectionCount * SplatBuffer.SectionHeaderSizeBytes / 4);
        const sectionHeaderArrayFloat32 = new Float32Array(buffer, offset, maxSectionCount * SplatBuffer.SectionHeaderSizeBytes / 4);

        const sectionHeaders = [];
        let sectionHeaderBase = 0;
        let sectionHeaderBaseUint16 = sectionHeaderBase / 2;
        let sectionHeaderBaseUint32 = sectionHeaderBase / 4;
        let sectionBase = SplatBuffer.HeaderSizeBytes + header.maxSectionCount * SplatBuffer.SectionHeaderSizeBytes;
        let splatCountOffset = 0;
        for (let i = 0; i < maxSectionCount; i++) {
            const splatCount = sectionHeaderArrayUint32[sectionHeaderBaseUint32];
            const maxSplatCount = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 1];
            const bucketSize = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 2];
            const bucketCount = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 3];
            const bucketBlockSize = sectionHeaderArrayFloat32[sectionHeaderBaseUint32 + 4];
            const halfBucketBlockSize = bucketBlockSize / 2.0;
            const bucketStorageSizeBytes = sectionHeaderArrayUint16[sectionHeaderBaseUint16 + 10];
            const bucketsStorageSizeBytes = bucketStorageSizeBytes * bucketCount;
            const compressionScaleRange = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 6] ||
                                          SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;

            const splatDataStorageSizeBytes = (bytesPerCenter + bytesPerScale + bytesPerRotation + bytesPerColor) * maxSplatCount;
            const storageSizeBytes = splatDataStorageSizeBytes + bucketsStorageSizeBytes;
            const sectionHeader = {
                splatCountOffset: splatCountOffset,
                splatCount: splatCount,
                maxSplatCount: maxSplatCount,
                bucketSize: bucketSize,
                bucketCount: bucketCount,
                bucketBlockSize: bucketBlockSize,
                halfBucketBlockSize: halfBucketBlockSize,
                bucketStorageSizeBytes: bucketStorageSizeBytes,
                bucketsStorageSizeBytes: bucketsStorageSizeBytes,
                splatDataStorageSizeBytes: splatDataStorageSizeBytes,
                storageSizeBytes: storageSizeBytes,
                compressionScaleRange: compressionScaleRange,
                compressionScaleFactor: halfBucketBlockSize / compressionScaleRange,
                base: sectionBase,
                bucketsBase: sectionBase + splatDataStorageSizeBytes
            };
            sectionHeaders[i] = sectionHeader;
            sectionBase += storageSizeBytes;
            sectionHeaderBase += SplatBuffer.SectionHeaderSizeBytes;
            sectionHeaderBaseUint16 = sectionHeaderBase / 2;
            sectionHeaderBaseUint32 = sectionHeaderBase / 4;
            splatCountOffset += maxSplatCount;
        }

        return sectionHeaders;
    }

    constructFromBuffer(bufferData, secLoadedCountsToMax) {
        this.bufferData = bufferData;

        this.globalSplatIndexToLocalSplatIndexMap = [];
        this.globalSplatIndexToSectionMap = [];

        const header = SplatBuffer.parseHeader(this.bufferData);
        this.versionMajor = header.versionMajor;
        this.versionMinor = header.versionMinor;
        this.maxSectionCount = header.maxSectionCount;
        this.sectionCount = secLoadedCountsToMax ? header.maxSectionCount : 0;
        this.maxSplatCount = header.maxSplatCount;
        this.splatCount = secLoadedCountsToMax ? header.maxSplatCount : 0;
        this.compressionLevel = header.compressionLevel;

        this.bytesPerCenter = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerCenter;
        this.bytesPerScale = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerScale;
        this.bytesPerRotation = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerRotation;
        this.bytesPerColor = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerColor;
        this.bytesPerSplat = this.bytesPerCenter + this.bytesPerScale + this.bytesPerRotation + this.bytesPerColor;

        this.float32PerSplat = this.bytesPerSplat / 4;
        this.uint32PerSplat = this.bytesPerSplat / 4;
        this.uint16PerSplat = this.bytesPerSplat / 2;

        this.sections = SplatBuffer.parseSectionHeaders(header, this.bufferData, SplatBuffer.HeaderSizeBytes);

        this.linkBufferArrays();
        this.buildMaps();
    }


    linkBufferArrays() {
        for (let i = 0; i < this.maxSectionCount; i++) {
            const section = this.sections[i];
            section.dataArrayUint8 = new Uint8Array(this.bufferData, section.base, section.maxSplatCount * this.bytesPerSplat);
            section.dataArrayUint16 = new Uint16Array(this.bufferData, section.base, section.maxSplatCount * this.uint16PerSplat);
            section.dataArrayUint32 = new Uint32Array(this.bufferData, section.base, section.maxSplatCount * this.uint32PerSplat);
            section.dataArrayFloat32 = new Float32Array(this.bufferData, section.base, section.maxSplatCount * this.float32PerSplat);
            section.bucketArray = new Float32Array(this.bufferData, section.bucketsBase,
                                                   section.bucketCount * SplatBuffer.BucketStorageSizeFloats);
        }
    }

    buildMaps() {
        let cumulativeSplatCount = 0;
        for (let i = 0; i < this.maxSectionCount; i++) {
            const section = this.sections[i];
            for (let j = 0; j < section.splatCount; j++) {
                const globalSplatIndex = cumulativeSplatCount + j;
                this.globalSplatIndexToLocalSplatIndexMap[globalSplatIndex] = j;
                this.globalSplatIndexToSectionMap[globalSplatIndex] = i;
            }
            cumulativeSplatCount += section.splatCount;
        }
    }

    updateLoadedCounts(newSectionCount, newSplatCount) {
        this.sectionCount = newSectionCount;
        this.splatCount = newSplatCount;
    }

    static generateFromUncompressedSplatArrays(splatArrays, minimumAlpha, compressionLevel, blockSize, bucketSize, options = []) {

        const bytesPerCenter = SplatBuffer.CompressionLevels[compressionLevel].BytesPerCenter;
        const bytesPerScale = SplatBuffer.CompressionLevels[compressionLevel].BytesPerScale;
        const bytesPerRotation = SplatBuffer.CompressionLevels[compressionLevel].BytesPerRotation;
        const bytesPerColor = SplatBuffer.CompressionLevels[compressionLevel].BytesPerColor;
        const bytesPerSplat = bytesPerCenter + bytesPerScale + bytesPerRotation + bytesPerColor;
        const compressionScaleRange = SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;

        const sectionBuffers = [];
        const sectionHeaderBuffers = [];
        let totalSplatCount = 0;

        const tempRotation = new THREE.Quaternion();
        const thf = THREE.DataUtils.toHalfFloat.bind(THREE.DataUtils);

        for (let i = 0; i < splatArrays.length; i ++) {
            const splatArray = splatArrays[i];

            const sectionOptions = options[i] || {};

            const sectionBlockSize = (sectionOptions.blockSizeFactor || 1) * (blockSize || SplatBuffer.BucketBlockSize);
            const sectionBucketSize = Math.ceil((sectionOptions.bucketSizeFactor || 1) * (bucketSize || SplatBuffer.BucketSize));

            const validSplats = new UncompressedSplatArray();
            validSplats.addSplatFromComonents(0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);

            for (let i = 0; i < splatArray.splatCount; i++) {
                let alpha;
                if (splatArray.splats[i]['opacity']) {
                    alpha = splatArray.splats[i]['opacity'];
                } else {
                    alpha = 255;
                }
                if (alpha >= minimumAlpha) {
                    validSplats.addSplatFromComonents(splatArray.splats[i]['x'], splatArray.splats[i]['y'], splatArray.splats[i]['z'],
                                                      splatArray.splats[i]['scale_0'], splatArray.splats[i]['scale_1'],
                                                      splatArray.splats[i]['scale_2'], splatArray.splats[i]['rot_0'],
                                                      splatArray.splats[i]['rot_1'], splatArray.splats[i]['rot_2'],
                                                      splatArray.splats[i]['rot_3'], splatArray.splats[i]['f_dc_0'],
                                                      splatArray.splats[i]['f_dc_1'], splatArray.splats[i]['f_dc_2'],
                                                      splatArray.splats[i]['opacity']);
                }
            }

            const buckets = SplatBuffer.computeBucketsForUncompressedSplatArray(validSplats, sectionBlockSize, sectionBucketSize);

            const paddedSplatCount = buckets.length * sectionBucketSize;
            const sectionDataSizeBytes = paddedSplatCount * bytesPerSplat;
            const sectionSizeBytes = compressionLevel === 1 ?
                                     sectionDataSizeBytes + buckets.length * SplatBuffer.BucketStorageSizeBytes :
                                     sectionDataSizeBytes;
            const sectionBuffer = new ArrayBuffer(sectionSizeBytes);

            const blockHalfSize = sectionBlockSize / 2.0;
            const compressionScaleFactor = compressionScaleRange / blockHalfSize;
            const doubleCompressionScaleRange = compressionScaleRange * 2 + 1;

            const bucketCenter = new THREE.Vector3();
            const bucketCenterDelta = new THREE.Vector3();
            let outSplatCount = 0;
            for (let b = 0; b < buckets.length; b++) {
                const bucket = buckets[b];
                bucketCenter.fromArray(bucket.center);
                for (let i = 0; i < bucket.splats.length; i++) {
                    let row = bucket.splats[i];
                    let invalidSplat = false;
                    if (row === 0) {
                        invalidSplat = true;
                    }

                    const centerBase = outSplatCount * bytesPerSplat;
                    const scaleBase = centerBase + bytesPerCenter;
                    const rotationBase = scaleBase + bytesPerScale;
                    const colorBase = rotationBase + bytesPerRotation;
                    if (compressionLevel === 0) {
                        const center = new Float32Array(sectionBuffer, centerBase, SplatBuffer.CenterComponentCount);
                        const rot = new Float32Array(sectionBuffer, rotationBase, SplatBuffer.RotationComponentCount);
                        const scale = new Float32Array(sectionBuffer, scaleBase, SplatBuffer.ScaleComponentCount);
                        if (validSplats.splats[row]['scale_0'] !== undefined) {
                            tempRotation.set(validSplats.splats[row]['rot_1'], validSplats.splats[row]['rot_2'],
                                             validSplats.splats[row]['rot_3'], validSplats.splats[row]['rot_0']);
                            tempRotation.normalize();
                            rot.set([tempRotation.w, tempRotation.x, tempRotation.y, tempRotation.z]);
                            scale.set([validSplats.splats[row]['scale_0'], validSplats.splats[row]['scale_1'], validSplats.splats[row]['scale_2']]);
                        } else {
                            rot.set([1.0, 0.0, 0.0, 0.0]);
                            scale.set([0.01, 0.01, 0.01]);
                        }
                        center.set([validSplats.splats[row]['x'], validSplats.splats[row]['y'], validSplats.splats[row]['z']]);
                    } else {
                        const center = new Uint16Array(sectionBuffer, centerBase, SplatBuffer.CenterComponentCount);
                        const rot = new Uint16Array(sectionBuffer, rotationBase, SplatBuffer.RotationComponentCount);
                        const scale = new Uint16Array(sectionBuffer, scaleBase, SplatBuffer.ScaleComponentCount);

                        if (validSplats.splats[row]['scale_0'] !== undefined) {
                            tempRotation.set(validSplats.splats[row]['rot_1'], validSplats.splats[row]['rot_2'],
                                             validSplats.splats[row]['rot_3'], validSplats.splats[row]['rot_0']);
                            tempRotation.normalize();
                            rot.set([thf(tempRotation.w), thf(tempRotation.x), thf(tempRotation.y), thf(tempRotation.z)]);
                            scale.set([thf(validSplats.splats[row]['scale_0']),
                                       thf(validSplats.splats[row]['scale_1']),
                                       thf(validSplats.splats[row]['scale_2'])]);
                        } else {
                            rot.set([thf(1.), 0, 0, 0]);
                            scale.set([thf(0.01), thf(0.01), thf(0.01)]);
                        }
                        bucketCenterDelta.set(validSplats.splats[row]['x'], validSplats.splats[row]['y'], validSplats.splats[row]['z']).sub(bucketCenter);
                        bucketCenterDelta.x = Math.round(bucketCenterDelta.x * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.x = clamp(bucketCenterDelta.x, 0, doubleCompressionScaleRange);
                        bucketCenterDelta.y = Math.round(bucketCenterDelta.y * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.y = clamp(bucketCenterDelta.y, 0, doubleCompressionScaleRange);
                        bucketCenterDelta.z = Math.round(bucketCenterDelta.z * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.z = clamp(bucketCenterDelta.z, 0, doubleCompressionScaleRange);
                        center.set([bucketCenterDelta.x, bucketCenterDelta.y, bucketCenterDelta.z]);
                    }

                    const rgba = new Uint8ClampedArray(sectionBuffer, colorBase, 4);
                    if (invalidSplat) {
                        rgba[0] = 255;
                        rgba[1] = 0;
                        rgba[2] = 0;
                        rgba[3] = 0;
                    } else {
                        if (validSplats.splats[row]['f_dc_0'] !== undefined) {
                            rgba.set([validSplats.splats[row]['f_dc_0'], validSplats.splats[row]['f_dc_1'], validSplats.splats[row]['f_dc_2']]);
                        } else {
                            rgba.set([255, 0, 0]);
                        }
                        if (validSplats.splats[row]['opacity'] !== undefined) {
                            rgba[3] = validSplats.splats[row]['opacity'];
                        } else {
                            rgba[3] = 255;
                        }
                    }

                    outSplatCount++;
                }
            }
            totalSplatCount += outSplatCount;

            if (compressionLevel === 1) {
                const bucketArray = new Float32Array(sectionBuffer, sectionDataSizeBytes,
                                                     buckets.length * SplatBuffer.BucketStorageSizeFloats);
                for (let i = 0; i < buckets.length; i++) {
                    const bucket = buckets[i];
                    const base = i * 3;
                    bucketArray[base] = bucket.center[0];
                    bucketArray[base + 1] = bucket.center[1];
                    bucketArray[base + 2] = bucket.center[2];
                }
            }
            sectionBuffers.push(sectionBuffer);

            const sectionHeaderBuffer = new ArrayBuffer(SplatBuffer.SectionHeaderSizeBytes);
            const sectionHeadeArrayUint16 = new Uint16Array(sectionHeaderBuffer);
            const sectionHeadeArrayUint32 = new Uint32Array(sectionHeaderBuffer);
            const sectionHeadeArrayFloat32 = new Float32Array(sectionHeaderBuffer);

            sectionHeadeArrayUint32[0] = outSplatCount;
            sectionHeadeArrayUint32[1] = outSplatCount;
            sectionHeadeArrayUint32[2] = compressionLevel === 1 ? sectionBucketSize : 0;
            sectionHeadeArrayUint32[3] = compressionLevel === 1 ? buckets.length : 0;
            sectionHeadeArrayFloat32[4] = compressionLevel === 1 ? sectionBlockSize : 0.0;
            sectionHeadeArrayUint16[10] = compressionLevel === 1 ? SplatBuffer.BucketStorageSizeBytes : 0;
            sectionHeadeArrayUint32[6] = compressionLevel === 1 ? compressionScaleRange : 0;
            sectionHeadeArrayUint32[7] = sectionSizeBytes;

            sectionHeaderBuffers.push(sectionHeaderBuffer);
        }

        let sectionsCumulativeSizeBytes = 0;
        for (let sectionBuffer of sectionBuffers) sectionsCumulativeSizeBytes += sectionBuffer.byteLength;
        const unifiedBufferSize = SplatBuffer.HeaderSizeBytes +
                                  SplatBuffer.SectionHeaderSizeBytes * sectionBuffers.length + sectionsCumulativeSizeBytes;
        const unifiedBuffer = new ArrayBuffer(unifiedBufferSize);

        SplatBuffer.writeHeaderToBuffer({
            versionMajor: 0,
            versionMinor: 1,
            maxSectionCount: sectionBuffers.length,
            sectionCount: sectionBuffers.length,
            maxSplatCount: totalSplatCount,
            splatCount: totalSplatCount,
            compressionLevel: compressionLevel
        }, unifiedBuffer);

        let currentUnifiedBase = SplatBuffer.HeaderSizeBytes;
        for (let sectionHeaderBuffer of sectionHeaderBuffers) {
            new Uint8Array(unifiedBuffer, currentUnifiedBase, SplatBuffer.SectionHeaderSizeBytes).set(new Uint8Array(sectionHeaderBuffer));
            currentUnifiedBase += SplatBuffer.SectionHeaderSizeBytes;
        }

        for (let sectionBuffer of sectionBuffers) {
            new Uint8Array(unifiedBuffer, currentUnifiedBase, sectionBuffer.byteLength).set(new Uint8Array(sectionBuffer));
            currentUnifiedBase += sectionBuffer.byteLength;
        }

        const splatBuffer = new SplatBuffer(unifiedBuffer);
        return splatBuffer;
    }

    static computeBucketsForUncompressedSplatArray(splatArray, blockSize, bucketSize) {
        let splatCount = splatArray.splatCount;
        const halfBlockSize = blockSize / 2.0;

        const min = new THREE.Vector3();
        const max = new THREE.Vector3();

        // ignore the first splat since it's the invalid designator
        for (let i = 1; i < splatCount; i++) {
            const center = [splatArray.splats[i]['x'], splatArray.splats[i]['y'], splatArray.splats[i]['z']];
            if (i === 0 || center[0] < min.x) min.x = center[0];
            if (i === 0 || center[0] > max.x) max.x = center[0];
            if (i === 0 || center[1] < min.y) min.y = center[1];
            if (i === 0 || center[1] > max.y) max.y = center[1];
            if (i === 0 || center[2] < min.z) min.z = center[2];
            if (i === 0 || center[2] > max.z) max.z = center[2];
        }

        const dimensions = new THREE.Vector3().copy(max).sub(min);
        const yBlocks = Math.ceil(dimensions.y / blockSize);
        const zBlocks = Math.ceil(dimensions.z / blockSize);

        const blockCenter = new THREE.Vector3();
        const fullBuckets = [];
        const partiallyFullBuckets = {};

        // ignore the first splat since it's the invalid designator
        for (let i = 1; i < splatCount; i++) {
            const center = [splatArray.splats[i]['x'], splatArray.splats[i]['y'], splatArray.splats[i]['z']];
            const xBlock = Math.floor((center[0] - min.x) / blockSize);
            const yBlock = Math.floor((center[1] - min.y) / blockSize);
            const zBlock = Math.floor((center[2] - min.z) / blockSize);

            blockCenter.x = xBlock * blockSize + min.x + halfBlockSize;
            blockCenter.y = yBlock * blockSize + min.y + halfBlockSize;
            blockCenter.z = zBlock * blockSize + min.z + halfBlockSize;

            const bucketId = xBlock * (yBlocks * zBlocks) + yBlock * zBlocks + zBlock;
            let bucket = partiallyFullBuckets[bucketId];
            if (!bucket) {
                partiallyFullBuckets[bucketId] = bucket = {
                    'splats': [],
                    'center': blockCenter.toArray()
                };
            }

            bucket.splats.push(i);
            if (bucket.splats.length >= bucketSize) {
                fullBuckets.push(bucket);
                partiallyFullBuckets[bucketId] = null;
            }
        }

        // fill partially full buckets with invalid splats (splat 0)
        // to get them up to this.bucketSize
        for (let bucketId in partiallyFullBuckets) {
            if (partiallyFullBuckets.hasOwnProperty(bucketId)) {
                const bucket = partiallyFullBuckets[bucketId];
                if (bucket) {
                    while (bucket.splats.length < bucketSize) {
                        bucket.splats.push(0);
                    }
                    fullBuckets.push(bucket);
                }
            }
        }

        return fullBuckets;
    }
}
