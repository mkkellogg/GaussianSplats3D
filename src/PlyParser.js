import { SplatBuffer } from './SplatBuffer.js';
import { clamp } from './Util.js';
import * as THREE from 'three';

const SplatBufferBucketSize = 256;
const SplatBufferBucketBlockSize = 5.0;

export class PlyParser {

    constructor(plyBuffer) {
        this.plyBuffer = plyBuffer;
    }

    decodeHeader(plyBuffer) {
        const decoder = new TextDecoder();
        let headerOffset = 0;
        let headerText = '';

        console.log('.PLY size: ' + plyBuffer.byteLength + ' bytes');

        const readChunkSize = 100;

        while (true) {
            if (headerOffset + readChunkSize >= plyBuffer.byteLength) {
                throw new Error('End of file reached while searching for end of header');
            }
            const headerChunk = new Uint8Array(plyBuffer, headerOffset, readChunkSize);
            headerText += decoder.decode(headerChunk);
            headerOffset += readChunkSize;

            const endHeaderTestChunk = new Uint8Array(plyBuffer, Math.max(0, headerOffset - readChunkSize * 2), readChunkSize * 2);
            const endHeaderTestText = decoder.decode(endHeaderTestChunk);
            if (endHeaderTestText.includes('end_header')) {
                break;
            }
        }

        const headerLines = headerText.split('\n');

        let splatCount = 0;
        let propertyTypes = {};

        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            if (line.startsWith('element vertex')) {
                const splatCountMatch = line.match(/\d+/);
                if (splatCountMatch) {
                    splatCount = parseInt(splatCountMatch[0]);
                }
            } else if (line.startsWith('property')) {
                const propertyMatch = line.match(/(\w+)\s+(\w+)\s+(\w+)/);
                if (propertyMatch) {
                    const propertyType = propertyMatch[2];
                    const propertyName = propertyMatch[3];
                    propertyTypes[propertyName] = propertyType;
                }
            } else if (line === 'end_header') {
                break;
            }
        }

        const vertexByteOffset = headerText.indexOf('end_header') + 'end_header'.length + 1;
        const vertexData = new DataView(plyBuffer, vertexByteOffset);

