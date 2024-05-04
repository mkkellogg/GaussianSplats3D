import * as THREE from 'three';
import { UncompressedSplatArray } from './UncompressedSplatArray.js';
import { clamp, getSphericalHarmonicsComponentCountForDegree } from '../Util.js';

const toHalfFloat = THREE.DataUtils.toHalfFloat.bind(THREE.DataUtils);
const toUint8 = (v) => {
    return Math.floor(v * 128) + 128;
};
const fromUint8 = (v) => {
    return (v / 255) * 2.0 - 1.0;
};
const fromHalfFloat = THREE.DataUtils.fromHalfFloat.bind(THREE.DataUtils);
const fromHalfFloatToUint8 = (v) => {
    return Math.floor(fromHalfFloat(v) * 128) + 128;
};

const toUncompressedFloat = (f, compressionLevel, isSH = false) => {
    if (compressionLevel === 0) {
        return f;
    } else if (compressionLevel === 1 || compressionLevel === 2 && !isSH) {
        return THREE.DataUtils.fromHalfFloat(f);
    } else if (compressionLevel === 2) {
        return fromUint8(f);
    }
};

const floatTypeForCompressionLevel = (compressionLevel, isSH = false) => {
    if (compressionLevel === 0) return Float32Array;
    else if (compressionLevel === 1 || compressionLevel === 2 && !isSH) return Uint16Array;
    else return Uint8Array;
};

/**
 * SplatBuffer: Container for splat data from a single scene/file and capable of (mediocre) compression.
 */
export class SplatBuffer {

