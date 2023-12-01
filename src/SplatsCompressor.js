import * as THREE from 'three';
import { SplatBuffer } from './SplatBuffer.js';
import { clamp } from './Util.js';

const SplatBufferBucketSize = 256;
const SplatBufferBucketBlockSize = 5.0;

export class SplatsCompressor {

    constructor(compressionLevel = 0, minimumAlpha = 1, bucketSize = SplatBufferBucketSize, blockSize = SplatBufferBucketBlockSize) {
        this.compressionLevel = compressionLevel;
        this.minimumAlpha = minimumAlpha;
        this.bucketSize = bucketSize;
        this.blockSize = blockSize;
    }

    uncompressedSplatArrayToSplatBuffer(splatArray) {
        const splatZeroSrc = splatArray[0];
        const splatZero = {};
        for (let splatProperty in splatZeroSrc) {
            if (splatZeroSrc.hasOwnProperty(splatProperty)) {
                splatZero[splatProperty] = 0;
            }
        }

        const validSplats = [splatZero];

        for (let i = 0; i < splatArray.length; i++) {
            let splat = splatArray[i];
            let alpha;
            if (splat['opacity']) {
                alpha = (1 / (1 + Math.exp(-splat.opacity))) * 255;
            } else {
                alpha = 255;
            }
            if (alpha >= this.minimumAlpha) {
                validSplats.push(splat);
            }
        }

        const buckets = this.computeBucketsForUncompressedSplatArray(validSplats);

        const paddedSplatCount = buckets.length * this.bucketSize;
        const headerSize = SplatBuffer.HeaderSizeBytes;
        const header = new Uint8Array(new ArrayBuffer(headerSize));
        header[3] = this.compressionLevel;
        (new Uint32Array(header.buffer, 4, 1))[0] = paddedSplatCount;

        let bytesPerCenter = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerCenter;
        let bytesPerScale = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerScale;
        let bytesPerColor = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerColor;
        let bytesPerRotation = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerRotation;
        const centerBuffer = new ArrayBuffer(bytesPerCenter * paddedSplatCount);
        const scaleBuffer = new ArrayBuffer(bytesPerScale * paddedSplatCount);
        const colorBuffer = new ArrayBuffer(bytesPerColor * paddedSplatCount);
        const rotationBuffer = new ArrayBuffer(bytesPerRotation * paddedSplatCount);

        const blockHalfSize = this.blockSize / 2.0;
        const compressionScaleRange = SplatBuffer.CompressionLevels[this.compressionLevel].ScaleRange;
        const compressionScaleFactor = compressionScaleRange / blockHalfSize;
        const doubleCompressionScaleRange = compressionScaleRange * 2 + 1;

        const bucketCenter = new THREE.Vector3();
        const bucketCenterDelta = new THREE.Vector3();
        let outSplatIndex = 0;
        for (let b = 0; b < buckets.length; b++) {
            const bucket = buckets[b];
            bucketCenter.fromArray(bucket.center);
            for (let i = 0; i < bucket.splats.length; i++) {
                let row = bucket.splats[i];
                let invalidSplat = false;
                if (row === 0) {
                    invalidSplat = true;
                }
                let splat = validSplats[row];

                if (this.compressionLevel === 0) {
                    const center = new Float32Array(centerBuffer, outSplatIndex * bytesPerCenter, 3);
                    const scales = new Float32Array(scaleBuffer, outSplatIndex * bytesPerScale, 3);
                    const rot = new Float32Array(rotationBuffer, outSplatIndex * bytesPerRotation, 4);
                    if (splat['scale_0'] !== undefined) {
                        const quat = new THREE.Quaternion(splat.rot_1, splat.rot_2, splat.rot_3, splat.rot_0);
                        quat.normalize();
                        rot.set([quat.w, quat.x, quat.y, quat.z]);
                        scales.set([Math.exp(splat.scale_0), Math.exp(splat.scale_1), Math.exp(splat.scale_2)]);
                    } else {
                        scales.set([0.01, 0.01, 0.01]);
                        rot.set([1.0, 0.0, 0.0, 0.0]);
                    }
                    center.set([splat.x, splat.y, splat.z]);
                } else {
                    const center = new Uint16Array(centerBuffer, outSplatIndex * bytesPerCenter, 3);
                    const scales = new Uint16Array(scaleBuffer, outSplatIndex * bytesPerScale, 3);
                    const rot = new Uint16Array(rotationBuffer, outSplatIndex * bytesPerRotation, 4);
                    const thf = THREE.DataUtils.toHalfFloat.bind(THREE.DataUtils);
                    if (splat['scale_0'] !== undefined) {
                        const quat = new THREE.Quaternion(splat.rot_1, splat.rot_2, splat.rot_3, splat.rot_0);
                        quat.normalize();
                        rot.set([thf(quat.w), thf(quat.x), thf(quat.y), thf(quat.z)]);
                        scales.set([thf(Math.exp(splat.scale_0)), thf(Math.exp(splat.scale_1)), thf(Math.exp(splat.scale_2))]);
                    } else {
                        scales.set([thf(0.01), thf(0.01), thf(0.01)]);
                        rot.set([thf(1.), 0, 0, 0]);
                    }
                    bucketCenterDelta.set(splat.x, splat.y, splat.z).sub(bucketCenter);
                    bucketCenterDelta.x = Math.round(bucketCenterDelta.x * compressionScaleFactor) + compressionScaleRange;
                    bucketCenterDelta.x = clamp(bucketCenterDelta.x, 0, doubleCompressionScaleRange);
                    bucketCenterDelta.y = Math.round(bucketCenterDelta.y * compressionScaleFactor) + compressionScaleRange;
                    bucketCenterDelta.y = clamp(bucketCenterDelta.y, 0, doubleCompressionScaleRange);
                    bucketCenterDelta.z = Math.round(bucketCenterDelta.z * compressionScaleFactor) + compressionScaleRange;
                    bucketCenterDelta.z = clamp(bucketCenterDelta.z, 0, doubleCompressionScaleRange);
                    center.set([bucketCenterDelta.x, bucketCenterDelta.y, bucketCenterDelta.z]);
                }

                const rgba = new Uint8ClampedArray(colorBuffer, outSplatIndex * bytesPerColor, 4);
                if (invalidSplat) {
                    rgba[0] = 255;
                    rgba[1] = 0;
                    rgba[2] = 0;
                    rgba[3] = 0;
                } else {
                    if (splat['f_dc_0'] !== undefined) {
                        const SH_C0 = 0.28209479177387814;
                        rgba.set([(0.5 + SH_C0 * splat.f_dc_0) * 255,
                                (0.5 + SH_C0 * splat.f_dc_1) * 255,
                                (0.5 + SH_C0 * splat.f_dc_2) * 255]);
                    } else {
                        rgba.set([255, 0, 0]);
                    }
                    if (splat['opacity'] !== undefined) {
                        rgba[3] = (1 / (1 + Math.exp(-splat.opacity))) * 255;
                    } else {
                        rgba[3] = 255;
                    }
                }

                outSplatIndex++;
            }
        }

        const bytesPerBucket = 12;
        const bucketsSize = bytesPerBucket * buckets.length;
        const splatDataBufferSize = centerBuffer.byteLength + scaleBuffer.byteLength +
                                    colorBuffer.byteLength + rotationBuffer.byteLength;

        const headerArrayUint32 = new Uint32Array(header.buffer);
        const headerArrayFloat32 = new Float32Array(header.buffer);
        let unifiedBufferSize = headerSize + splatDataBufferSize;
        if (this.compressionLevel > 0) {
            unifiedBufferSize += bucketsSize;
            headerArrayUint32[2] = this.bucketSize;
            headerArrayUint32[3] = buckets.length;
            headerArrayFloat32[4] = this.blockSize;
            headerArrayUint32[5] = bytesPerBucket;
            headerArrayUint32[6] = SplatBuffer.CompressionLevels[this.compressionLevel].ScaleRange;
        }

        const unifiedBuffer = new ArrayBuffer(unifiedBufferSize);
        new Uint8Array(unifiedBuffer, 0, headerSize).set(header);
        new Uint8Array(unifiedBuffer, headerSize, centerBuffer.byteLength).set(new Uint8Array(centerBuffer));
        new Uint8Array(unifiedBuffer, headerSize + centerBuffer.byteLength, scaleBuffer.byteLength).set(new Uint8Array(scaleBuffer));
        new Uint8Array(unifiedBuffer, headerSize + centerBuffer.byteLength + scaleBuffer.byteLength,
                    colorBuffer.byteLength).set(new Uint8Array(colorBuffer));
        new Uint8Array(unifiedBuffer, headerSize + centerBuffer.byteLength + scaleBuffer.byteLength + colorBuffer.byteLength,
                    rotationBuffer.byteLength).set(new Uint8Array(rotationBuffer));

        if (this.compressionLevel > 0) {
            const bucketArray = new Float32Array(unifiedBuffer, headerSize + splatDataBufferSize, buckets.length * 3);
            for (let i = 0; i < buckets.length; i++) {
                const bucket = buckets[i];
                const base = i * 3;
                bucketArray[base] = bucket.center[0];
                bucketArray[base + 1] = bucket.center[1];
                bucketArray[base + 2] = bucket.center[2];
            }
        }

        const splatBuffer = new SplatBuffer(unifiedBuffer);
        return splatBuffer;
    }

