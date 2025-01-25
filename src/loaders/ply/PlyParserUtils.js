import { PlyFormat } from './PlyFormat.js';

const [
        FieldSizeIdDouble, FieldSizeIdInt, FieldSizeIdUInt, FieldSizeIdFloat, FieldSizeIdShort, FieldSizeIdUShort, FieldSizeIdUChar
      ] = [0, 1, 2, 3, 4, 5, 6];

const FieldSizeStringMap = {
    'double': FieldSizeIdDouble,
    'int': FieldSizeIdInt,
    'uint': FieldSizeIdUInt,
    'float': FieldSizeIdFloat,
    'short': FieldSizeIdShort,
    'ushort': FieldSizeIdUShort,
    'uchar': FieldSizeIdUChar,
};

const FieldSize = {
    [FieldSizeIdDouble]: 8,
    [FieldSizeIdInt]: 4,
    [FieldSizeIdUInt]: 4,
    [FieldSizeIdFloat]: 4,
    [FieldSizeIdShort]: 2,
    [FieldSizeIdUShort]: 2,
    [FieldSizeIdUChar]: 1,
};

export class PlyParserUtils {

    static HeaderEndToken = 'end_header';

    static decodeSectionHeader(headerLines, fieldNameIdMap, headerStartLine = 0) {

        const extractedLines = [];

        let processingSection = false;
        let headerEndLine = -1;
        let vertexCount = 0;
        let endOfHeader = false;
        let sectionName = null;

        const fieldIds = [];
        const fieldTypes = [];
        const allFieldNames = [];
        const usedFieldNames = [];
        const fieldTypesByName = {};

        for (let i = headerStartLine; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            if (line.startsWith('element')) {
                if (processingSection) {
                    headerEndLine--;
                    break;
                } else {
                    processingSection = true;
                    headerStartLine = i;
                    headerEndLine = i;
                    const lineComponents = line.split(' ');
                    let validComponents = 0;
                    for (let lineComponent of lineComponents) {
                        const trimmedComponent = lineComponent.trim();
                        if (trimmedComponent.length > 0) {
                            validComponents++;
                            if (validComponents === 2) {
                                sectionName = trimmedComponent;
                            } else if (validComponents === 3) {
                                vertexCount = parseInt(trimmedComponent);
                            }
                        }
                    }
                }
            } else if (line.startsWith('property')) {
                const fieldMatch = line.match(/(\w+)\s+(\w+)\s+(\w+)/);
                if (fieldMatch) {
                    const fieldTypeStr = fieldMatch[2];
                    const fieldName = fieldMatch[3];
                    allFieldNames.push(fieldName);
                    const fieldId = fieldNameIdMap[fieldName];
                    fieldTypesByName[fieldName] = fieldTypeStr;
                    const fieldType = FieldSizeStringMap[fieldTypeStr];
                    if (fieldId !== undefined) {
                        usedFieldNames.push(fieldName);
                        fieldIds.push(fieldId);
                        fieldTypes[fieldId] = fieldType;
                    }
                }
            }
            if (line === PlyParserUtils.HeaderEndToken) {
                endOfHeader = true;
                break;
            }
            if (processingSection) {
                extractedLines.push(line);
                headerEndLine++;
            }
        }

        const fieldOffsets = [];
        let bytesPerVertex = 0;
        for (let fieldName of allFieldNames) {
            const fieldType = fieldTypesByName[fieldName];
            if (fieldTypesByName.hasOwnProperty(fieldName)) {
                const fieldId = fieldNameIdMap[fieldName];
                if (fieldId !== undefined) {
                    fieldOffsets[fieldId] = bytesPerVertex;
                }
            }
            bytesPerVertex += FieldSize[FieldSizeStringMap[fieldType]];
        }

        const sphericalHarmonics = PlyParserUtils.decodeSphericalHarmonicsFromSectionHeader(allFieldNames, fieldNameIdMap);

        return {
            'headerLines': extractedLines,
            'headerStartLine': headerStartLine,
            'headerEndLine': headerEndLine,
            'fieldTypes': fieldTypes,
            'fieldIds': fieldIds,
            'fieldOffsets': fieldOffsets,
            'bytesPerVertex': bytesPerVertex,
            'vertexCount': vertexCount,
            'dataSizeBytes': bytesPerVertex * vertexCount,
            'endOfHeader': endOfHeader,
            'sectionName': sectionName,
            'sphericalHarmonicsDegree': sphericalHarmonics.degree,
            'sphericalHarmonicsCoefficientsPerChannel': sphericalHarmonics.coefficientsPerChannel,
            'sphericalHarmonicsDegree1Fields': sphericalHarmonics.degree1Fields,
            'sphericalHarmonicsDegree2Fields': sphericalHarmonics.degree2Fields
        };

    }