    static CurrentMajorVersion = 0;
    static CurrentMinorVersion = 1;

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
            BytesPerScale: 12,
            BytesPerRotation: 16,
            BytesPerColor: 4,
            ScaleOffsetBytes: 12,
            RotationffsetBytes: 24,
            ColorOffsetBytes: 40,
            SphericalHarmonicsOffsetBytes: 44,
            ScaleRange: 1,
            BytesPerSphericalHarmonicsComponent: 4,
            SphericalHarmonicsOffsetFloat: 11,
            SphericalHarmonicsDegrees: {
                0: {
                    BytesPerSplat: 44
                },
                1: {
                    BytesPerSplat: 80,
                },
                2: {
                    BytesPerSplat: 140,
                }
            },
        },
        1: {
            BytesPerCenter: 6,
            BytesPerScale: 6,
            BytesPerRotation: 8,
            BytesPerColor: 4,
            ScaleOffsetBytes: 6,
            RotationffsetBytes: 12,
            ColorOffsetBytes: 20,
            SphericalHarmonicsOffsetBytes: 24,
            ScaleRange: 32767,
            BytesPerSphericalHarmonicsComponent: 2,
            SphericalHarmonicsOffsetFloat: 12,
            SphericalHarmonicsDegrees: {
                0: {
                    BytesPerSplat: 24,
                },
                1: {
                    BytesPerSplat: 42,
                },
                2: {
                    BytesPerSplat: 72,
                }
            },
        },
        2: {
            BytesPerCenter: 6,
            BytesPerScale: 6,
            BytesPerRotation: 8,
            BytesPerColor: 4,
            ScaleOffsetBytes: 6,
            RotationffsetBytes: 12,
            ColorOffsetBytes: 20,
            SphericalHarmonicsOffsetBytes: 24,
            ScaleRange: 32767,
            BytesPerSphericalHarmonicsComponent: 1,
            SphericalHarmonicsOffsetFloat: 12,
            SphericalHarmonicsDegrees: {
                0: {
                    BytesPerSplat: 24,
                },
                1: {
                    BytesPerSplat: 33,
                },
                2: {
                    BytesPerSplat: 48,
                }
            },
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

    getSplatCount() {
        return this.splatCount;
    }

    getMaxSplatCount() {
        return this.maxSplatCount;
    }

    getBucketIndex(section, localSplatIndex) {
        let bucketIndex;
        const maxSplatIndexInFullBuckets = section.fullBucketCount * section.bucketSize;
        if (localSplatIndex < maxSplatIndexInFullBuckets) {
            bucketIndex = Math.floor(localSplatIndex / section.bucketSize);
        } else {
            let bucketSplatIndex = maxSplatIndexInFullBuckets;
            bucketIndex = section.fullBucketCount;
            let partiallyFullBucketIndex = 0;
            while (bucketSplatIndex < section.splatCount) {
                let currentPartiallyFilledBucketSize = section.partiallyFilledBucketLengths[partiallyFullBucketIndex];
                if (localSplatIndex >= bucketSplatIndex && localSplatIndex < bucketSplatIndex + currentPartiallyFilledBucketSize) {
                    break;
                }
                bucketSplatIndex += currentPartiallyFilledBucketSize;
                bucketIndex++;
                partiallyFullBucketIndex++;
            }
        }
        return bucketIndex;
    }

    getSplatCenter(globalSplatIndex, outCenter, transform) {
        const sectionIndex = this.globalSplatIndexToSectionMap[globalSplatIndex];
        const section = this.sections[sectionIndex];
        const localSplatIndex = globalSplatIndex - section.splatCountOffset;

        const srcSplatCentersBase = this.bytesPerSplat * localSplatIndex;
        const FloatArrayType = floatTypeForCompressionLevel(this.compressionLevel);
        const splatCentersArray = new FloatArrayType(this.bufferData, section.dataBase + srcSplatCentersBase, 3);

        if (this.compressionLevel >= 1) {
            const bucketIndex = this.getBucketIndex(section, localSplatIndex);
            const bucketBase = bucketIndex * SplatBuffer.BucketStorageSizeFloats;
            const sf = section.compressionScaleFactor;
            const sr = section.compressionScaleRange;
            outCenter.x = (splatCentersArray[0] - sr) * sf + section.bucketArray[bucketBase];
            outCenter.y = (splatCentersArray[1] - sr) * sf + section.bucketArray[bucketBase + 1];
            outCenter.z = (splatCentersArray[2] - sr) * sf + section.bucketArray[bucketBase + 2];
        } else {
            outCenter.x = splatCentersArray[0];
            outCenter.y = splatCentersArray[1];
            outCenter.z = splatCentersArray[2];
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

            const srcSplatScalesBase = this.bytesPerSplat * localSplatIndex +
                                      SplatBuffer.CompressionLevels[this.compressionLevel].ScaleOffsetBytes;
            const FloatArrayType = floatTypeForCompressionLevel(this.compressionLevel);
            const splatScaleRotationArray = new FloatArrayType(this.bufferData, section.dataBase + srcSplatScalesBase, 7);

            outScale.set(toUncompressedFloat(splatScaleRotationArray[0], this.compressionLevel),
                         toUncompressedFloat(splatScaleRotationArray[1], this.compressionLevel),
                         toUncompressedFloat(splatScaleRotationArray[2], this.compressionLevel));

            outRotation.set(toUncompressedFloat(splatScaleRotationArray[4], this.compressionLevel),
                            toUncompressedFloat(splatScaleRotationArray[5], this.compressionLevel),
                            toUncompressedFloat(splatScaleRotationArray[6], this.compressionLevel),
                            toUncompressedFloat(splatScaleRotationArray[3], this.compressionLevel));

            if (transform) {
                scaleMatrix.makeScale(outScale.x, outScale.y, outScale.z);
                rotationMatrix.makeRotationFromQuaternion(outRotation);
                tempMatrix.copy(scaleMatrix).multiply(rotationMatrix).multiply(transform);
                tempMatrix.decompose(tempPosition, outRotation, outScale);
            }
        };

    }();

    getSplatColor(globalSplatIndex, outColor) {
        const sectionIndex = this.globalSplatIndexToSectionMap[globalSplatIndex];
        const section = this.sections[sectionIndex];
        const localSplatIndex = globalSplatIndex - section.splatCountOffset;

        const srcSplatColorsBase = this.bytesPerSplat * localSplatIndex +
                                   SplatBuffer.CompressionLevels[this.compressionLevel].ColorOffsetBytes;
        const splatColorsArray = new Uint8Array(this.bufferData, section.dataBase + srcSplatColorsBase, 4);

        outColor.set(splatColorsArray[0], splatColorsArray[1],
                     splatColorsArray[2], splatColorsArray[3]);
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

            const srcSplatCentersBase = this.bytesPerSplat * localSplatIndex;
            const FloatArrayType = floatTypeForCompressionLevel(this.compressionLevel);
            const splatCentersArray = new FloatArrayType(this.bufferData, section.dataBase + srcSplatCentersBase, 3);

            if (this.compressionLevel >= 1) {
                const bucketIndex = this.getBucketIndex(section, localSplatIndex);
                const bucketBase = bucketIndex * SplatBuffer.BucketStorageSizeFloats;
                const sf = section.compressionScaleFactor;
                const sr = section.compressionScaleRange;
                center.x = (splatCentersArray[0] - sr) * sf + section.bucketArray[bucketBase];
                center.y = (splatCentersArray[1] - sr) * sf + section.bucketArray[bucketBase + 1];
                center.z = (splatCentersArray[2] - sr) * sf + section.bucketArray[bucketBase + 2];
            } else {
                center.x = splatCentersArray[0];
                center.y = splatCentersArray[1];
                center.z = splatCentersArray[2];
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
                outCovariance[outOffset] = toHalfFloat(transformedCovariance.elements[0]);
                outCovariance[outOffset + 1] = toHalfFloat(transformedCovariance.elements[3]);
                outCovariance[outOffset + 2] = toHalfFloat(transformedCovariance.elements[6]);
                outCovariance[outOffset + 3] = toHalfFloat(transformedCovariance.elements[4]);
                outCovariance[outOffset + 4] = toHalfFloat(transformedCovariance.elements[7]);
                outCovariance[outOffset + 5] = toHalfFloat(transformedCovariance.elements[8]);
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

        for (let i = srcFrom; i <= srcTo; i++) {
            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;

            const covarianceDestBase = (i - srcFrom + destFrom) * SplatBuffer.CovarianceComponentCount;
            const srcSplatScalesBase = this.bytesPerSplat * localSplatIndex +
                                       SplatBuffer.CompressionLevels[this.compressionLevel].ScaleOffsetBytes;
            const FloatArrayType = floatTypeForCompressionLevel(this.compressionLevel);
            const splatScaleRotationArray = new FloatArrayType(this.bufferData, section.dataBase + srcSplatScalesBase, 7);

            scale.set(toUncompressedFloat(splatScaleRotationArray[0], this.compressionLevel),
                      toUncompressedFloat(splatScaleRotationArray[1], this.compressionLevel),
                      toUncompressedFloat(splatScaleRotationArray[2], this.compressionLevel));
            rotation.set(toUncompressedFloat(splatScaleRotationArray[4], this.compressionLevel),
                      toUncompressedFloat(splatScaleRotationArray[5], this.compressionLevel),
                      toUncompressedFloat(splatScaleRotationArray[6], this.compressionLevel),
                      toUncompressedFloat(splatScaleRotationArray[3], this.compressionLevel));

            SplatBuffer.computeCovariance(scale, rotation, transform, covarianceArray, covarianceDestBase, desiredOutputCompressionLevel);
        }
    }

    fillSplatColorArray(outColorArray, minimumAlpha, srcFrom, srcTo, destFrom) {
        const splatCount = this.splatCount;

        srcFrom = srcFrom || 0;
        srcTo = srcTo || splatCount - 1;
        if (destFrom === undefined) destFrom = srcFrom;

        for (let i = srcFrom; i <= srcTo; i++) {

            const sectionIndex = this.globalSplatIndexToSectionMap[i];
            const section = this.sections[sectionIndex];
            const localSplatIndex = i - section.splatCountOffset;

            const colorDestBase = (i - srcFrom + destFrom) * SplatBuffer.ColorComponentCount;
            const srcSplatColorsBase = this.bytesPerSplat * localSplatIndex +
                                       SplatBuffer.CompressionLevels[this.compressionLevel].ColorOffsetBytes;
            const splatColorsArray = new Uint8Array(this.bufferData, section.dataBase + srcSplatColorsBase, 4);

            let alpha = splatColorsArray[3];
            alpha = (alpha >= minimumAlpha) ? alpha : 0;

            outColorArray[colorDestBase] = splatColorsArray[0];
            outColorArray[colorDestBase + 1] = splatColorsArray[1];
            outColorArray[colorDestBase + 2] = splatColorsArray[2];
            outColorArray[colorDestBase + 3] = alpha;
        }
    }

    fillSphericalHarmonicsArray = function() {

        const sphericalHarmonicVectors = [];
        for (let i = 0; i < 15; i++) {
            sphericalHarmonicVectors[i] = new THREE.Vector3();
        }

        const tempMatrix3 = new THREE.Matrix3();

        const sh11 = [];
        const sh12 = [];
        const sh13 = [];

        const sh21 = [];
        const sh22 = [];
        const sh23 = [];
        const sh24 = [];
        const sh25 = [];

        const shIn1 = [];
        const shIn2 = [];
        const shIn3 = [];
        const shIn4 = [];
        const shIn5 = [];

        const shOut1 = [];
        const shOut2 = [];
        const shOut3 = [];
        const shOut4 = [];
        const shOut5 = [];

        const noop = (v) => v;

        const set3 = (array, val1, val2, val3) => {
            array[0] = val1;
            array[1] = val2;
            array[2] = val3;
        };

        const set3FromArray = (array, srcArray, stride, srcBase) => {
            array[0] = srcArray[srcBase];
            array[1] = srcArray[srcBase + stride];
            array[2] = srcArray[srcBase + stride + stride];
        };

        const copy3 = (srcArray, destArray) => {
            destArray[0] = srcArray[0];
            destArray[1] = srcArray[1];
            destArray[2] = srcArray[2];
        };

        const setOutput3 = (srcArray, destArray, destBase, conversionFunc) => {
            destArray[destBase] = conversionFunc(srcArray[0]);
            destArray[destBase + 1] = conversionFunc(srcArray[1]);
            destArray[destBase + 2] = conversionFunc(srcArray[2]);
        };

        const toUncompressedFloatArray3 = (src, dest, compressionLevel) => {
            dest[0] = toUncompressedFloat(src[0], compressionLevel, true);
            dest[1] = toUncompressedFloat(src[1], compressionLevel, true);
            dest[2] = toUncompressedFloat(src[2], compressionLevel, true);
            return dest;
        };

        return function(outSphericalHarmonicsArray, outSphericalHarmonicsDegree, transform,
                        srcFrom, srcTo, destFrom, desiredOutputCompressionLevel) {
            const splatCount = this.splatCount;

            srcFrom = srcFrom || 0;
            srcTo = srcTo || splatCount - 1;
            if (destFrom === undefined) destFrom = srcFrom;

            if (transform && outSphericalHarmonicsDegree >= 1) {
                tempMatrix3.setFromMatrix4(transform);
                set3(sh11, tempMatrix3.elements[4], -tempMatrix3.elements[7], tempMatrix3.elements[1]);
                set3(sh12, -tempMatrix3.elements[5], tempMatrix3.elements[8], -tempMatrix3.elements[2]);
                set3(sh13, tempMatrix3.elements[3], -tempMatrix3.elements[6], tempMatrix3.elements[0]);
            }

            outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, this.sphericalHarmonicsDegree);
            const outSphericalHarmonicsComponentsCount = getSphericalHarmonicsComponentCountForDegree(outSphericalHarmonicsDegree);

            for (let i = srcFrom; i <= srcTo; i++) {

                const sectionIndex = this.globalSplatIndexToSectionMap[i];
                const section = this.sections[sectionIndex];
                const localSplatIndex = i - section.splatCountOffset;

                const srcSplatSHBase = this.bytesPerSplat * localSplatIndex +
                                       SplatBuffer.CompressionLevels[this.compressionLevel].SphericalHarmonicsOffsetBytes;
                const FloatArrayType = floatTypeForCompressionLevel(this.compressionLevel, true);
                const splatSHArray = new FloatArrayType(this.bufferData, section.dataBase + srcSplatSHBase,
                                                        outSphericalHarmonicsComponentsCount);

                const shDestBase = (i - srcFrom + destFrom) * outSphericalHarmonicsComponentsCount;

                let compressionLevelForOutputConversion = transform ? 0 : this.compressionLevel;
                let outputConversionFunc = noop;
                if (compressionLevelForOutputConversion !== desiredOutputCompressionLevel) {
                    if (compressionLevelForOutputConversion === 1) {
                        if (desiredOutputCompressionLevel === 0) outputConversionFunc = fromHalfFloat;
                        else if (desiredOutputCompressionLevel == 2) outputConversionFunc = fromHalfFloatToUint8;
                    } else if (compressionLevelForOutputConversion === 0) {
                        if (desiredOutputCompressionLevel === 1) outputConversionFunc = toHalfFloat;
                        else if (desiredOutputCompressionLevel == 2) outputConversionFunc = toUint8;
                    }
                }

                if (outSphericalHarmonicsDegree >= 1) {

                    set3FromArray(shIn1, splatSHArray, 3, 0);
                    set3FromArray(shIn2, splatSHArray, 3, 1);
                    set3FromArray(shIn3, splatSHArray, 3, 2);

                    if (transform) {
                        toUncompressedFloatArray3(shIn1, shIn1, this.compressionLevel);
                        toUncompressedFloatArray3(shIn2, shIn2, this.compressionLevel);
                        toUncompressedFloatArray3(shIn3, shIn3, this.compressionLevel);
                        SplatBuffer.rotateSphericalHarmonics3(shIn1, shIn2, shIn3, sh11, sh12, sh13, shOut1, shOut2, shOut3);
                    } else {
                        copy3(shIn1, shOut1);
                        copy3(shIn2, shOut2);
                        copy3(shIn3, shOut3);
                    }

                    setOutput3(shOut1, outSphericalHarmonicsArray, shDestBase, outputConversionFunc);
                    setOutput3(shOut2, outSphericalHarmonicsArray, shDestBase + 3, outputConversionFunc);
                    setOutput3(shOut3, outSphericalHarmonicsArray, shDestBase + 6, outputConversionFunc);

                    if (outSphericalHarmonicsDegree >= 2) {

                        set3FromArray(shIn1, splatSHArray, 5, 9);
                        set3FromArray(shIn2, splatSHArray, 5, 10);
                        set3FromArray(shIn3, splatSHArray, 5, 11);
                        set3FromArray(shIn4, splatSHArray, 5, 12);
                        set3FromArray(shIn5, splatSHArray, 5, 13);

                        if (transform) {
                            toUncompressedFloatArray3(shIn1, shIn1, this.compressionLevel);
                            toUncompressedFloatArray3(shIn2, shIn2, this.compressionLevel);
                            toUncompressedFloatArray3(shIn3, shIn3, this.compressionLevel);
                            toUncompressedFloatArray3(shIn4, shIn4, this.compressionLevel);
                            toUncompressedFloatArray3(shIn5, shIn5, this.compressionLevel);
                            SplatBuffer.rotateSphericalHarmonics5(shIn1, shIn2, shIn3, shIn4, shIn5,
                                                                  sh11, sh12, sh13, sh21, sh22, sh23, sh24, sh25,
                                                                  shOut1, shOut2, shOut3, shOut4, shOut5);
                        } else {
                            copy3(shIn1, shOut1);
                            copy3(shIn2, shOut2);
                            copy3(shIn3, shOut3);
                            copy3(shIn4, shOut4);
                            copy3(shIn5, shOut5);
                        }

                        setOutput3(shOut1, outSphericalHarmonicsArray, shDestBase + 9, outputConversionFunc);
                        setOutput3(shOut2, outSphericalHarmonicsArray, shDestBase + 12, outputConversionFunc);
                        setOutput3(shOut3, outSphericalHarmonicsArray, shDestBase + 15, outputConversionFunc);
                        setOutput3(shOut4, outSphericalHarmonicsArray, shDestBase + 18, outputConversionFunc);
                        setOutput3(shOut5, outSphericalHarmonicsArray, shDestBase + 21, outputConversionFunc);
                    }
                }
            }
        };

    }();

    static dot3 = (v1, v2, v3, transformRow, outArray) => {
        outArray[0] = outArray[1] = outArray[2] = 0;
        const t0 = transformRow[0];
        const t1 = transformRow[1];
        const t2 = transformRow[2];
        SplatBuffer.addInto3(v1[0] * t0, v1[1] * t0, v1[2] * t0, outArray);
        SplatBuffer.addInto3(v2[0] * t1, v2[1] * t1, v2[2] * t1, outArray);
        SplatBuffer.addInto3(v3[0] * t2, v3[1] * t2, v3[2] * t2, outArray);
    };

    static addInto3 = (val1, val2, val3, destArray) => {
        destArray[0] = destArray[0] + val1;
        destArray[1] = destArray[1] + val2;
        destArray[2] = destArray[2] + val3;
    };

    static dot5 = (v1, v2, v3, v4, v5, transformRow, outArray) => {
        outArray[0] = outArray[1] = outArray[2] = 0;
        const t0 = transformRow[0];
        const t1 = transformRow[1];
        const t2 = transformRow[2];
        const t3 = transformRow[3];
        const t4 = transformRow[4];
        SplatBuffer.addInto3(v1[0] * t0, v1[1] * t0, v1[2] * t0, outArray);
        SplatBuffer.addInto3(v2[0] * t1, v2[1] * t1, v2[2] * t1, outArray);
        SplatBuffer.addInto3(v3[0] * t2, v3[1] * t2, v3[2] * t2, outArray);
        SplatBuffer.addInto3(v4[0] * t3, v4[1] * t3, v4[2] * t3, outArray);
        SplatBuffer.addInto3(v5[0] * t4, v5[1] * t4, v5[2] * t4, outArray);
    };

    static rotateSphericalHarmonics3 = (in1, in2, in3, tsh11, tsh12, tsh13, out1, out2, out3) => {
        SplatBuffer.dot3(in1, in2, in3, tsh11, out1);
        SplatBuffer.dot3(in1, in2, in3, tsh12, out2);
        SplatBuffer.dot3(in1, in2, in3, tsh13, out3);
    };

    static rotateSphericalHarmonics5 = (in1, in2, in3, in4, in5, tsh11, tsh12, tsh13,
                                        tsh21, tsh22, tsh23, tsh24, tsh25, out1, out2, out3, out4, out5) => {

        const kSqrt0104 = Math.sqrt(1.0 / 4.0);
        const kSqrt0304 = Math.sqrt(3.0 / 4.0);
        const kSqrt0103 = Math.sqrt(1.0 / 3.0);
        const kSqrt0403 = Math.sqrt(4.0 / 3.0);
        const kSqrt0112 = Math.sqrt(1.0 / 12.0);

        tsh21[0] = kSqrt0104 * ((tsh13[2] * tsh11[0] + tsh13[0] * tsh11[2]) + (tsh11[2] * tsh13[0] + tsh11[0] * tsh13[2]));
        tsh21[1] = (tsh13[1] * tsh11[0] + tsh11[1] * tsh13[0]);
        tsh21[2] = kSqrt0304 * (tsh13[1] * tsh11[1] + tsh11[1] * tsh13[1]);
        tsh21[3] = (tsh13[1] * tsh11[2] + tsh11[1] * tsh13[2]);
        tsh21[4] = kSqrt0104 * ((tsh13[2] * tsh11[2] - tsh13[0] * tsh11[0]) + (tsh11[2] * tsh13[2] - tsh11[0] * tsh13[0]));
        SplatBuffer.dot5(in1, in2, in3, in4, in5, tsh21, out1);

        tsh22[0] = kSqrt0104 * ((tsh12[2] * tsh11[0] + tsh12[0] * tsh11[2]) + (tsh11[2] * tsh12[0] + tsh11[0] * tsh12[2]));
        tsh22[1] = tsh12[1] * tsh11[0] + tsh11[1] * tsh12[0];
        tsh22[2] = kSqrt0304 * (tsh12[1] * tsh11[1] + tsh11[1] * tsh12[1]);
        tsh22[3] = tsh12[1] * tsh11[2] + tsh11[1] * tsh12[2];
        tsh22[4] = kSqrt0104 * ((tsh12[2] * tsh11[2] - tsh12[0] * tsh11[0]) + (tsh11[2] * tsh12[2] - tsh11[0] * tsh12[0]));
        SplatBuffer.dot5(in1, in2, in3, in4, in5, tsh22, out2);

        tsh23[0] = kSqrt0103 * (tsh12[2] * tsh12[0] + tsh12[0] * tsh12[2]) + -kSqrt0112 *
                    ((tsh13[2] * tsh13[0] + tsh13[0] * tsh13[2]) + (tsh11[2] * tsh11[0] + tsh11[0] * tsh11[2]));
        tsh23[1] = kSqrt0403 * tsh12[1] * tsh12[0] + -kSqrt0103 * (tsh13[1] * tsh13[0] + tsh11[1] * tsh11[0]);
        tsh23[2] = tsh12[1] * tsh12[1] + -kSqrt0104 * (tsh13[1] * tsh13[1] + tsh11[1] * tsh11[1]);
        tsh23[3] = kSqrt0403 * tsh12[1] * tsh12[2] + -kSqrt0103 * (tsh13[1] * tsh13[2] + tsh11[1] * tsh11[2]);
        tsh23[4] = kSqrt0103 * (tsh12[2] * tsh12[2] - tsh12[0] * tsh12[0]) + -kSqrt0112 *
                    ((tsh13[2] * tsh13[2] - tsh13[0] * tsh13[0]) + (tsh11[2] * tsh11[2] - tsh11[0] * tsh11[0]));
        SplatBuffer.dot5(in1, in2, in3, in4, in5, tsh23, out3);

        tsh24[0] = kSqrt0104 * ((tsh12[2] * tsh13[0] + tsh12[0] * tsh13[2]) + (tsh13[2] * tsh12[0] + tsh13[0] * tsh12[2]));
        tsh24[1] = tsh12[1] * tsh13[0] + tsh13[1] * tsh12[0];
        tsh24[2] = kSqrt0304 * (tsh12[1] * tsh13[1] + tsh13[1] * tsh12[1]);
        tsh24[3] = tsh12[1] * tsh13[2] + tsh13[1] * tsh12[2];
        tsh24[4] = kSqrt0104 * ((tsh12[2] * tsh13[2] - tsh12[0] * tsh13[0]) + (tsh13[2] * tsh12[2] - tsh13[0] * tsh12[0]));
        SplatBuffer.dot5(in1, in2, in3, in4, in5, tsh24, out4);

        tsh25[0] = kSqrt0104 * ((tsh13[2] * tsh13[0] + tsh13[0] * tsh13[2]) - (tsh11[2] * tsh11[0] + tsh11[0] * tsh11[2]));
        tsh25[1] = (tsh13[1] * tsh13[0] - tsh11[1] * tsh11[0]);
        tsh25[2] = kSqrt0304 * (tsh13[1] * tsh13[1] - tsh11[1] * tsh11[1]);
        tsh25[3] = (tsh13[1] * tsh13[2] - tsh11[1] * tsh11[2]);
        tsh25[4] = kSqrt0104 * ((tsh13[2] * tsh13[2] - tsh13[0] * tsh13[0]) - (tsh11[2] * tsh11[2] - tsh11[0] * tsh11[0]));
        SplatBuffer.dot5(in1, in2, in3, in4, in5, tsh25, out5);
    };

    static parseHeader(buffer) {
        const headerArrayUint8 = new Uint8Array(buffer, 0, SplatBuffer.HeaderSizeBytes);
        const headerArrayUint16 = new Uint16Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 2);
        const headerArrayUint32 = new Uint32Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 4);
        const headerArrayFloat32 = new Float32Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 4);
        const versionMajor = headerArrayUint8[0];
        const versionMinor = headerArrayUint8[1];
        const maxSectionCount = headerArrayUint32[1];
        const sectionCount = headerArrayUint32[2];
        const maxSplatCount = headerArrayUint32[3];
        const splatCount = headerArrayUint32[4];
        const compressionLevel = headerArrayUint16[10];
        const sceneCenter = new THREE.Vector3(headerArrayFloat32[6], headerArrayFloat32[7], headerArrayFloat32[8]);
        const sphericalHarmonicsDegree = headerArrayUint16[18];

        return {
            versionMajor,
            versionMinor,
            maxSectionCount,
            sectionCount,
            maxSplatCount,
            splatCount,
            compressionLevel,
            sceneCenter,
            sphericalHarmonicsDegree
        };
    }

    static writeHeaderCountsToBuffer(sectionCount, splatCount, buffer) {
        const headerArrayUint32 = new Uint32Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 4);
        headerArrayUint32[2] = sectionCount;
        headerArrayUint32[4] = splatCount;
    }

    static writeHeaderToBuffer(header, buffer) {
        const headerArrayUint8 = new Uint8Array(buffer, 0, SplatBuffer.HeaderSizeBytes);
        const headerArrayUint16 = new Uint16Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 2);
        const headerArrayUint32 = new Uint32Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 4);
        const headerArrayFloat32 = new Float32Array(buffer, 0, SplatBuffer.HeaderSizeBytes / 4);
        headerArrayUint8[0] = header.versionMajor;
        headerArrayUint8[1] = header.versionMinor;
        headerArrayUint8[2] = 0; // unused for now
        headerArrayUint8[3] = 0; // unused for now
        headerArrayUint32[1] = header.maxSectionCount;
        headerArrayUint32[2] = header.sectionCount;
        headerArrayUint32[3] = header.maxSplatCount;
        headerArrayUint32[4] = header.splatCount;
        headerArrayUint16[10] = header.compressionLevel;
        headerArrayFloat32[6] = header.sceneCenter.x;
        headerArrayFloat32[7] = header.sceneCenter.y;
        headerArrayFloat32[8] = header.sceneCenter.z;
        headerArrayUint16[18] = header.sphericalHarmonicsDegree;
    }

    static parseSectionHeaders(header, buffer, offset = 0, secLoadedCountsToMax) {
        const compressionLevel = header.compressionLevel;
        const { bytesPerSplat } = SplatBuffer.calculateComponentStorage(compressionLevel, header.sphericalHarmonicsDegree);

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
            const maxSplatCount = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 1];
            const bucketSize = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 2];
            const bucketCount = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 3];
            const bucketBlockSize = sectionHeaderArrayFloat32[sectionHeaderBaseUint32 + 4];
            const halfBucketBlockSize = bucketBlockSize / 2.0;
            const bucketStorageSizeBytes = sectionHeaderArrayUint16[sectionHeaderBaseUint16 + 10];
            const compressionScaleRange = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 6] ||
                                          SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;
            const fullBucketCount = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 8];
            const partiallyFilledBucketCount = sectionHeaderArrayUint32[sectionHeaderBaseUint32 + 9];
            const bucketsMetaDataSizeBytes = partiallyFilledBucketCount * 4;
            const bucketsStorageSizeBytes = bucketStorageSizeBytes * bucketCount + bucketsMetaDataSizeBytes;

            const splatDataStorageSizeBytes = bytesPerSplat * maxSplatCount;
            const storageSizeBytes = splatDataStorageSizeBytes + bucketsStorageSizeBytes;
            const sectionHeader = {
                splatCountOffset: splatCountOffset,
                splatCount: secLoadedCountsToMax ? maxSplatCount : 0,
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
                bucketsBase: sectionBase + bucketsMetaDataSizeBytes,
                dataBase: sectionBase + bucketsStorageSizeBytes,
                fullBucketCount: fullBucketCount,
                partiallyFilledBucketCount: partiallyFilledBucketCount
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


    static writeSectionHeaderToBuffer(sectionHeader, compressionLevel, buffer, offset = 0) {
        const sectionHeadeArrayUint16 = new Uint16Array(buffer, offset, SplatBuffer.SectionHeaderSizeBytes / 2);
        const sectionHeadeArrayUint32 = new Uint32Array(buffer, offset, SplatBuffer.SectionHeaderSizeBytes / 4);
        const sectionHeadeArrayFloat32 = new Float32Array(buffer, offset, SplatBuffer.SectionHeaderSizeBytes / 4);

        sectionHeadeArrayUint32[0] = sectionHeader.splatCount;
        sectionHeadeArrayUint32[1] = sectionHeader.maxSplatCount;
        sectionHeadeArrayUint32[2] = compressionLevel >= 1 ? sectionHeader.bucketSize : 0;
        sectionHeadeArrayUint32[3] = compressionLevel >= 1 ? sectionHeader.bucketCount : 0;
        sectionHeadeArrayFloat32[4] = compressionLevel >= 1 ? sectionHeader.bucketBlockSize : 0.0;
        sectionHeadeArrayUint16[10] = compressionLevel >= 1 ? SplatBuffer.BucketStorageSizeBytes : 0;
        sectionHeadeArrayUint32[6] = compressionLevel >= 1 ? sectionHeader.compressionScaleRange : 0;
        sectionHeadeArrayUint32[7] = sectionHeader.storageSizeBytes;
        sectionHeadeArrayUint32[8] = compressionLevel >= 1 ? sectionHeader.fullBucketCount : 0;
        sectionHeadeArrayUint32[9] = compressionLevel >= 1 ? sectionHeader.partiallyFilledBucketCount : 0;
    }

    static writeSectionHeaderSplatCountToBuffer(splatCount, buffer, offset = 0) {
        const sectionHeadeArrayUint32 = new Uint32Array(buffer, offset, SplatBuffer.SectionHeaderSizeBytes / 4);
        sectionHeadeArrayUint32[0] = splatCount;
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
        this.sceneCenter = new THREE.Vector3().copy(header.sceneCenter);
        this.sphericalHarmonicsDegree = header.sphericalHarmonicsDegree;

        const {bytesPerCenter, bytesPerScale, bytesPerRotation, bytesPerColor,
               sphericalHarmonicsComponentsPerSplat, sphericalHarmonicsBytesPerSplat,
               bytesPerSplat} = SplatBuffer.calculateComponentStorage(this.compressionLevel, this.sphericalHarmonicsDegree);

        this.bytesPerCenter = bytesPerCenter;
        this.bytesPerScale = bytesPerScale;
        this.bytesPerRotation = bytesPerRotation;
        this.bytesPerColor = bytesPerColor;
        this.sphericalHarmonicsComponentsPerSplat = sphericalHarmonicsComponentsPerSplat;
        this.sphericalHarmonicsBytesPerSplat = sphericalHarmonicsBytesPerSplat;
        this.bytesPerSplat = bytesPerSplat;

        this.sections = SplatBuffer.parseSectionHeaders(header, this.bufferData, SplatBuffer.HeaderSizeBytes, secLoadedCountsToMax);

        this.linkBufferArrays();
        this.buildMaps();
    }

    static calculateComponentStorage(compressionLevel, sphericalHarmonicsDegree) {
        const bytesPerCenter = SplatBuffer.CompressionLevels[compressionLevel].BytesPerCenter;
        const bytesPerScale = SplatBuffer.CompressionLevels[compressionLevel].BytesPerScale;
        const bytesPerRotation = SplatBuffer.CompressionLevels[compressionLevel].BytesPerRotation;
        const bytesPerColor = SplatBuffer.CompressionLevels[compressionLevel].BytesPerColor;
        const sphericalHarmonicsComponentsPerSplat = getSphericalHarmonicsComponentCountForDegree(sphericalHarmonicsDegree);
        const sphericalHarmonicsBytesPerSplat = SplatBuffer.CompressionLevels[compressionLevel].BytesPerSphericalHarmonicsComponent *
                                                sphericalHarmonicsComponentsPerSplat;
        const bytesPerSplat = bytesPerCenter + bytesPerScale + bytesPerRotation +
                              bytesPerColor + sphericalHarmonicsBytesPerSplat;
        return {
            bytesPerCenter,
            bytesPerScale,
            bytesPerRotation,
            bytesPerColor,
            sphericalHarmonicsComponentsPerSplat,
            sphericalHarmonicsBytesPerSplat,
            bytesPerSplat
        };
    }

    linkBufferArrays() {
        for (let i = 0; i < this.maxSectionCount; i++) {
            const section = this.sections[i];
            section.bucketArray = new Float32Array(this.bufferData, section.bucketsBase,
                                                   section.bucketCount * SplatBuffer.BucketStorageSizeFloats);
            if (section.partiallyFilledBucketCount > 0) {
                section.partiallyFilledBucketLengths = new Uint32Array(this.bufferData, section.base,
                                                                       section.partiallyFilledBucketCount);
            }
        }
    }

    buildMaps() {
        let cumulativeSplatCount = 0;
        for (let i = 0; i < this.maxSectionCount; i++) {
            const section = this.sections[i];
            for (let j = 0; j < section.maxSplatCount; j++) {
                const globalSplatIndex = cumulativeSplatCount + j;
                this.globalSplatIndexToLocalSplatIndexMap[globalSplatIndex] = j;
                this.globalSplatIndexToSectionMap[globalSplatIndex] = i;
            }
            cumulativeSplatCount += section.maxSplatCount;
        }
    }

    updateLoadedCounts(newSectionCount, newSplatCount) {
        SplatBuffer.writeHeaderCountsToBuffer(newSectionCount, newSplatCount, this.bufferData);
        this.sectionCount = newSectionCount;
        this.splatCount = newSplatCount;
    }

    updateSectionLoadedCounts(sectionIndex, newSplatCount) {
        const sectionHeaderOffset = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes * sectionIndex;
        SplatBuffer.writeSectionHeaderSplatCountToBuffer(newSplatCount, this.bufferData, sectionHeaderOffset);
        this.sections[sectionIndex].splatCount = newSplatCount;
    }

    static generateFromUncompressedSplatArrays(splatArrays, minimumAlpha, compressionLevel,
                                               sceneCenter, blockSize, bucketSize, options = []) {

        let sphericalHarmonicsDegree = 0;

        for (let sa = 0; sa < splatArrays.length; sa ++) {
            const splatArray = splatArrays[sa];
            if (sa === 0 || splatArray.sphericalHarmonicsDegree < sphericalHarmonicsDegree) {
                if (sa > 0 && splatArray.sphericalHarmonicsDegree !== sphericalHarmonicsDegree) {
                    const msg = 'SplatBuffer::generateFromUncompressedSplatArrays() -> ' +
                                'all splat arrays must have the same spherical harmonics degree.';
                    throw new Error(msg);
                }
                sphericalHarmonicsDegree = splatArray.sphericalHarmonicsDegree;
            }
        }

        const {bytesPerCenter, bytesPerScale, bytesPerRotation, bytesPerColor, sphericalHarmonicsComponentsPerSplat,
              bytesPerSplat} = SplatBuffer.calculateComponentStorage(compressionLevel, sphericalHarmonicsDegree);

        const compressionScaleRange = SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;

        const sectionBuffers = [];
        const sectionHeaderBuffers = [];
        let totalSplatCount = 0;

        const tempRotation = new THREE.Quaternion();

        for (let sa = 0; sa < splatArrays.length; sa ++) {
            const splatArray = splatArrays[sa];

            const sectionOptions = options[sa] || {};

            const sectionBlockSize = (sectionOptions.blockSizeFactor || 1) * (blockSize || SplatBuffer.BucketBlockSize);
            const sectionBucketSize = Math.ceil((sectionOptions.bucketSizeFactor || 1) * (bucketSize || SplatBuffer.BucketSize));

            const validSplats = new UncompressedSplatArray(sphericalHarmonicsDegree);

            for (let i = 0; i < splatArray.splatCount; i++) {
                const targetSplat = splatArray.splats[i];
                let alpha;
                if (targetSplat[UncompressedSplatArray.OFFSET.OPACITY]) {
                    alpha = targetSplat[UncompressedSplatArray.OFFSET.OPACITY];
                } else {
                    alpha = 255;
                }
                if (alpha >= minimumAlpha) {
                    validSplats.addSplat(targetSplat);
                }
            }

            const bucketInfo = SplatBuffer.computeBucketsForUncompressedSplatArray(validSplats, sectionBlockSize, sectionBucketSize);
            const fullBucketCount = bucketInfo.fullBuckets.length;
            const partiallyFullBucketLengths = bucketInfo.partiallyFullBuckets.map((bucket) => bucket.splats.length);
            const partiallyFilledBucketCount = partiallyFullBucketLengths.length;
            const buckets = [...bucketInfo.fullBuckets, ...bucketInfo.partiallyFullBuckets];

            const sectionDataSizeBytes = validSplats.splats.length * bytesPerSplat;
            const bucketMetaDataSizeBytes = partiallyFilledBucketCount * 4;
            const bucketDataBytes = compressionLevel >= 1 ? buckets.length *
                                                            SplatBuffer.BucketStorageSizeBytes + bucketMetaDataSizeBytes : 0;
            const sectionSizeBytes = sectionDataSizeBytes + bucketDataBytes;
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
                    const targetSplat = validSplats.splats[row];

                    const centerBase = bucketDataBytes + outSplatCount * bytesPerSplat;
                    const scaleBase = centerBase + bytesPerCenter;
                    const rotationBase = scaleBase + bytesPerScale;
                    const colorBase = rotationBase + bytesPerRotation;
                    const sphericalHarmonicsBase = colorBase + bytesPerColor;
                    if (compressionLevel === 0) {
                        const center = new Float32Array(sectionBuffer, centerBase, SplatBuffer.CenterComponentCount);
                        const rot = new Float32Array(sectionBuffer, rotationBase, SplatBuffer.RotationComponentCount);
                        const scale = new Float32Array(sectionBuffer, scaleBase, SplatBuffer.ScaleComponentCount);
                        if (targetSplat[UncompressedSplatArray.OFFSET.SCALE0] !== undefined) {
                            tempRotation.set(targetSplat[UncompressedSplatArray.OFFSET.ROTATION0],
                                             targetSplat[UncompressedSplatArray.OFFSET.ROTATION1],
                                             targetSplat[UncompressedSplatArray.OFFSET.ROTATION2],
                                             targetSplat[UncompressedSplatArray.OFFSET.ROTATION3]);
                            tempRotation.normalize();
                            rot.set([tempRotation.x, tempRotation.y, tempRotation.z, tempRotation.w]);
                            scale.set([targetSplat[UncompressedSplatArray.OFFSET.SCALE0],
                                       targetSplat[UncompressedSplatArray.OFFSET.SCALE1],
                                       targetSplat[UncompressedSplatArray.OFFSET.SCALE2]]);
                        } else {
                            rot.set([1.0, 0.0, 0.0, 0.0]);
                            scale.set([0.01, 0.01, 0.01]);
                        }
                        center.set([targetSplat[UncompressedSplatArray.OFFSET.X],
                                    targetSplat[UncompressedSplatArray.OFFSET.Y],
                                    targetSplat[UncompressedSplatArray.OFFSET.Z]]);
                        if (sphericalHarmonicsDegree > 0) {
                           const sphericalHarmonics = new Float32Array(sectionBuffer, sphericalHarmonicsBase,
                                                                       sphericalHarmonicsComponentsPerSplat);
                           if (sphericalHarmonicsDegree >= 1) {
                                for (let s = 0; s < 9; s++) {
                                    sphericalHarmonics[s] = targetSplat[UncompressedSplatArray.OFFSET.FRC0 + s];
                                }
                                if (sphericalHarmonicsDegree >= 2) {
                                    for (let s = 0; s < 15; s++) {
                                        sphericalHarmonics[s + 9] = targetSplat[UncompressedSplatArray.OFFSET.FRC9 + s];
                                    }
                                }
                           }
                        }
                    } else {
                        const center = new Uint16Array(sectionBuffer, centerBase, SplatBuffer.CenterComponentCount);
                        const rot = new Uint16Array(sectionBuffer, rotationBase, SplatBuffer.RotationComponentCount);
                        const scale = new Uint16Array(sectionBuffer, scaleBase, SplatBuffer.ScaleComponentCount);

                        if (targetSplat[UncompressedSplatArray.OFFSET.SCALE0] !== undefined) {
                            tempRotation.set(targetSplat[UncompressedSplatArray.OFFSET.ROTATION0],
                                             targetSplat[UncompressedSplatArray.OFFSET.ROTATION1],
                                             targetSplat[UncompressedSplatArray.OFFSET.ROTATION2],
                                             targetSplat[UncompressedSplatArray.OFFSET.ROTATION3]);
                            tempRotation.normalize();
                            rot.set([toHalfFloat(tempRotation.x), toHalfFloat(tempRotation.y),
                                     toHalfFloat(tempRotation.z), toHalfFloat(tempRotation.w)]);
                            scale.set([toHalfFloat(targetSplat[UncompressedSplatArray.OFFSET.SCALE0]),
                                       toHalfFloat(targetSplat[UncompressedSplatArray.OFFSET.SCALE1]),
                                       toHalfFloat(targetSplat[UncompressedSplatArray.OFFSET.SCALE2])]);
                        } else {
                            rot.set([toHalfFloat(1.), 0, 0, 0]);
                            scale.set([toHalfFloat(0.01), toHalfFloat(0.01), toHalfFloat(0.01)]);
                        }
                        bucketCenterDelta.set(targetSplat[UncompressedSplatArray.OFFSET.X],
                                              targetSplat[UncompressedSplatArray.OFFSET.Y],
                                              targetSplat[UncompressedSplatArray.OFFSET.Z]).sub(bucketCenter);
                        bucketCenterDelta.x = Math.round(bucketCenterDelta.x * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.x = clamp(bucketCenterDelta.x, 0, doubleCompressionScaleRange);
                        bucketCenterDelta.y = Math.round(bucketCenterDelta.y * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.y = clamp(bucketCenterDelta.y, 0, doubleCompressionScaleRange);
                        bucketCenterDelta.z = Math.round(bucketCenterDelta.z * compressionScaleFactor) + compressionScaleRange;
                        bucketCenterDelta.z = clamp(bucketCenterDelta.z, 0, doubleCompressionScaleRange);
                        center.set([bucketCenterDelta.x, bucketCenterDelta.y, bucketCenterDelta.z]);
                        if (sphericalHarmonicsDegree > 0) {
                            const SphericalHarmonicsArrayType = compressionLevel === 1 ? Uint16Array : Uint8Array;
                            const sphericalHarmonics = new SphericalHarmonicsArrayType(sectionBuffer, sphericalHarmonicsBase,
                                                                                       sphericalHarmonicsComponentsPerSplat);
                            if (sphericalHarmonicsDegree >= 1) {
                                for (let s = 0; s < 9; s++) {
                                    if (compressionLevel === 1) {
                                        sphericalHarmonics[s] = toHalfFloat(targetSplat[UncompressedSplatArray.OFFSET.FRC0 + s]);
                                    } else {
                                        sphericalHarmonics[s] = toUint8(targetSplat[UncompressedSplatArray.OFFSET.FRC0 + s]);
                                    }
                                }
                                if (sphericalHarmonicsDegree >= 2) {
                                    for (let s = 0; s < 15; s++) {
                                        if (compressionLevel === 1) {
                                            sphericalHarmonics[s + 9] = toHalfFloat(targetSplat[UncompressedSplatArray.OFFSET.FRC9 + s]);
                                        } else {
                                            sphericalHarmonics[s + 9] = toUint8(targetSplat[UncompressedSplatArray.OFFSET.FRC9 + s]);
                                        }
                                    }
                                }
                            }
                         }
                    }

                    const rgba = new Uint8ClampedArray(sectionBuffer, colorBase, 4);

                    if (targetSplat[UncompressedSplatArray.OFFSET.FDC0] !== undefined) {
                        rgba.set([targetSplat[UncompressedSplatArray.OFFSET.FDC0],
                                  targetSplat[UncompressedSplatArray.OFFSET.FDC1],
                                  targetSplat[UncompressedSplatArray.OFFSET.FDC2]]);
                    } else {
                        rgba.set([255, 0, 0]);
                    }
                    if (targetSplat[UncompressedSplatArray.OFFSET.OPACITY] !== undefined) {
                        rgba[3] = targetSplat[UncompressedSplatArray.OFFSET.OPACITY];
                    } else {
                        rgba[3] = 255;
                    }

                    outSplatCount++;
                }
            }
            totalSplatCount += outSplatCount;

            if (compressionLevel >= 1) {
                const bucketMetaDataArray = new Uint32Array(sectionBuffer, 0, partiallyFullBucketLengths.length * 4);
                for (let pfb = 0; pfb < partiallyFullBucketLengths.length; pfb ++) {
                    bucketMetaDataArray[pfb] = partiallyFullBucketLengths[pfb];
                }
                const bucketArray = new Float32Array(sectionBuffer, bucketMetaDataSizeBytes,
                                                     buckets.length * SplatBuffer.BucketStorageSizeFloats);
                for (let b = 0; b < buckets.length; b++) {
                    const bucket = buckets[b];
                    const base = b * 3;
                    bucketArray[base] = bucket.center[0];
                    bucketArray[base + 1] = bucket.center[1];
                    bucketArray[base + 2] = bucket.center[2];
                }
            }
            sectionBuffers.push(sectionBuffer);

            const sectionHeaderBuffer = new ArrayBuffer(SplatBuffer.SectionHeaderSizeBytes);
            SplatBuffer.writeSectionHeaderToBuffer({
                maxSplatCount: outSplatCount,
                splatCount: outSplatCount,
                bucketSize: sectionBucketSize,
                bucketCount: buckets.length,
                bucketBlockSize: sectionBlockSize,
                compressionScaleRange: compressionScaleRange,
                storageSizeBytes: sectionSizeBytes,
                fullBucketCount: fullBucketCount,
                partiallyFilledBucketCount: partiallyFilledBucketCount
            }, compressionLevel, sectionHeaderBuffer, 0);
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
            compressionLevel: compressionLevel,
            sceneCenter: sceneCenter,
            sphericalHarmonicsDegree: sphericalHarmonicsDegree
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

        for (let i = 0; i < splatCount; i++) {
            const targetSplat = splatArray.splats[i];
            const center = [targetSplat[UncompressedSplatArray.OFFSET.X],
                            targetSplat[UncompressedSplatArray.OFFSET.Y],
                            targetSplat[UncompressedSplatArray.OFFSET.Z]];
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

        for (let i = 0; i < splatCount; i++) {
            const targetSplat = splatArray.splats[i];
            const center = [targetSplat[UncompressedSplatArray.OFFSET.X],
                            targetSplat[UncompressedSplatArray.OFFSET.Y],
                            targetSplat[UncompressedSplatArray.OFFSET.Z]];
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

        const partiallyFullBucketArray = [];
        for (let bucketId in partiallyFullBuckets) {
            if (partiallyFullBuckets.hasOwnProperty(bucketId)) {
                const bucket = partiallyFullBuckets[bucketId];
                if (bucket) {
                    partiallyFullBucketArray.push(bucket);
                }
            }
        }

        return {
            'fullBuckets': fullBuckets,
            'partiallyFullBuckets': partiallyFullBucketArray,
        };
    }

}