    computeBucketsForUncompressedSplatArray(splatArray) {
        let splatCount = splatArray.length;
        const blockSize = this.blockSize;
        const halfBlockSize = blockSize / 2.0;

        const min = new THREE.Vector3();
        const max = new THREE.Vector3();

        // ignore the first splat since it's the invalid designator
        for (let i = 1; i < splatCount; i++) {
            const splat = splatArray[i];
            const center = [splat['x'], splat['y'], splat['z']];
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
            const splat = splatArray[i];
            const center = [splat['x'], splat['y'], splat['z']];
            const xBlock = Math.ceil((center[0] - min.x) / blockSize);
            const yBlock = Math.ceil((center[1] - min.y) / blockSize);
            const zBlock = Math.ceil((center[2] - min.z) / blockSize);

            blockCenter.x = (xBlock - 1) * blockSize + min.x + halfBlockSize;
            blockCenter.y = (yBlock - 1) * blockSize + min.y + halfBlockSize;
            blockCenter.z = (zBlock - 1) * blockSize + min.z + halfBlockSize;

            const bucketId = xBlock * (yBlocks * zBlocks) + yBlock * zBlocks + zBlock;
            let bucket = partiallyFullBuckets[bucketId];
            if (!bucket) {
                partiallyFullBuckets[bucketId] = bucket = {
                    'splats': [],
                    'center': blockCenter.toArray()
                };
            }

            bucket.splats.push(i);
            if (bucket.splats.length >= this.bucketSize) {
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
                    while (bucket.splats.length < this.bucketSize) {
                        bucket.splats.push(0);
                    }
                    fullBuckets.push(bucket);
                }
            }
        }

        return fullBuckets;
    }
}
