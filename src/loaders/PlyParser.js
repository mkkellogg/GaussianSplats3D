import { UncompressedSplatArray } from './UncompressedSplatArray.js';

export class PlyParser {

    static HeaderEndToken = 'end_header';

    constructor(plyBuffer) {
        this.plyBuffer = plyBuffer;
    }

    static decodeHeader(plyBuffer) {
        const decoder = new TextDecoder();
        let headerOffset = 0;
        let headerText = '';

        // console.log('.PLY size: ' + plyBuffer.byteLength + ' bytes');

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

        const vertexByteOffset = headerText.indexOf('end_header') + PlyParser.HeaderEndToken.length + 1;
        const vertexData = new DataView(plyBuffer, vertexByteOffset);

        return {
            'splatCount': splatCount,
            'propertyTypes': propertyTypes,
            'vertexData': vertexData,
            'headerOffset': headerOffset
        };
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

    parseToUncompressedSplatArray() {

        // const startTime = performance.now();

        // console.log('Parsing PLY to SPLAT...');

        const {splatCount, propertyTypes, vertexData} = PlyParser.decodeHeader(this.plyBuffer);

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
        // const sphericalHarmonicsDegree = 0;
        // console.log('Detected degree', sphericalHarmonicsDegree, 'with ', nCoeffsPerColor, 'coefficients per color');

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

        const splatArray = new UncompressedSplatArray();

        for (let row = 0; row < splatCount; row++) {
            PlyParser.readRawVertexFast(vertexData, row * plyRowSize, fieldOffsets, propertiesToRead, propertyTypes, rawVertex);
            const newSplat = splatArray.addDefaultSplat();
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
            } else {
                newSplat[UncompressedSplatArray.OFFSET.FDC0] = 0;
                newSplat[UncompressedSplatArray.OFFSET.FDC1] = 0;
                newSplat[UncompressedSplatArray.OFFSET.FDC2] = 0;
            }
            if (rawVertex['opacity'] !== undefined) {
                newSplat[UncompressedSplatArray.OFFSET.OPACITY] = (1 / (1 + Math.exp(-rawVertex['opacity']))) * 255;
            }

            newSplat[UncompressedSplatArray.OFFSET.ROTATION0] = rawVertex['rot_0'];
            newSplat[UncompressedSplatArray.OFFSET.ROTATION1] = rawVertex['rot_1'];
            newSplat[UncompressedSplatArray.OFFSET.ROTATION2] = rawVertex['rot_2'];
            newSplat[UncompressedSplatArray.OFFSET.ROTATION3] = rawVertex['rot_3'];

            newSplat[UncompressedSplatArray.OFFSET.X] = rawVertex['x'];
            newSplat[UncompressedSplatArray.OFFSET.Y] = rawVertex['y'];
            newSplat[UncompressedSplatArray.OFFSET.Z] = rawVertex['z'];
        }

        return splatArray;

        // console.log('Total valid splats: ', splatBuffer.getSplatCount(), 'out of', splatCount);

        // const endTime = performance.now();

        // console.log('Parsing PLY to SPLAT complete!');
        // console.log('Total time: ', (endTime - startTime).toFixed(2) + ' ms');
    }

}
