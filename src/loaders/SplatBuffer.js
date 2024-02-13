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

    static CompressionLevels = {
        0: {
            BytesPerCenter: 12,
            BytesPerColor: 4,
            BytesPerCovariance: 24,
            ScaleRange: 1
        },
        1: {
            BytesPerCenter: 6,
            BytesPerColor: 4,
            BytesPerCovariance: 12,
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
        const centerBase = localSplatIndex * SplatBuffer.CenterComponentCount;
        if (this.compressionLevel > 0) {
            const sf = section.compressionScaleFactor;
            const sr = section.compressionScaleRange;
            const bucketIndex = Math.floor(localSplatIndex / section.bucketSize);
            const bucketCenter = new Float32Array(this.bufferData, section.bucketsBase + bucketIndex * section.bucketStorageSizeBytes,
                                                  section.bucketStorageSizeBytes / 4);
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

    // TODO: Re-implement to use eigen decomposition to compute scale & rotation from covariance.
    /* getSplatScaleAndRotation = function() {

        const scaleMatrix = new THREE.Matrix4();
        const rotationMatrix = new THREE.Matrix4();
        const tempMatrix = new THREE.Matrix4();
        const tempPosition = new THREE.Vector3();

        return function(globalSplatIndex, outScale, outRotation, transform) {
            // TODO: Implement!!

            if (transform) {
                scaleMatrix.makeScale(outScale.x, outScale.y, outScale.z);
                rotationMatrix.makeRotationFromQuaternion(outRotation);
                tempMatrix.copy(scaleMatrix).multiply(rotationMatrix).multiply(transform);
                tempMatrix.decompose(tempPosition, outRotation, outScale);
            }
        };

    }();*/

    getSplatColor(globalSplatIndex, outColor, transform) {
        const sectionIndex = this.globalSplatIndexToSectionMap[globalSplatIndex];
        const section = this.sections[sectionIndex];
        const localSplatIndex = globalSplatIndex - section.splatCountOffset;
        const colorBase = localSplatIndex * SplatBuffer.ColorComponentCount;
        outColor.set(section.colorArray[colorBase], section.colorArray[colorBase + 1],
                     section.colorArray[colorBase + 2], section.colorArray[colorBase + 3]);
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
            const centerSrcBase = localSplatIndex * SplatBuffer.CenterComponentCount;
            const centerDestBase = (i - srcFrom + destFrom) * SplatBuffer.CenterComponentCount;
            if (this.compressionLevel > 0) {
                const bucketIndex = Math.floor(localSplatIndex / section.bucketSize);
                const bucketCenter = new Float32Array(this.bufferData, section.bucketsBase +
                                                      bucketIndex * section.bucketStorageSizeBytes,
                                                      section.bucketStorageSizeBytes / 4);
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

    static computeCovariance = function() {

        const tempMatrix4 = new THREE.Matrix4();
        const scaleMatrix = new THREE.Matrix3();
        const rotationMatrix = new THREE.Matrix3();
        const covarianceMatrix = new THREE.Matrix3();
        const transformedCovariance = new THREE.Matrix3();
        const transform3x3 = new THREE.Matrix3();
        const transform3x3Transpose = new THREE.Matrix3();

        return function(scale, rotation, transform, outCovariance, outOffset = 0) {
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

            outCovariance[outOffset] = transformedCovariance.elements[0];
            outCovariance[outOffset + 1] = transformedCovariance.elements[3];
            outCovariance[outOffset + 2] = transformedCovariance.elements[6];
            outCovariance[outOffset + 3] = transformedCovariance.elements[4];
            outCovariance[outOffset + 4] = transformedCovariance.elements[7];
            outCovariance[outOffset + 5] = transformedCovariance.elements[8];
        };

    }();

    fillSplatCovarianceArray(covarianceArray, transform, srcFrom, srcTo, destFrom, desiredOutputCompressionLevel) {
        const splatCount = this.splatCount;
        const thf = THREE.DataUtils.toHalfFloat.bind(THREE.DataUtils);

        srcFrom = srcFrom || 0;
        srcTo = srcTo || splatCount - 1;
        if (destFrom === undefined) destFrom = srcFrom;

        for (let i = srcFrom; i <= srcTo; i++) {
            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;

            const covarianceSrcBase = localSplatIndex * SplatBuffer.CovarianceComponentCount;
            const covarianceDestBase = (i - srcFrom + destFrom) * SplatBuffer.CovarianceComponentCount;

            if (desiredOutputCompressionLevel === this.compressionLevel) {
                covarianceArray[covarianceDestBase] = section.covarianceArray[covarianceSrcBase];
                covarianceArray[covarianceDestBase + 1] = section.covarianceArray[covarianceSrcBase + 1];
                covarianceArray[covarianceDestBase + 2] = section.covarianceArray[covarianceSrcBase + 2];
                covarianceArray[covarianceDestBase + 3] = section.covarianceArray[covarianceSrcBase + 3];
                covarianceArray[covarianceDestBase + 4] = section.covarianceArray[covarianceSrcBase + 4];
                covarianceArray[covarianceDestBase + 5] = section.covarianceArray[covarianceSrcBase + 5];
            } else {
                if (desiredOutputCompressionLevel === 1 && this.compressionLevel === 0) {
                    covarianceArray[covarianceDestBase] = thf(section.covarianceArray[covarianceSrcBase]);
                    covarianceArray[covarianceDestBase + 1] = thf(section.covarianceArray[covarianceSrcBase + 1]);
                    covarianceArray[covarianceDestBase + 2] = thf(section.covarianceArray[covarianceSrcBase + 2]);
                    covarianceArray[covarianceDestBase + 3] = thf(section.covarianceArray[covarianceSrcBase + 3]);
                    covarianceArray[covarianceDestBase + 4] = thf(section.covarianceArray[covarianceSrcBase + 4]);
                    covarianceArray[covarianceDestBase + 5] = thf(section.covarianceArray[covarianceSrcBase + 5]);
                } else {
                    covarianceArray[covarianceDestBase] = this.fbf(section.covarianceArray[covarianceSrcBase]);
                    covarianceArray[covarianceDestBase + 1] = this.fbf(section.covarianceArray[covarianceSrcBase + 1]);
                    covarianceArray[covarianceDestBase + 2] = this.fbf(section.covarianceArray[covarianceSrcBase + 2]);
                    covarianceArray[covarianceDestBase + 3] = this.fbf(section.covarianceArray[covarianceSrcBase + 3]);
                    covarianceArray[covarianceDestBase + 4] = this.fbf(section.covarianceArray[covarianceSrcBase + 4]);
                    covarianceArray[covarianceDestBase + 5] = this.fbf(section.covarianceArray[covarianceSrcBase + 5]);
                }
            }

            if (transform) {
                // TODO: transform covariance
            }
        }
    };

    fillSplatColorArray(outColorArray, transform, srcFrom, srcTo, destFrom) {
        const splatCount = this.splatCount;

        srcFrom = srcFrom || 0;
        srcTo = srcTo || splatCount - 1;
        if (destFrom === undefined) destFrom = srcFrom;

        for (let i = srcFrom; i <= srcTo; i++) {

            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;

            const colorSrcBase = localSplatIndex * SplatBuffer.ColorComponentCount;
            const colorDestBase = (i - srcFrom + destFrom) * SplatBuffer.ColorComponentCount;

            outColorArray[colorDestBase] = section.colorArray[colorSrcBase];
            outColorArray[colorDestBase + 1] = section.colorArray[colorSrcBase + 1];
            outColorArray[colorDestBase + 2] = section.colorArray[colorSrcBase + 2];
            outColorArray[colorDestBase + 3] = section.colorArray[colorSrcBase + 3];

            // TODO: implement application of transform for spherical harmonics
        }
    }

    static parseHeader(buffer) {
        const headerArrayUint8 = new Uint8Array(buffer, 0, SplatBuffer.HeaderSizeBytes);
        const headerArrayUint16 = new Uint16Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 2);
        const headerArrayUint32 = new Uint32Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 4);
        const versionMajor = headerArrayUint8[0];
        const versionMinor = headerArrayUint8[1];
        const maxSectionCount = headerArrayUint8[2];
        const sectionCount = headerArrayUint8[3];
        const maxSplatCount = headerArrayUint32[1];
        const splatCount = headerArrayUint32[2];
        const compressionLevel = headerArrayUint16[6];

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
        headerArrayUint8[2] = header.maxSectionCount;
        headerArrayUint8[3] = header.sectionCount;
        headerArrayUint32[1] = header.maxSplatCount;
        headerArrayUint32[2] = header.splatCount;
        headerArrayUint16[6] = header.compressionLevel;
    }

    static parseSectionHeaders(header, buffer, offset = 0) {
        const compressionLevel = header.compressionLevel;
        const bytesPerCenter = SplatBuffer.CompressionLevels[compressionLevel].BytesPerCenter;
        const bytesPerColor = SplatBuffer.CompressionLevels[compressionLevel].BytesPerColor;
        const bytesPerCovariance = SplatBuffer.CompressionLevels[compressionLevel].BytesPerCovariance;

        const maxSectionCount = header.maxSectionCount;
        const sectionHeaderArrayUint16 = new Uint16Array(buffer, offset, maxSectionCount * SplatBuffer.SectionHeaderSizeBytes / 2);
        const sectionHeaderArrayUint32 = new Uint32Array(buffer, offset, maxSectionCount * SplatBuffer.SectionHeaderSizeBytes / 4);
        const sectionHeaderArrayFloat32 = new Float32Array(buffer, offset, maxSectionCount * SplatBuffer.SectionHeaderSizeBytes / 4);

        const sectionHeaders = [];
        let sectionHeaderBase8 = 0;
        let sectionHeaderBase16 = sectionHeaderBase8 / 2;
        let sectionHeaderBase32 = sectionHeaderBase8 / 4;
        let sectionBase8 = SplatBuffer.HeaderSizeBytes + header.maxSectionCount * SplatBuffer.SectionHeaderSizeBytes;
        let splatCountOffset = 0;
        for (let i = 0; i < maxSectionCount; i++) {
            const splatCount = sectionHeaderArrayUint32[sectionHeaderBase32];
            const bucketSize = sectionHeaderArrayUint32[sectionHeaderBase32 + 1];
            const bucketCount = sectionHeaderArrayUint32[sectionHeaderBase32 + 2];
            const bucketBlockSize = sectionHeaderArrayFloat32[sectionHeaderBase32 + 3];
            const halfBucketBlockSize = bucketBlockSize / 2.0;
            const bucketStorageSizeBytes = sectionHeaderArrayUint16[sectionHeaderBase16 + 8];
            const bucketsStorageSizeBytes = bucketStorageSizeBytes * bucketCount;
            const compressionScaleRange = sectionHeaderArrayUint32[sectionHeaderBase32 + 5] ||
                                          SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;

            let centerBufferSizeBytes = splatCount * bytesPerCenter;
            centerBufferSizeBytes += centerBufferSizeBytes % 4;
            const splatDataStorageSizeBytes = centerBufferSizeBytes + (bytesPerCovariance + bytesPerColor) * splatCount;
            const storageSizeBytes = splatDataStorageSizeBytes + bucketsStorageSizeBytes;
            const sectionHeader = {
                splatCountOffset: splatCountOffset,
                splatCount: splatCount,
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
                base: sectionBase8,
                bucketsBase: sectionBase8 + splatDataStorageSizeBytes
            };
            sectionHeaders[i] = sectionHeader;
            sectionBase8 += storageSizeBytes;
            sectionHeaderBase8 += SplatBuffer.SectionHeaderSizeBytes;
            sectionHeaderBase16 = sectionHeaderBase8 / 2;
            sectionHeaderBase32 = sectionHeaderBase8 / 4;
            splatCountOffset += splatCount;
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
        this.bytesPerCovariance = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerCovariance;
        this.bytesPerColor = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerColor;
        this.bytesPerSplat = this.bytesPerCenter + this.bytesPerCovariance + this.bytesPerColor;

        this.sections = SplatBuffer.parseSectionHeaders(header, this.bufferData, SplatBuffer.HeaderSizeBytes);

        this.linkBufferArrays();
        this.buildMaps();
    }


    linkBufferArrays() {
        let sectionBase = SplatBuffer.HeaderSizeBytes + this.maxSectionCount * SplatBuffer.SectionHeaderSizeBytes;
        for (let i = 0; i < this.maxSectionCount; i++) {
            const section = this.sections[i];
            let FloatArray = (this.compressionLevel === 0) ? Float32Array : Uint16Array;
            let centerArraySizeBytes = section.splatCount * this.bytesPerCenter;
            centerArraySizeBytes += centerArraySizeBytes % 4;
            const centerArraySizeElements = centerArraySizeBytes / ((this.compressionLevel === 0) ? 4 : 2);
            section.centerArray = new FloatArray(this.bufferData, sectionBase, centerArraySizeElements);
            section.covarianceArray = new FloatArray(this.bufferData, sectionBase + centerArraySizeBytes,
                                                     section.splatCount * SplatBuffer.CovarianceComponentCount);
            section.colorArray = new Uint8Array(this.bufferData,
                                                sectionBase + centerArraySizeBytes + this.bytesPerCovariance * section.splatCount,
                                                section.splatCount * SplatBuffer.ColorComponentCount);
            sectionBase += centerArraySizeBytes + (this.bytesPerCovariance + this.bytesPerColor) * section.splatCount +
                                                   SplatBuffer.BucketStorageSizeBytes * section.bucketCount;
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
        const bytesPerCovariance = SplatBuffer.CompressionLevels[compressionLevel].BytesPerCovariance;
        const bytesPerColor = SplatBuffer.CompressionLevels[compressionLevel].BytesPerColor;
        const compressionScaleRange = SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;

        const sectionBuffers = [];
        const sectionHeaderBuffers = [];
        let totalSplatCount = 0;

        const tempScale = new THREE.Vector3();
        const tempRotation = new THREE.Quaternion();
        const tempCov = [];

        for (let i = 0; i < splatArrays.length; i ++) {
            const splatArray = splatArrays[i];

            const sectionOptions = options[i] || {};

            const sectionBlockSize = (sectionOptions.blockSizeFactor || 1) * (blockSize || SplatBuffer.BucketBlockSize);
            const sectionBucketSize = Math.ceil((sectionOptions.bucketSizeFactor || 1) * (bucketSize || SplatBuffer.BucketSize));

            const validSplats = new UncompressedSplatArray();
            validSplats.addSplat(0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);

            for (let i = 0; i < splatArray.splatCount; i++) {
                let alpha;
                if (splatArray['opacity'][i]) {
                    alpha = splatArray['opacity'][i];
                } else {
                    alpha = 255;
                }
                if (alpha >= minimumAlpha) {
                    validSplats.addSplat(splatArray['x'][i], splatArray['y'][i], splatArray['z'][i],
                                         splatArray['scale_0'][i], splatArray['scale_1'][i], splatArray['scale_2'][i],
                                         splatArray['rot_0'][i], splatArray['rot_1'][i], splatArray['rot_2'][i], splatArray['rot_3'][i],
                                         splatArray['f_dc_0'][i], splatArray['f_dc_1'][i],
                                         splatArray['f_dc_2'][i], splatArray['opacity'][i]);
                }
            }

            const buckets = SplatBuffer.computeBucketsForUncompressedSplatArray(validSplats, sectionBlockSize, sectionBucketSize);

            const paddedSplatCount = buckets.length * sectionBucketSize;

            let centerBufferSizeBytes = bytesPerCenter * paddedSplatCount;
            centerBufferSizeBytes += centerBufferSizeBytes % 4;
            const centerBuffer = new ArrayBuffer(centerBufferSizeBytes);
            const covarianceBuffer = new ArrayBuffer(bytesPerCovariance * paddedSplatCount);
            const colorBuffer = new ArrayBuffer(bytesPerColor * paddedSplatCount);

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

                    if (compressionLevel === 0) {
                        const center = new Float32Array(centerBuffer, outSplatCount * bytesPerCenter, SplatBuffer.CenterComponentCount);
                        const cov = new Float32Array(covarianceBuffer, outSplatCount * bytesPerCovariance,
                                                     SplatBuffer.CovarianceComponentCount);
                        if (validSplats['scale_0'][row] !== undefined) {
                            tempRotation.set(validSplats['rot_1'][row], validSplats['rot_2'][row],
                                             validSplats['rot_3'][row], validSplats['rot_0'][row]);
                            tempRotation.normalize();
                            tempScale.set(validSplats['scale_0'][row], validSplats['scale_1'][row], validSplats['scale_2'][row]);
                            SplatBuffer.computeCovariance(tempScale, tempRotation, undefined, cov);
                        } else {
                            cov.set([1.0, 0.0, 0.0, 1.0, 0.0, 1.0]);
                        }
                        center.set([validSplats['x'][row], validSplats['y'][row], validSplats['z'][row]]);
                    } else {
                        const center = new Uint16Array(centerBuffer, outSplatCount * bytesPerCenter, SplatBuffer.CenterComponentCount);
                        const cov = new Uint16Array(covarianceBuffer, outSplatCount * bytesPerCovariance,
                                                    SplatBuffer.CovarianceComponentCount);
                        const thf = THREE.DataUtils.toHalfFloat.bind(THREE.DataUtils);
                        if (validSplats['scale_0'][row] !== undefined) {
                            tempRotation.set(validSplats['rot_1'][row], validSplats['rot_2'][row],
                                             validSplats['rot_3'][row], validSplats['rot_0'][row]);
                            tempRotation.normalize();
                            tempScale.set(validSplats['scale_0'][row], validSplats['scale_1'][row], validSplats['scale_2'][row]);
                            SplatBuffer.computeCovariance(tempScale, tempRotation, undefined, tempCov);
                            cov.set([thf(tempCov[0]), thf(tempCov[1]), thf(tempCov[2]), thf(tempCov[3]), thf(tempCov[4]), thf(tempCov[5])]);
                        } else {
                            cov.set([thf(1.0), thf(0.0), thf(0.0), thf(1.0), thf(0.0), thf(1.0)]);
                        }
                        bucketCenterDelta.set(validSplats['x'][row], validSplats['y'][row], validSplats['z'][row]).sub(bucketCenter);
                        bucketCenterDelta.x = Math.round(bucketCenterDelta.x * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.x = clamp(bucketCenterDelta.x, 0, doubleCompressionScaleRange);
                        bucketCenterDelta.y = Math.round(bucketCenterDelta.y * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.y = clamp(bucketCenterDelta.y, 0, doubleCompressionScaleRange);
                        bucketCenterDelta.z = Math.round(bucketCenterDelta.z * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.z = clamp(bucketCenterDelta.z, 0, doubleCompressionScaleRange);
                        center.set([bucketCenterDelta.x, bucketCenterDelta.y, bucketCenterDelta.z]);
                    }

                    const rgba = new Uint8ClampedArray(colorBuffer, outSplatCount * bytesPerColor, 4);
                    if (invalidSplat) {
                        rgba[0] = 255;
                        rgba[1] = 0;
                        rgba[2] = 0;
                        rgba[3] = 0;
                    } else {
                        if (validSplats['f_dc_0'][row] !== undefined) {
                            rgba.set([validSplats['f_dc_0'][row], validSplats['f_dc_1'][row], validSplats['f_dc_2'][row]]);
                        } else {
                            rgba.set([255, 0, 0]);
                        }
                        if (validSplats['opacity'][row] !== undefined) {
                            rgba[3] = validSplats['opacity'][row];
                        } else {
                            rgba[3] = 255;
                        }
                    }

                    outSplatCount++;
                }
            }
            totalSplatCount += outSplatCount;

            const sectionSplatDataSizeBytes = centerBuffer.byteLength + covarianceBuffer.byteLength +
                                              colorBuffer.byteLength;
            const sectionSizeBytes = compressionLevel > 0 ?
                                     sectionSplatDataSizeBytes + buckets.length * SplatBuffer.BucketStorageSizeBytes :
                                     sectionSplatDataSizeBytes;
            const sectionBuffer = new ArrayBuffer(sectionSizeBytes);

            new Uint8Array(sectionBuffer, 0, centerBuffer.byteLength).set(new Uint8Array(centerBuffer));
            new Uint8Array(sectionBuffer, centerBuffer.byteLength, covarianceBuffer.byteLength).set(new Uint8Array(covarianceBuffer));
            new Uint8Array(sectionBuffer, centerBuffer.byteLength + covarianceBuffer.byteLength,
                           colorBuffer.byteLength).set(new Uint8Array(colorBuffer));

            if (compressionLevel > 0) {
                const bucketArray = new Float32Array(sectionBuffer, sectionSplatDataSizeBytes,
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
            sectionHeadeArrayUint32[1] = compressionLevel > 0 ? sectionBucketSize : 0;
            sectionHeadeArrayUint32[2] = compressionLevel > 0 ? buckets.length : 0;
            sectionHeadeArrayFloat32[3] = compressionLevel > 0 ? sectionBlockSize : 0.0;
            sectionHeadeArrayUint16[8] = compressionLevel > 0 ? SplatBuffer.BucketStorageSizeBytes : 0;
            sectionHeadeArrayUint32[10] = compressionLevel > 0 ? compressionScaleRange : 0;
            sectionHeadeArrayUint32[11] = sectionSizeBytes;

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
            const center = [splatArray['x'][i], splatArray['y'][i], splatArray['z'][i]];
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
            const center = [splatArray['x'][i], splatArray['y'][i], splatArray['z'][i]];
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
