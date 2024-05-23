import * as THREE from 'three';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';
import { SplatBuffer } from '../SplatBuffer.js';
import { clamp } from '../../Util.js';
import { getSphericalHarmonicsComponentCountForDegree } from '../../Util.js';

export class INRIAV1PlyParser {

    static HeaderEndToken = 'end_header';

    static BaseFields = ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
                         'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'red', 'green', 'blue', 'opacity'];

    static SphericalHarmonicsFields = Array.from(Array(45)).map((e, i) => (`f_rest_${i}`));

    static Fields = [[...INRIAV1PlyParser.BaseFields], [...INRIAV1PlyParser.BaseFields, ...INRIAV1PlyParser.SphericalHarmonicsFields]];

    static FieldSize = {
        'double': 8,
        'int': 4,
        'uint': 4,
        'float': 4,
        'short': 2,
        'ushort': 2,
        'uchar': 1,
    };

    static checkTextForEndHeader(endHeaderTestText) {
        if (endHeaderTestText.includes(INRIAV1PlyParser.HeaderEndToken)) {
            return true;
        }
        return false;
    }

    static checkBufferForEndHeader(buffer, searchOfset, chunkSize, decoder) {
        const endHeaderTestChunk = new Uint8Array(buffer, Math.max(0, searchOfset - chunkSize), chunkSize);
        const endHeaderTestText = decoder.decode(endHeaderTestChunk);
        return INRIAV1PlyParser.checkTextForEndHeader(endHeaderTestText);
    }

    static extractHeaderSection(headerLines, startLine = 0) {
        const extractedLines = [];

        let processingSection = false;
        let endLine = -1;
        let elementCount = -1;
        let propertyTypes = {};

        for (let i = startLine; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            if (line.startsWith('element')) {
                if (processingSection) {
                    break;
                } else {
                    processingSection = true;
                    startLine = i;
                    endLine = i;
                    const elementCountMatch = line.match(/\d+/);
                    if (elementCountMatch) {
                        elementCount = parseInt(elementCountMatch[0]);
                    }
                }
            } else if (line.startsWith('property')) {
                const propertyMatch = line.match(/(\w+)\s+(\w+)\s+(\w+)/);
                if (propertyMatch) {
                    const propertyType = propertyMatch[2];
                    const propertyName = propertyMatch[3];
                    propertyTypes[propertyName] = propertyType;
                }
            }
            if (processingSection) {
                extractedLines.push(line);
                if (line === INRIAV1PlyParser.HeaderEndToken) {
                    break;
                }
                endLine++;
            }
        }

        const fieldNames = [];
        const fieldOffsets = {};
        let bytesPerEntry = 0;
        for (let fieldName in propertyTypes) {
            if (propertyTypes.hasOwnProperty(fieldName)) {
                fieldNames.push(fieldName);
                const type = propertyTypes[fieldName];
                fieldOffsets[fieldName] = bytesPerEntry;
                bytesPerEntry += INRIAV1PlyParser.FieldSize[type];
            }
        }

        return {
            'lines': extractedLines,
            'startLine': startLine,
            'endLine': endLine,
            'elementCount': elementCount,
            'propertyTypes': propertyTypes,
            'fieldNames': fieldNames,
            'fieldOffsets': fieldOffsets,
            'bytesPerEntry': bytesPerEntry
        };

    }

    static decodeSphericalHarmonicsFromHeaderSection(headerSection) {
        let sphericalHarmonicsFieldCount = 0;
        let coefficientsPerChannel = 0;
        for (let fieldName of headerSection.fieldNames) {
            if (fieldName.startsWith('f_rest')) sphericalHarmonicsFieldCount++;
        }
        coefficientsPerChannel = sphericalHarmonicsFieldCount / 3;
        let degree = 0;
        if (coefficientsPerChannel >= 3) degree = 1;
        if (coefficientsPerChannel >= 8) degree = 2;

        let degree1Fields = [];
        let degree2Fields = [];

        for (let rgb = 0; rgb < 3; rgb++) {
            if (degree >= 1) {
                for (let i = 0; i < 3; i++) {
                    degree1Fields.push('f_rest_' + (i + coefficientsPerChannel * rgb));
                }
            }
            if (degree >= 2) {
                for (let i = 0; i < 5; i++) {
                    degree2Fields.push('f_rest_' + (i + coefficientsPerChannel * rgb + 3));
                }
            }
        }

        return {
            'degree': degree,
            'coefficientsPerChannel': coefficientsPerChannel,
            'degree1Fields': degree1Fields,
            'degree2Fields': degree2Fields
        };
    }

    static decodeHeaderLines(headerLines) {
        const prunedLines = [];

        const headerFirstSection = INRIAV1PlyParser.extractHeaderSection(headerLines, 0);
        headerLines = headerFirstSection.lines;
        const splatCount = headerFirstSection.elementCount;
        const propertyTypes = headerFirstSection.propertyTypes;
        const sphericalHarmonics = INRIAV1PlyParser.decodeSphericalHarmonicsFromHeaderSection(headerFirstSection);

        return {
            'splatCount': splatCount,
            'propertyTypes': propertyTypes,
            'headerLines': prunedLines,
            'bytesPerSplat': headerFirstSection.bytesPerEntry,
            'fieldOffsets': headerFirstSection.fieldOffsets,
            'sphericalHarmonicsDegree': sphericalHarmonics.degree,
            'sphericalHarmonicsCoefficientsPerChannel': sphericalHarmonics.coefficientsPerChannel,
            'sphericalHarmonicsDegree1Fields': sphericalHarmonics.degree1Fields,
            'sphericalHarmonicsDegree2Fields': sphericalHarmonics.degree2Fields
        };
    }

