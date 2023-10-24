import { SplatBuffer } from './SplatBuffer.js';
import * as THREE from 'three';

export class PlyParser {

    constructor(plyBuffer) {
        this.plyBuffer = plyBuffer;
    }

    decodeHeader(plyBuffer) {
        const decoder = new TextDecoder();
        let headerOffset = 0;
        let headerText = '';

        while (true) {
            const headerChunk = new Uint8Array(plyBuffer, headerOffset, 50);
            headerText += decoder.decode(headerChunk);
            headerOffset += 50;
            if (headerText.includes('end_header')) {
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

    parseToSplatBuffer(compressionLevel = 0) {

        console.time('PLY load');

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

        console.time('Importance computations');
        let sizeList = new Float32Array(splatCount);
        let sizeIndex = new Uint32Array(splatCount);
        for (let row = 0; row < splatCount; row++) {
            this.readRawVertexFast(vertexData, row * plyRowSize, fieldOffsets, propertiesToRead, propertyTypes, rawVertex);
            sizeIndex[row] = row;
            if (!propertyTypes['scale_0']) continue;
            const size = Math.exp(rawVertex.scale_0) * Math.exp(rawVertex.scale_1) * Math.exp(rawVertex.scale_2);
            const opacity = 1 / (1 + Math.exp(-rawVertex.opacity));
            sizeList[row] = size * opacity;
        }
        console.timeEnd('Importance computations');

        console.time('Importance sort');
        sizeIndex.sort((b, a) => sizeList[a] - sizeList[b]);
        console.timeEnd('Importance sort');

        const headerSize = SplatBuffer.HeaderSizeBytes;
        const header = new Uint8Array(new ArrayBuffer(headerSize));
        header[0] = compressionLevel;
        (new Uint32Array(header.buffer, 4, 1))[0] = splatCount;

        let bytesPerPosition = SplatBuffer.CompressionLevels[compressionLevel].BytesPerPosition;
        let bytesPerScale = SplatBuffer.CompressionLevels[compressionLevel].BytesPerScale;
        let bytesPerColor = SplatBuffer.CompressionLevels[compressionLevel].BytesPerColor;
        let bytesPerRotation = SplatBuffer.CompressionLevels[compressionLevel].BytesPerRotation;
        const positionBuffer = new ArrayBuffer(bytesPerPosition * splatCount);
        const scaleBuffer = new ArrayBuffer(bytesPerScale * splatCount);
        const colorBuffer = new ArrayBuffer(bytesPerColor * splatCount);
        const rotationBuffer = new ArrayBuffer(bytesPerRotation * splatCount);

        for (let j = 0; j < splatCount; j++) {
            const row = sizeIndex[j];
            const offset = row * plyRowSize;
            this.readRawVertexFast(vertexData, offset, fieldOffsets, propertiesToRead, propertyTypes, rawVertex);

            if (compressionLevel === 0) {
                const position = new Float32Array(positionBuffer, j * bytesPerPosition, 3);
                const scales = new Float32Array(scaleBuffer, j * bytesPerScale, 3);
                const rgba = new Uint8ClampedArray(colorBuffer, j * bytesPerColor, 4);
                const rot = new Float32Array(rotationBuffer, j * bytesPerRotation, 4);

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
            } else {
                const position = new Uint16Array(positionBuffer, j * bytesPerPosition, 3);
                const scales = new Uint16Array(scaleBuffer, j * bytesPerScale, 3);
                const rgba = new Uint8ClampedArray(colorBuffer, j * bytesPerColor, 4);
                const rot = new Uint16Array(rotationBuffer, j * bytesPerRotation, 4);
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

                position.set([thf(rawVertex.x), thf(rawVertex.y), thf(rawVertex.z)]);

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
        }

        console.timeEnd('PLY load');

        const unifiedBufferSize = headerSize + splatCount * (bytesPerPosition + bytesPerScale + bytesPerColor + bytesPerRotation);
        const unifiedBuffer = new ArrayBuffer(unifiedBufferSize);
        new Uint8Array(unifiedBuffer, 0, headerSize).set(header);
        new Uint8Array(unifiedBuffer, headerSize, splatCount * bytesPerPosition).set(new Uint8Array(positionBuffer));
        new Uint8Array(unifiedBuffer, headerSize + splatCount * bytesPerPosition, splatCount * bytesPerScale).set(new Uint8Array(scaleBuffer));
        new Uint8Array(unifiedBuffer, headerSize + splatCount * (bytesPerPosition + bytesPerScale), splatCount * bytesPerColor).set(new Uint8Array(colorBuffer));
        new Uint8Array(unifiedBuffer, headerSize + splatCount * (bytesPerPosition + bytesPerScale + bytesPerColor), splatCount * bytesPerRotation).set(new Uint8Array(rotationBuffer));
        const splatBuffer = new SplatBuffer(unifiedBuffer);
        return splatBuffer;

    }
}