    static decodeSphericalHarmonicsFromSectionHeader(fieldNames, fieldNameIdMap) {
        let sphericalHarmonicsFieldCount = 0;
        let coefficientsPerChannel = 0;
        for (let fieldName of fieldNames) {
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
                    degree1Fields.push(fieldNameIdMap['f_rest_' + (i + coefficientsPerChannel * rgb)]);
                }
            }
            if (degree >= 2) {
                for (let i = 0; i < 5; i++) {
                    degree2Fields.push(fieldNameIdMap['f_rest_' + (i + coefficientsPerChannel * rgb + 3)]);
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

    static getHeaderSectionNames(headerLines) {
        const sectionNames = [];
        for (let headerLine of headerLines) {
            if (headerLine.startsWith('element')) {
                const lineComponents = headerLine.split(' ');
                let validComponents = 0;
                for (let lineComponent of lineComponents) {
                    const trimmedComponent = lineComponent.trim();
                    if (trimmedComponent.length > 0) {
                        validComponents++;
                        if (validComponents === 2) {
                            sectionNames.push(trimmedComponent);
                        }
                    }
                }
            }
        }
        return sectionNames;
    }

    static checkTextForEndHeader(endHeaderTestText) {
        if (endHeaderTestText.includes(PlyParserUtils.HeaderEndToken)) {
            return true;
        }
        return false;
    }

    static checkBufferForEndHeader(buffer, searchOfset, chunkSize, decoder) {
        const endHeaderTestChunk = new Uint8Array(buffer, Math.max(0, searchOfset - chunkSize), chunkSize);
        const endHeaderTestText = decoder.decode(endHeaderTestChunk);
        return PlyParserUtils.checkTextForEndHeader(endHeaderTestText);
    }

    static extractHeaderFromBufferToText(plyBuffer) {
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

            if (PlyParserUtils.checkBufferForEndHeader(plyBuffer, headerOffset, readChunkSize * 2, decoder)) {
                break;
            }
        }

        return headerText;
    }

    static readHeaderFromBuffer(plyBuffer) {
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

            if (PlyParserUtils.checkBufferForEndHeader(plyBuffer, headerOffset, readChunkSize * 2, decoder)) {
                break;
            }
        }

        return headerText;
    }

    static convertHeaderTextToLines(headerText) {
        const headerLines = headerText.split('\n');
        const prunedLines = [];
        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            prunedLines.push(line);
            if (line === PlyParserUtils.HeaderEndToken) {
                break;
            }
        }
        return prunedLines;
    }

    static determineHeaderFormatFromHeaderText(headertText) {
        const headerLines = PlyParserUtils.convertHeaderTextToLines(headertText);
        let format = PlyFormat.INRIAV1;
        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            if (line.startsWith('element chunk') || line.match(/[A-Za-z]*packed_[A-Za-z]*/)) {
                format = PlyFormat.PlayCanvasCompressed;
            } else if (line.startsWith('element codebook_centers')) {
                format = PlyFormat.INRIAV2;
            } else if (line === PlyParserUtils.HeaderEndToken) {
                break;
            }
        }
        return format;
    }

    static determineHeaderFormatFromPlyBuffer(plyBuffer) {
        const headertText = PlyParserUtils.extractHeaderFromBufferToText(plyBuffer);
        return PlyParserUtils.determineHeaderFormatFromHeaderText(headertText);
    }

    static readVertex(vertexData, header, row, dataOffset, fieldsToRead, rawVertex, normalize = true) {
        const offset = row * header.bytesPerVertex + dataOffset;
        const fieldOffsets = header.fieldOffsets;
        const fieldTypes = header.fieldTypes;
        for (let fieldId of fieldsToRead) {
            const fieldType = fieldTypes[fieldId];
            if (fieldType === FieldSizeIdFloat) {
                rawVertex[fieldId] = vertexData.getFloat32(offset + fieldOffsets[fieldId], true);
            } else if (fieldType === FieldSizeIdShort) {
                rawVertex[fieldId] = vertexData.getInt16(offset + fieldOffsets[fieldId], true);
            } else if (fieldType === FieldSizeIdUShort) {
                rawVertex[fieldId] = vertexData.getUint16(offset + fieldOffsets[fieldId], true);
            } else if (fieldType === FieldSizeIdInt) {
                rawVertex[fieldId] = vertexData.getInt32(offset + fieldOffsets[fieldId], true);
            } else if (fieldType === FieldSizeIdUInt) {
                rawVertex[fieldId] = vertexData.getUint32(offset + fieldOffsets[fieldId], true);
            } else if (fieldType === FieldSizeIdUChar) {
                if (normalize) {
                    rawVertex[fieldId] = vertexData.getUint8(offset + fieldOffsets[fieldId]) / 255.0;
                } else {
                    rawVertex[fieldId] = vertexData.getUint8(offset + fieldOffsets[fieldId]);
                }
            }
        }
    }
}