        return {
            'splatCount': splatCount,
            'propertyTypes': propertyTypes,
            'vertexData': vertexData,
            'headerOffset': headerOffset
        };
    }

    readRawVertexFast(vertexData, offset, fieldOffsets, propertiesToRead, propertyTypes, outVertex) {
        let rawVertex = outVertex || {};
        for (let property of propertiesToRead) {
            const propertyType = propertyTypes[property];
            if (propertyType === 'float') {
                rawVertex[property] = vertexData.getFloat32(offset + fieldOffsets[property], true);
            } else if (propertyType === 'uchar') {
                rawVertex[property] = vertexData.getUint8(offset + fieldOffsets[property]) / 255.0;
            }
        }
    }

    parseToSplatBuffer(compressionLevel = 0, minimumAlpha = 1) {

        const startTime = performance.now();

        console.log('Parsing PLY to SPLAT...');

        const {splatCount, propertyTypes, vertexData} = this.decodeHeader(this.plyBuffer);

        // figure out the SH degree from the number of coefficients
        let nRestCoeffs = 0;
        for (const propertyName in propertyTypes) {
            if (propertyName.startsWith('f_rest_')) {
                nRestCoeffs += 1;
            }
        }
        const nCoeffsPerColor = nRestCoeffs / 3;

        // TODO: Eventually properly support multiple degree spherical harmonics
        // const sphericalHarmonicsDegree = Math.sqrt(nCoeffsPerColor + 1) - 1;
        const sphericalHarmonicsDegree = 0;

        console.log('Detected degree', sphericalHarmonicsDegree, 'with ', nCoeffsPerColor, 'coefficients per color');

        // figure out the order in which spherical harmonics should be read
        const shFeatureOrder = [];
        for (let rgb = 0; rgb < 3; ++rgb) {
            shFeatureOrder.push(`f_dc_${rgb}`);
        }
        for (let i = 0; i < nCoeffsPerColor; ++i) {
            for (let rgb = 0; rgb < 3; ++rgb) {
                shFeatureOrder.push(`f_rest_${rgb * nCoeffsPerColor + i}`);
            }
        }

        let plyRowSize = 0;
        let fieldOffsets = {};
        const fieldSize = {
            'double': 8,
            'int': 4,
            'uint': 4,
            'float': 4,
            'short': 2,
            'ushort': 2,
            'uchar': 1,
        };
        for (let fieldName in propertyTypes) {
            if (propertyTypes.hasOwnProperty(fieldName)) {
                const type = propertyTypes[fieldName];
                fieldOffsets[fieldName] = plyRowSize;
                plyRowSize += fieldSize[type];
            }
        }

        let rawVertex = {};

        const propertiesToRead = ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
                                  'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];

        const validVertexes = [];
        // dummy vertex used for invalid vertexes
        const vertexZero = {};
        for (let propertyToRead of propertiesToRead) vertexZero[propertyToRead] = 0;
        validVertexes.push(vertexZero);
        for (let row = 0; row < splatCount; row++) {
            this.readRawVertexFast(vertexData, row * plyRowSize, fieldOffsets, propertiesToRead, propertyTypes, rawVertex);
            let alpha;
            if (propertyTypes['opacity']) {
                alpha = (1 / (1 + Math.exp(-rawVertex.opacity))) * 255;
            } else {
                alpha = 255;
            }
            if (alpha > minimumAlpha) {
                const newVertex = {};
                for (let propertyToRead of propertiesToRead) newVertex[propertyToRead] = rawVertex[propertyToRead];
                validVertexes.push(newVertex);
            }
        }

        console.log('Total valid splats: ', validVertexes.length, 'out of', splatCount);

        const positionsForBucketCalcs = [];
        for (let row = 0; row < validVertexes.length; row++) {
            rawVertex = validVertexes[row];
            positionsForBucketCalcs.push([rawVertex.x, rawVertex.y, rawVertex.z]);
        }
        const buckets = this.computeBuckets(positionsForBucketCalcs);

        const paddedSplatCount = buckets.length * SplatBufferBucketSize;
        const headerSize = SplatBuffer.HeaderSizeBytes;
        const header = new Uint8Array(new ArrayBuffer(headerSize));
        header[3] = compressionLevel;
        (new Uint32Array(header.buffer, 4, 1))[0] = paddedSplatCount;

        let bytesPerPosition = SplatBuffer.CompressionLevels[compressionLevel].BytesPerPosition;
        let bytesPerScale = SplatBuffer.CompressionLevels[compressionLevel].BytesPerScale;
        let bytesPerColor = SplatBuffer.CompressionLevels[compressionLevel].BytesPerColor;
        let bytesPerRotation = SplatBuffer.CompressionLevels[compressionLevel].BytesPerRotation;
        const positionBuffer = new ArrayBuffer(bytesPerPosition * paddedSplatCount);
        const scaleBuffer = new ArrayBuffer(bytesPerScale * paddedSplatCount);
        const colorBuffer = new ArrayBuffer(bytesPerColor * paddedSplatCount);
        const rotationBuffer = new ArrayBuffer(bytesPerRotation * paddedSplatCount);

        const blockHalfSize = SplatBufferBucketBlockSize / 2.0;
        const compressionScaleRange = SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;
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
                rawVertex = validVertexes[row];

                if (compressionLevel === 0) {
                    const position = new Float32Array(positionBuffer, outSplatIndex * bytesPerPosition, 3);
                    const scales = new Float32Array(scaleBuffer, outSplatIndex * bytesPerScale, 3);
                    const rot = new Float32Array(rotationBuffer, outSplatIndex * bytesPerRotation, 4);
                    if (propertyTypes['scale_0']) {
                        const quat = new THREE.Quaternion(rawVertex.rot_1, rawVertex.rot_2, rawVertex.rot_3, rawVertex.rot_0);
                        quat.normalize();
                        rot.set([quat.w, quat.x, quat.y, quat.z]);
                        scales.set([Math.exp(rawVertex.scale_0), Math.exp(rawVertex.scale_1), Math.exp(rawVertex.scale_2)]);
                    } else {
                        scales.set([0.01, 0.01, 0.01]);
                        rot.set([1.0, 0.0, 0.0, 0.0]);
                    }
                    position.set([rawVertex.x, rawVertex.y, rawVertex.z]);
                } else {
                    const position = new Uint16Array(positionBuffer, outSplatIndex * bytesPerPosition, 3);
                    const scales = new Uint16Array(scaleBuffer, outSplatIndex * bytesPerScale, 3);
                    const rot = new Uint16Array(rotationBuffer, outSplatIndex * bytesPerRotation, 4);
                    const thf = THREE.DataUtils.toHalfFloat.bind(THREE.DataUtils);
                    if (propertyTypes['scale_0']) {
                        const quat = new THREE.Quaternion(rawVertex.rot_1, rawVertex.rot_2, rawVertex.rot_3, rawVertex.rot_0);
                        quat.normalize();
                        rot.set([thf(quat.w), thf(quat.x), thf(quat.y), thf(quat.z)]);
                        scales.set([thf(Math.exp(rawVertex.scale_0)), thf(Math.exp(rawVertex.scale_1)), thf(Math.exp(rawVertex.scale_2))]);
                    } else {
                        scales.set([thf(0.01), thf(0.01), thf(0.01)]);
                        rot.set([thf(1.), 0, 0, 0]);
                    }
                    bucketCenterDelta.set(rawVertex.x, rawVertex.y, rawVertex.z).sub(bucketCenter);
                    bucketCenterDelta.x = Math.round(bucketCenterDelta.x * compressionScaleFactor) + compressionScaleRange;
                    bucketCenterDelta.x = clamp(bucketCenterDelta.x, 0, doubleCompressionScaleRange);
                    bucketCenterDelta.y = Math.round(bucketCenterDelta.y * compressionScaleFactor) + compressionScaleRange;
                    bucketCenterDelta.y = clamp(bucketCenterDelta.y, 0, doubleCompressionScaleRange);
                    bucketCenterDelta.z = Math.round(bucketCenterDelta.z * compressionScaleFactor) + compressionScaleRange;
                    bucketCenterDelta.z = clamp(bucketCenterDelta.z, 0, doubleCompressionScaleRange);
                    position.set([bucketCenterDelta.x, bucketCenterDelta.y, bucketCenterDelta.z]);
                }

                const rgba = new Uint8ClampedArray(colorBuffer, outSplatIndex * bytesPerColor, 4);
                if (invalidSplat) {
                    rgba[0] = 255;
                    rgba[1] = 0;
                    rgba[2] = 0;
                    rgba[3] = 0;
                } else {
                    if (propertyTypes['f_dc_0']) {
                        const SH_C0 = 0.28209479177387814;
                        rgba.set([(0.5 + SH_C0 * rawVertex.f_dc_0) * 255,
                                  (0.5 + SH_C0 * rawVertex.f_dc_1) * 255,
                                  (0.5 + SH_C0 * rawVertex.f_dc_2) * 255]);
                    } else {
                        rgba.set([255, 0, 0]);
                    }
                    if (propertyTypes['opacity']) {
                        rgba[3] = (1 / (1 + Math.exp(-rawVertex.opacity))) * 255;
                    } else {
                        rgba[3] = 255;
                    }
                }

                outSplatIndex++;
            }
        }

        const bytesPerBucket = 12;
        const bucketsSize = bytesPerBucket * buckets.length;
        const splatDataBufferSize = positionBuffer.byteLength + scaleBuffer.byteLength +
                                    colorBuffer.byteLength + rotationBuffer.byteLength;

        const headerArrayUint32 = new Uint32Array(header.buffer);
        const headerArrayFloat32 = new Float32Array(header.buffer);
        let unifiedBufferSize = headerSize + splatDataBufferSize;
        if (compressionLevel > 0) {
            unifiedBufferSize += bucketsSize;
            headerArrayUint32[2] = SplatBufferBucketSize;
            headerArrayUint32[3] = buckets.length;
            headerArrayFloat32[4] = SplatBufferBucketBlockSize;
            headerArrayUint32[5] = bytesPerBucket;
            headerArrayUint32[6] = SplatBuffer.CompressionLevels[compressionLevel].ScaleRange;
        }

        const unifiedBuffer = new ArrayBuffer(unifiedBufferSize);
        new Uint8Array(unifiedBuffer, 0, headerSize).set(header);
        new Uint8Array(unifiedBuffer, headerSize, positionBuffer.byteLength).set(new Uint8Array(positionBuffer));
        new Uint8Array(unifiedBuffer, headerSize + positionBuffer.byteLength, scaleBuffer.byteLength).set(new Uint8Array(scaleBuffer));
        new Uint8Array(unifiedBuffer, headerSize + positionBuffer.byteLength + scaleBuffer.byteLength,
                       colorBuffer.byteLength).set(new Uint8Array(colorBuffer));
        new Uint8Array(unifiedBuffer, headerSize + positionBuffer.byteLength + scaleBuffer.byteLength + colorBuffer.byteLength,
                       rotationBuffer.byteLength).set(new Uint8Array(rotationBuffer));

        if (compressionLevel > 0) {
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

        const endTime = performance.now();

        console.log('Parsing PLY to SPLAT complete!');
        console.log('Total time: ', (endTime - startTime).toFixed(2) + ' ms');

        return splatBuffer;
    }

    computeBuckets(positions) {
        const blockSize = SplatBufferBucketBlockSize;
        const halfBlockSize = blockSize / 2.0;
        const splatCount = positions.length;

        const min = new THREE.Vector3();
        const max = new THREE.Vector3();

        // ignore the first splat since it's the invalid designator
        for (let i = 1; i < splatCount; i++) {
            const position = positions[i];
            if (i === 0 || position[0] < min.x) min.x = position[0];
            if (i === 0 || position[0] > max.x) max.x = position[0];
            if (i === 0 || position[1] < min.y) min.y = position[1];
            if (i === 0 || position[1] > max.y) max.y = position[1];
            if (i === 0 || position[2] < min.z) min.z = position[2];
            if (i === 0 || position[2] > max.z) max.z = position[2];
        }

        const dimensions = new THREE.Vector3().copy(max).sub(min);
        const yBlocks = Math.ceil(dimensions.y / blockSize);
        const zBlocks = Math.ceil(dimensions.z / blockSize);

        const blockCenter = new THREE.Vector3();
        const fullBuckets = [];
        const partiallyFullBuckets = {};

        // ignore the first splat since it's the invalid designator
        for (let i = 1; i < splatCount; i++) {
            const position = positions[i];
            const xBlock = Math.ceil((position[0] - min.x) / blockSize);
            const yBlock = Math.ceil((position[1] - min.y) / blockSize);
            const zBlock = Math.ceil((position[2] - min.z) / blockSize);

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
            if (bucket.splats.length >= SplatBufferBucketSize) {
                fullBuckets.push(bucket);
                partiallyFullBuckets[bucketId] = null;
            }
        }

        // fill partially full buckets with invalid splats (splat 0)
        // to get them up to SplatBufferBucketSize
        for (let bucketId in partiallyFullBuckets) {
            if (partiallyFullBuckets.hasOwnProperty(bucketId)) {
                const bucket = partiallyFullBuckets[bucketId];
                if (bucket) {
                    while (bucket.splats.length < SplatBufferBucketSize) {
                        bucket.splats.push(0);
                    }
                    fullBuckets.push(bucket);
                }
            }
        }

        return fullBuckets;
    }
}
