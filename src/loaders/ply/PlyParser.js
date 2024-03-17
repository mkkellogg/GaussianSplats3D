import * as THREE from 'three';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';
import { CompressedPlyParser } from './CompressedPlyParser.js';
import { SplatBuffer } from '../SplatBuffer.js';
import { clamp } from '../../Util.js';

export class PlyParser {

    static HeaderEndToken = 'end_header';

    static Fields = ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
                     'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'red', 'green', 'blue', 'opacity'];

    static checkTextForEndHeader(endHeaderTestText) {
        if (endHeaderTestText.includes(PlyParser.HeaderEndToken)) {
            return true;
        }
        return false;
    }

    static checkBufferForEndHeader(buffer, searchOfset, chunkSize, decoder) {
        const endHeaderTestChunk = new Uint8Array(buffer, Math.max(0, searchOfset - chunkSize), chunkSize);
        const endHeaderTestText = decoder.decode(endHeaderTestChunk);
        return PlyParser.checkTextForEndHeader(endHeaderTestText);
    }

    static decodeHeaderText(headerText) {
        const headerLines = headerText.split('\n');

        const prunedLines = [];

        let splatCount = 0;
        let propertyTypes = {};
        let compressed = false;

        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            prunedLines.push(line);
            if (line.startsWith('element chunk') || line.match(/[A-Za-z]*packed_[A-Za-z]*/)) {
                compressed = true;
            } else if (line.startsWith('element vertex')) {
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
            } else if (line === PlyParser.HeaderEndToken) {
                break;
            }
        }

