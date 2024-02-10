import * as THREE from 'three';
import { SplatBuffer } from './SplatBuffer.js';
import { UncompressedSplatArray } from './UncompressedSplatArray.js';
import { clamp } from '../Util.js';

const SplatBufferBucketSize = 256;
const SplatBufferBucketBlockSize = 5.0;

export class SplatCompressor {

    constructor(minimumAlpha = 1, compressionLevel = 0) {
        this.minimumAlpha = minimumAlpha;
        this.compressionLevel = compressionLevel;
    }

    static createEmptyUncompressedSplatArray() {
        return new UncompressedSplatArray();
    }

    uncompressedSplatArraysToSplatBuffer(splatArrays, blockSize, bucketSize, options = []) {

        const compressionLevel = this.compressionLevel;
        const bytesPerCenter = SplatBuffer.CompressionLevels[compressionLevel].BytesPerCenter;
        const bytesPerScale = SplatBuffer.CompressionLevels[compressionLevel].BytesPerScale;
        const bytesPerColor = SplatBuffer.CompressionLevels[compressionLevel].BytesPerColor;
        const bytesPerRotation = SplatBuffer.CompressionLevels[compressionLevel].BytesPerRotation;
        const compressionScaleRange = SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;

        const sectionBuffers = [];
        const sectionHeaderBuffers = [];
        let totalSplatCount = 0;

        for (let i = 0; i < splatArrays.length; i ++) {
            const splatArray = splatArrays[i];

            const sectionOptions = options[i] || {};

            const sectionBlockSize = (sectionOptions.blockSizeFactor || 1) * (blockSize || SplatBufferBucketBlockSize);
            const sectionBucketSize = Math.ceil((sectionOptions.bucketSizeFactor || 1) * (bucketSize || SplatBufferBucketSize));

            const validSplats = SplatCompressor.createEmptyUncompressedSplatArray();
            validSplats.addSplat(0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);

            for (let i = 0; i < splatArray.splatCount; i++) {
                let alpha;
                if (splatArray['opacity'][i]) {
                    alpha = splatArray['opacity'][i];
                } else {
                    alpha = 255;
                }
                if (alpha >= this.minimumAlpha) {
                    validSplats.addSplat(splatArray['x'][i], splatArray['y'][i], splatArray['z'][i],
                                        splatArray['scale_0'][i], splatArray['scale_1'][i], splatArray['scale_2'][i],
                                        splatArray['rot_0'][i], splatArray['rot_1'][i], splatArray['rot_2'][i], splatArray['rot_3'][i],
                                        splatArray['f_dc_0'][i], splatArray['f_dc_1'][i], splatArray['f_dc_2'][i], splatArray['opacity'][i]);
                }
            }

            const buckets = SplatCompressor.computeBucketsForUncompressedSplatArray(validSplats, sectionBlockSize, sectionBucketSize);

            const paddedSplatCount = buckets.length * sectionBucketSize;

            const centerBuffer = new ArrayBuffer(bytesPerCenter * paddedSplatCount);
            const scaleBuffer = new ArrayBuffer(bytesPerScale * paddedSplatCount);
            const colorBuffer = new ArrayBuffer(bytesPerColor * paddedSplatCount);
            const rotationBuffer = new ArrayBuffer(bytesPerRotation * paddedSplatCount);

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
                        const center = new Float32Array(centerBuffer, outSplatCount * bytesPerCenter, 3);
                        const scale = new Float32Array(scaleBuffer, outSplatCount * bytesPerScale, 3);
                        const rot = new Float32Array(rotationBuffer, outSplatCount * bytesPerRotation, 4);
                        if (validSplats['scale_0'][row] !== undefined) {
                            const quat = new THREE.Quaternion(validSplats['rot_1'][row], validSplats['rot_2'][row],
                                                            validSplats['rot_3'][row], validSplats['rot_0'][row]);
                            quat.normalize();
                            rot.set([quat.w, quat.x, quat.y, quat.z]);
                            scale.set([validSplats['scale_0'][row], validSplats['scale_1'][row], validSplats['scale_2'][row]]);
                        } else {
                            scale.set([0.01, 0.01, 0.01]);
                            rot.set([1.0, 0.0, 0.0, 0.0]);
                        }
                        center.set([validSplats['x'][row], validSplats['y'][row], validSplats['z'][row]]);
                    } else {
                        const center = new Uint16Array(centerBuffer, outSplatCount * bytesPerCenter, 3);
                        const scale = new Uint16Array(scaleBuffer, outSplatCount * bytesPerScale, 3);
                        const rot = new Uint16Array(rotationBuffer, outSplatCount * bytesPerRotation, 4);
                        const thf = THREE.DataUtils.toHalfFloat.bind(THREE.DataUtils);
                        if (validSplats['scale_0'][row] !== undefined) {
                            const quat = new THREE.Quaternion(validSplats['rot_1'][row], validSplats['rot_2'][row],
                                                            validSplats['rot_3'][row], validSplats['rot_0'][row]);
                            quat.normalize();
                            rot.set([thf(quat.w), thf(quat.x), thf(quat.y), thf(quat.z)]);
                            scale.set([thf(validSplats['scale_0'][row]), thf(validSplats['scale_1'][row]), thf(validSplats['scale_2'][row])]);
                        } else {
                            scale.set([thf(0.01), thf(0.01), thf(0.01)]);
                            rot.set([thf(1.), 0, 0, 0]);
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

            const splatDataSizeBytes = centerBuffer.byteLength + scaleBuffer.byteLength + colorBuffer.byteLength + rotationBuffer.byteLength;
            const sectionSizeBytes = compressionLevel > 0 ? splatDataSizeBytes + buckets.length * SplatBuffer.BucketDescriptorSizeBytes : splatDataSizeBytes;
            const sectionBuffer = new ArrayBuffer(sectionSizeBytes);

            new Uint8Array(sectionBuffer, 0, centerBuffer.byteLength).set(new Uint8Array(centerBuffer));
            new Uint8Array(sectionBuffer, centerBuffer.byteLength, scaleBuffer.byteLength).set(new Uint8Array(scaleBuffer));
            new Uint8Array(sectionBuffer, centerBuffer.byteLength + scaleBuffer.byteLength,
                           colorBuffer.byteLength).set(new Uint8Array(colorBuffer));
            new Uint8Array(sectionBuffer, centerBuffer.byteLength + scaleBuffer.byteLength + colorBuffer.byteLength,
                           rotationBuffer.byteLength).set(new Uint8Array(rotationBuffer));
    
            if (compressionLevel > 0) {
                const bucketArray = new Float32Array(sectionBuffer, splatDataSizeBytes, buckets.length * SplatBuffer.BucketDescriptorSizeFloats);
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
            sectionHeadeArrayUint16[8] = compressionLevel > 0 ? SplatBuffer.BucketDescriptorSizeBytes : 0;
            sectionHeadeArrayUint32[10] = compressionLevel > 0 ? compressionScaleRange : 0;

            sectionHeaderBuffers.push(sectionHeaderBuffer);

        }

        let sectionsCumulativeSizeBytes = 0;
        for (let sectionBuffer of sectionBuffers) sectionsCumulativeSizeBytes += sectionBuffer.byteLength;
        const unifiedBufferSize = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes * sectionBuffers.length + sectionsCumulativeSizeBytes;
        const unifiedBuffer = new ArrayBuffer(unifiedBufferSize);

        const headerArrayUint8 = new Uint8Array(unifiedBuffer);
        const headerArrayUint32 = new Uint32Array(unifiedBuffer);
        headerArrayUint8[0] = 0;
        headerArrayUint8[1] = 1;
        headerArrayUint8[2] = 0;
        headerArrayUint8[3] = sectionBuffers.length;
        headerArrayUint32[1] = totalSplatCount;
        headerArrayUint32[2] = compressionLevel;

        let currentUnifiedBase = SplatBuffer.HeaderSizeBytes;
        for (let sectionHeaderBuffer of sectionHeaderBuffers) {
            const sectionBuffer32Array = new Uint32Array(unifiedBuffer, currentUnifiedBase, SplatBuffer.SectionHeaderSizeBytes / 4);
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
