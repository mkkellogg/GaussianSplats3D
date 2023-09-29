import { SplatBuffer } from './SplatBuffer.js';

export class PlyParser {

    constructor(plyBuffer) {
        this.plyBuffer = plyBuffer
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

        let vertexCount = 0;
        let propertyTypes = {};

        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            if (line.startsWith('element vertex')) {
                const vertexCountMatch = line.match(/\d+/);
                if (vertexCountMatch) {
                    vertexCount = parseInt(vertexCountMatch[0]);
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
            'vertexCount': vertexCount,
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

    parseToSplatBuffer(){

        console.time("PLY load");

        const {vertexCount, propertyTypes, vertexData} = this.decodeHeader(this.plyBuffer);

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
            const type = propertyTypes[fieldName];
            fieldOffsets[fieldName] = plyRowSize;
            plyRowSize += fieldSize[type];
        }

        let rawVertex = {};

        const propertiesToRead = ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];

        console.time("Importance computations");
        let sizeList = new Float32Array(vertexCount);
        let sizeIndex = new Uint32Array(vertexCount);
        for (let row = 0; row < vertexCount; row++) {
            this.readRawVertexFast(vertexData, row * plyRowSize, fieldOffsets, propertiesToRead, propertyTypes, rawVertex);
            sizeIndex[row] = row;
            if (!propertyTypes["scale_0"]) continue;
            const size = Math.exp(rawVertex.scale_0) * Math.exp(rawVertex.scale_1) * Math.exp(rawVertex.scale_2);
            const opacity = 1 / (1 + Math.exp(-rawVertex.opacity));
            sizeList[row] = size * opacity;
        }
        console.timeEnd("Importance computations");

        console.time("Importance sort");
        sizeIndex.sort((b, a) => sizeList[a] - sizeList[b]);
        console.timeEnd("Importance sort");


        const splatBufferData = new ArrayBuffer(SplatBuffer.RowSizeBytes * vertexCount);

        for (let j = 0; j < vertexCount; j++) {
            const row = sizeIndex[j];
            const offset = row * plyRowSize;
            this.readRawVertexFast(vertexData, offset, fieldOffsets, propertiesToRead, propertyTypes, rawVertex);
            const position = new Float32Array(splatBufferData, j * SplatBuffer.RowSizeBytes, 3);
            const scales = new Float32Array(splatBufferData, j * SplatBuffer.RowSizeBytes + 4 * 3, 3);
            const rgba = new Uint8ClampedArray(splatBufferData, j * SplatBuffer.RowSizeBytes + 4 * 3 + 4 * 3, 4,);
            const rot = new Float32Array(splatBufferData, j * SplatBuffer.RowSizeBytes + SplatBuffer.RotationRowOffsetBytes, 4);

            if (propertyTypes["scale_0"]) {
                const qlen = Math.sqrt(Math.pow(rawVertex.rot_0, 2) +
                                       Math.pow(rawVertex.rot_1, 2) +
                                       Math.pow(rawVertex.rot_2, 2) +
                                       Math.pow(rawVertex.rot_3, 2));

                rot[0] = rawVertex.rot_0 / qlen;
                rot[1] = rawVertex.rot_1 / qlen;
                rot[2] = rawVertex.rot_2 / qlen;
                rot[3] = rawVertex.rot_3 / qlen;

                scales[0] = Math.exp(rawVertex.scale_0);
                scales[1] = Math.exp(rawVertex.scale_1);
                scales[2] = Math.exp(rawVertex.scale_2);
            } else {
                scales[0] = 0.01;
                scales[1] = 0.01;
                scales[2] = 0.01;

                rot[0] = 1.0;
                rot[1] = 0;
                rot[2] = 0;
                rot[3] = 0;
            }

            position[0] = rawVertex.x;
            position[1] = rawVertex.y;
            position[2] = rawVertex.z;

            if (propertyTypes["f_dc_0"]) {
                const SH_C0 = 0.28209479177387814;
                rgba[0] = (0.5 + SH_C0 * rawVertex.f_dc_0) * 255;
                rgba[1] = (0.5 + SH_C0 * rawVertex.f_dc_1) * 255;
                rgba[2] = (0.5 + SH_C0 * rawVertex.f_dc_2) * 255;
            } else {
                rgba[0] = 255;
                rgba[1] = 0;
                rgba[2] = 0;
            }
            if (propertyTypes["opacity"]) {
                rgba[3] = (1 / (1 + Math.exp(-rawVertex.opacity))) * 255;
            } else {
                rgba[3] = 255;
            }
        }

        console.timeEnd("PLY load");

        const splatBuffer = new SplatBuffer(splatBufferData);
        splatBuffer.buildPreComputedBuffers();
        return splatBuffer;

    }
}