        let bytesPerSplat = 0;
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
                fieldOffsets[fieldName] = bytesPerSplat;
                bytesPerSplat += fieldSize[type];
            }
        }

        return {
            'splatCount': splatCount,
            'propertyTypes': propertyTypes,
            'compressed': compressed,
            'headerText': headerText,
            'headerLines': prunedLines,
            'headerSizeBytes': headerText.indexOf(PlyParser.HeaderEndToken) + PlyParser.HeaderEndToken.length + 1,
            'bytesPerSplat': bytesPerSplat,
            'fieldOffsets': fieldOffsets
        };
    }

    static decodeHeadeFromBuffer(plyBuffer) {
        const decoder = new TextDecoder();
        let headerOffset = 0;
        let headerText = '';
        const readChunkSize = 100;

        while (true) {
            if (headerOffset + readChunkSize >= plyBuffer.byteLength) {
                throw new Error('End of file reached while searching for end of header');
            }
            const headerChunk = new Uint8Array(plyBuffer, headerOffset, readChunkSize);
            headerText += decoder.decode(headerChunk);
            headerOffset += readChunkSize;

            if (PlyParser.checkBufferForEndHeader(plyBuffer, headerOffset, readChunkSize * 2, decoder)) {
                break;
            }
        }

        return PlyParser.decodeHeaderText(headerText);

    }

    static findVertexData(plyBuffer, header) {
        return new DataView(plyBuffer, header.headerSizeBytes);
    }

    static readRawVertexFast(vertexData, offset, fieldOffsets, propertiesToRead, propertyTypes, outVertex) {
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

    static parseToUncompressedSplatBufferSection(header, fromSplat, toSplat, vertexData, vertexDataOffset, toBuffer, toOffset) {
        const outBytesPerCenter = SplatBuffer.CompressionLevels[0].BytesPerCenter;
        const outBytesPerScale = SplatBuffer.CompressionLevels[0].BytesPerScale;
        const outBytesPerRotation = SplatBuffer.CompressionLevels[0].BytesPerRotation;
        const outBytesPerSplat = SplatBuffer.CompressionLevels[0].BytesPerSplat;

        for (let i = fromSplat; i <= toSplat; i++) {

            const parsedSplat = PlyParser.parseToUncompressedSplat(vertexData, i, header, vertexDataOffset);

            const outBase = i * outBytesPerSplat + toOffset;
            const outCenter = new Float32Array(toBuffer, outBase, 3);
            const outScale = new Float32Array(toBuffer, outBase + outBytesPerCenter, 3);
            const outRotation = new Float32Array(toBuffer, outBase + outBytesPerCenter + outBytesPerScale, 4);
            const outColor = new Uint8Array(toBuffer, outBase + outBytesPerCenter + outBytesPerScale + outBytesPerRotation, 4);

            outCenter[0] = parsedSplat[UncompressedSplatArray.OFFSET.X];
            outCenter[1] = parsedSplat[UncompressedSplatArray.OFFSET.Y];
            outCenter[2] = parsedSplat[UncompressedSplatArray.OFFSET.Z];

            outScale[0] = parsedSplat[UncompressedSplatArray.OFFSET.SCALE0];
            outScale[1] = parsedSplat[UncompressedSplatArray.OFFSET.SCALE1];
            outScale[2] = parsedSplat[UncompressedSplatArray.OFFSET.SCALE2];

            outRotation[0] = parsedSplat[UncompressedSplatArray.OFFSET.ROTATION0];
            outRotation[1] = parsedSplat[UncompressedSplatArray.OFFSET.ROTATION1];
            outRotation[2] = parsedSplat[UncompressedSplatArray.OFFSET.ROTATION2];
            outRotation[3] = parsedSplat[UncompressedSplatArray.OFFSET.ROTATION3];

            outColor[0] = parsedSplat[UncompressedSplatArray.OFFSET.FDC0];
            outColor[1] = parsedSplat[UncompressedSplatArray.OFFSET.FDC1];
            outColor[2] = parsedSplat[UncompressedSplatArray.OFFSET.FDC2];
            outColor[3] = parsedSplat[UncompressedSplatArray.OFFSET.OPACITY];
        }
    }

    static parseToUncompressedSplat = function() {

        let rawVertex = {};
        const tempRotation = new THREE.Quaternion();

        return function(vertexData, row, header, vertexDataOffset = 0) {
            PlyParser.readRawVertexFast(vertexData, row * header.bytesPerSplat + vertexDataOffset, header.fieldOffsets,
                                        PlyParser.Fields, header.propertyTypes, rawVertex);
            const newSplat = UncompressedSplatArray.createSplat();
            if (rawVertex['scale_0'] !== undefined) {
                newSplat[UncompressedSplatArray.OFFSET.SCALE0] = Math.exp(rawVertex['scale_0']);
                newSplat[UncompressedSplatArray.OFFSET.SCALE1] = Math.exp(rawVertex['scale_1']);
                newSplat[UncompressedSplatArray.OFFSET.SCALE2] = Math.exp(rawVertex['scale_2']);
            } else {
                newSplat[UncompressedSplatArray.OFFSET.SCALE0] = 0.01;
                newSplat[UncompressedSplatArray.OFFSET.SCALE1] = 0.01;
                newSplat[UncompressedSplatArray.OFFSET.SCALE2] = 0.01;
            }

            if (rawVertex['f_dc_0'] !== undefined) {
                const SH_C0 = 0.28209479177387814;
                newSplat[UncompressedSplatArray.OFFSET.FDC0] = (0.5 + SH_C0 * rawVertex['f_dc_0']) * 255;
                newSplat[UncompressedSplatArray.OFFSET.FDC1] = (0.5 + SH_C0 * rawVertex['f_dc_1']) * 255;
                newSplat[UncompressedSplatArray.OFFSET.FDC2] = (0.5 + SH_C0 * rawVertex['f_dc_2']) * 255;
            } else if (rawVertex['red'] !== undefined) {
                newSplat[UncompressedSplatArray.OFFSET.FDC0] = rawVertex['red'] * 255;
                newSplat[UncompressedSplatArray.OFFSET.FDC1] = rawVertex['green'] * 255;
                newSplat[UncompressedSplatArray.OFFSET.FDC2] = rawVertex['blue'] * 255;
            } else {
                newSplat[UncompressedSplatArray.OFFSET.FDC0] = 0;
                newSplat[UncompressedSplatArray.OFFSET.FDC1] = 0;
                newSplat[UncompressedSplatArray.OFFSET.FDC2] = 0;
            }
            if (rawVertex['opacity'] !== undefined) {
                newSplat[UncompressedSplatArray.OFFSET.OPACITY] = (1 / (1 + Math.exp(-rawVertex['opacity']))) * 255;
            }

            newSplat[UncompressedSplatArray.OFFSET.FDC0] = clamp(Math.floor(newSplat[UncompressedSplatArray.OFFSET.FDC0]), 0, 255);
            newSplat[UncompressedSplatArray.OFFSET.FDC1] = clamp(Math.floor(newSplat[UncompressedSplatArray.OFFSET.FDC1]), 0, 255);
            newSplat[UncompressedSplatArray.OFFSET.FDC2] = clamp(Math.floor(newSplat[UncompressedSplatArray.OFFSET.FDC2]), 0, 255);
            newSplat[UncompressedSplatArray.OFFSET.OPACITY] = clamp(Math.floor(newSplat[UncompressedSplatArray.OFFSET.OPACITY]), 0, 255);

            tempRotation.set(rawVertex['rot_0'], rawVertex['rot_1'], rawVertex['rot_2'], rawVertex['rot_3']);
            tempRotation.normalize();

            newSplat[UncompressedSplatArray.OFFSET.ROTATION0] = tempRotation.x;
            newSplat[UncompressedSplatArray.OFFSET.ROTATION1] = tempRotation.y;
            newSplat[UncompressedSplatArray.OFFSET.ROTATION2] = tempRotation.z;
            newSplat[UncompressedSplatArray.OFFSET.ROTATION3] = tempRotation.w;

            newSplat[UncompressedSplatArray.OFFSET.X] = rawVertex['x'];
            newSplat[UncompressedSplatArray.OFFSET.Y] = rawVertex['y'];
            newSplat[UncompressedSplatArray.OFFSET.Z] = rawVertex['z'];

            return newSplat;
        };

    }();

    static parseToUncompressedSplatArray(plyBuffer) {

        const header = PlyParser.decodeHeadeFromBuffer(plyBuffer);

        if (header.compressed) {

            return CompressedPlyParser.parseToUncompressedSplatArray(plyBuffer);

        } else {

            const splatCount = header.splatCount;

            const vertexData = PlyParser.findVertexData(plyBuffer, header);

            // TODO: Eventually properly support multiple degree spherical harmonics
            // figure out the SH degree from the number of coefficients
            /* let nRestCoeffs = 0;
            for (const propertyName in header.propertyTypes) {
                if (propertyName.startsWith('f_rest_')) {
                    nRestCoeffs += 1;
                }
            }
            const nCoeffsPerColor = nRestCoeffs / 3;*/

            // const sphericalHarmonicsDegree = Math.sqrt(nCoeffsPerColor + 1) - 1;
            // const sphericalHarmonicsDegree = 0;
            // console.log('Detected degree', sphericalHarmonicsDegree, 'with ', nCoeffsPerColor, 'coefficients per color');

            // figure out the order in which spherical harmonics should be read
            /* const shFeatureOrder = [];
            for (let rgb = 0; rgb < 3; ++rgb) {
                shFeatureOrder.push(`f_dc_${rgb}`);
            }
            for (let i = 0; i < nCoeffsPerColor; ++i) {
                for (let rgb = 0; rgb < 3; ++rgb) {
                    shFeatureOrder.push(`f_rest_${rgb * nCoeffsPerColor + i}`);
                }
            }*/

            const splatArray = new UncompressedSplatArray();

            for (let row = 0; row < splatCount; row++) {
                const newSplat = PlyParser.parseToUncompressedSplat(vertexData, row, header);
                splatArray.addSplat(newSplat);
            }

            return splatArray;
        }
    }

}