    static decodeHeaderText(headerText) {
        const headerLines = headerText.split('\n');
        const header = INRIAV1PlyParser.decodeHeaderLines(headerLines);
        header.headerText = headerText;
        header.headerSizeBytes = headerText.indexOf(INRIAV1PlyParser.HeaderEndToken) + INRIAV1PlyParser.HeaderEndToken.length + 1;
        return header;
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

            if (INRIAV1PlyParser.checkBufferForEndHeader(plyBuffer, headerOffset, readChunkSize * 2, decoder)) {
                break;
            }
        }

        return INRIAV1PlyParser.decodeHeaderText(headerText);
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

    static parseToUncompressedSplatBufferSection(header, fromSplat, toSplat, vertexData, vertexDataOffset,
                                                 toBuffer, toOffset, outSphericalHarmonicsDegree = 0) {
        outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);
        const sphericalHarmonicsCount = getSphericalHarmonicsComponentCountForDegree(outSphericalHarmonicsDegree);
        const outBytesPerCenter = SplatBuffer.CompressionLevels[0].BytesPerCenter;
        const outBytesPerScale = SplatBuffer.CompressionLevels[0].BytesPerScale;
        const outBytesPerRotation = SplatBuffer.CompressionLevels[0].BytesPerRotation;
        const outBytesPerColor = SplatBuffer.CompressionLevels[0].BytesPerColor;
        const outBytesPerSplat = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree].BytesPerSplat;

        for (let i = fromSplat; i <= toSplat; i++) {

            const parsedSplat = INRIAV1PlyParser.parseToUncompressedSplat(vertexData, i, header,
                                                                          vertexDataOffset, outSphericalHarmonicsDegree);

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

            if (outSphericalHarmonicsDegree >= 1) {
                const outSphericalHarmonics = new Float32Array(toBuffer, outBase + outBytesPerCenter + outBytesPerScale +
                                                               outBytesPerRotation + outBytesPerColor,
                                                               sphericalHarmonicsCount);
                for (let i = 0; i <= 8; i++) {
                    outSphericalHarmonics[i] = parsedSplat[UncompressedSplatArray.OFFSET.FRC0 + i];
                }
                if (outSphericalHarmonicsDegree >= 2) {
                    for (let i = 9; i <= 23; i++) {
                        outSphericalHarmonics[i] = parsedSplat[UncompressedSplatArray.OFFSET.FRC0 + i];
                    }
                }
            }
        }
    }

    static parseToUncompressedSplat = function() {

        let rawVertex = {};
        const tempRotation = new THREE.Quaternion();

        return function(vertexData, row, header, vertexDataOffset = 0, outSphericalHarmonicsDegree = 0) {
            outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);
            INRIAV1PlyParser.readRawVertexFast(vertexData, row * header.bytesPerSplat + vertexDataOffset, header.fieldOffsets,
                                        INRIAV1PlyParser.Fields[outSphericalHarmonicsDegree > 0 ? 1 : 0], header.propertyTypes, rawVertex);
            const newSplat = UncompressedSplatArray.createSplat(outSphericalHarmonicsDegree);
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

            if (outSphericalHarmonicsDegree >= 1) {
                if (rawVertex['f_rest_0'] !== undefined) {
                    for (let i = 0; i < 9; i++) {
                        newSplat[UncompressedSplatArray.OFFSET.FRC0 + i] = rawVertex[header.sphericalHarmonicsDegree1Fields[i]];
                    }
                    if (outSphericalHarmonicsDegree >= 2) {
                        for (let i = 0; i < 15; i++) {
                            newSplat[UncompressedSplatArray.OFFSET.FRC9 + i] = rawVertex[header.sphericalHarmonicsDegree2Fields[i]];
                        }
                    }
                } else {
                    newSplat[UncompressedSplatArray.OFFSET.FRC0] = 0;
                    newSplat[UncompressedSplatArray.OFFSET.FRC1] = 0;
                    newSplat[UncompressedSplatArray.OFFSET.FRC2] = 0;
                }
            }

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

    static parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree = 0) {

        const header = INRIAV1PlyParser.decodeHeadeFromBuffer(plyBuffer);
        const splatCount = header.splatCount;
        const vertexData = INRIAV1PlyParser.findVertexData(plyBuffer, header);
        const splatArray = new UncompressedSplatArray(outSphericalHarmonicsDegree);

        for (let row = 0; row < splatCount; row++) {
            const newSplat = INRIAV1PlyParser.parseToUncompressedSplat(vertexData, row, header, 0, outSphericalHarmonicsDegree);
            splatArray.addSplat(newSplat);
        }

        return splatArray;

    }
}
