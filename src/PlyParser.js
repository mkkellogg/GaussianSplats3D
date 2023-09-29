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

    readRawVertex(vertexData, offset, propertyTypes) {
        let rawVertex = {};

        for (const property in propertyTypes) {
            const propertyType = propertyTypes[property];
            if (propertyType === 'float') {
                rawVertex[property] = vertexData.getFloat32(offset, true);
                offset += Float32Array.BYTES_PER_ELEMENT;
            } else if (propertyType === 'uchar') {
                rawVertex[property] = vertexData.getUint8(offset) / 255.0;
                offset += Uint8Array.BYTES_PER_ELEMENT;
            }
        }

        return {
            'offset': offset,
            'rawVertex': rawVertex
        };
    }

    readRawVertexFast(vertexData, offset, propertiesToRead, propertyTypes, outVertex) {
        let rawVertex = outVertex || {};
        for (let property of propertiesToRead) {
            const propertyType = propertyTypes[property];
            if (propertyType === 'float') {
                rawVertex[property] = vertexData.getFloat32(offset, true);
                offset += Float32Array.BYTES_PER_ELEMENT;
            } else if (propertyType === 'uchar') {
                rawVertex[property] = vertexData.getUint8(offset) / 255.0;
                offset += Uint8Array.BYTES_PER_ELEMENT;
            }
        }
        return offset;
    }

    arrangeVertex(rawVertex, shFeatureOrder, sphericalHarmonicsDegree) {
        const shCoeffs = [];
        for (let i = 0; i < this.nShCoeffs(sphericalHarmonicsDegree); ++i) {
            const coeff = [];
            for (let j = 0; j < 3; ++j) {
                const coeffName = shFeatureOrder[i * 3 + j];
                coeff.push(rawVertex[coeffName]);
            }
            shCoeffs.push(coeff);
        }

        const arrangedVertex = {
            position: [rawVertex.x, rawVertex.y, rawVertex.z],
            logScale: [rawVertex.scale_0, rawVertex.scale_1, rawVertex.scale_2],
            rotQuat: [rawVertex.rot_0, rawVertex.rot_1, rawVertex.rot_2, rawVertex.rot_3],
            opacityLogit: rawVertex.opacity,
            shCoeffs: shCoeffs,
        };
        return arrangedVertex;
    }

    nShCoeffs(sphericalHarmonicsDegree) {
        if (sphericalHarmonicsDegree === 0) {
            return 1;
        } else if (sphericalHarmonicsDegree === 1) {
            return 4;
        } else if (sphericalHarmonicsDegree === 2) {
            return 9;
        } else if (sphericalHarmonicsDegree === 3) {
            return 16;
        } else {
            throw new Error(`Unsupported SH degree: ${sphericalHarmonicsDegree}`);
        }
    }

    parseToSplatBuffer(){

        const plyLoadStartTime = performance.now() / 1000;

        const {vertexCount, propertyTypes, vertexData} = this.decodeHeader(this.plyBuffer);

        // decode the header
        this.numGaussians = vertexCount;

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
        let offsets = {};
        const types = {};
        const TYPE_MAP = {
            'double': "getFloat64",
            'int': "getInt32",
            'uint': "getUint32",
            'float': "getFloat32",
            'short': "getInt16",
            'ushort': "getUint16",
            'uchar': "getUint8",
        };
        for (let typeName in propertyTypes) {
            const type = propertyTypes[typeName];
            const arrayType = TYPE_MAP[type] || "getInt8";
            types[type] = arrayType;
            plyRowSize += parseInt(arrayType.replace(/[^\d]/g, "")) / 8;
        }

        let row = 0;
        const attributeView = new Proxy(
            {},
            {
                get(target, prop) {
                    if (!types[prop]) throw new Error(prop + " not found");
                    return vertexData[types[prop]](
                        row * plyRowSize + offsets[prop],
                        true,
                    );
                },
            },
        );

        let rawVertex = {};

        console.log('plyRowSize: ' + plyRowSize)

        const propertiesToRead = ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'];

        console.time("calculate importance");
        let sizeList = new Float32Array(vertexCount);
        let sizeIndex = new Uint32Array(vertexCount);
        let offset = 0;
        for (row = 0; row < vertexCount; row++) {
            offset = this.readRawVertexFast(vertexData, offset, propertiesToRead, propertyTypes, rawVertex);
            // TODO: For now, in the interest of speed, we use the raw vertex
            // const arrangedVertex = this.arrangeVertex(rawVertex, shFeatureOrder, sphericalHarmonicsDegree);
            
            sizeIndex[row] = row;
            if (!types["scale_0"]) continue;
            const size =
                Math.exp(rawVertex.scale_0) *
                Math.exp(rawVertex.scale_1) *
                Math.exp(rawVertex.scale_2);
            const opacity = 1 / (1 + Math.exp(-rawVertex.opacity));
            sizeList[row] = size * opacity;
        }
        console.timeEnd("calculate importance");

        console.time("sort");
        sizeIndex.sort((b, a) => sizeList[a] - sizeList[b]);
        console.timeEnd("sort");



        const splatBufferData = new ArrayBuffer(SplatBuffer.RowSize * vertexCount);

        offset = 0;
        for (let j = 0; j < vertexCount; j++) {
            row = sizeIndex[j];
            offset = row * plyRowSize;
            offset = this.readRawVertexFast(vertexData, offset, propertiesToRead, propertyTypes, rawVertex);

            // TODO: For now, in the interest of speed, we use the raw vertex
            //const arrangedVertex = this.arrangeVertex(rawVertex, shFeatureOrder, sphericalHarmonicsDegree);

            const position = new Float32Array(splatBufferData, j * SplatBuffer.RowSize, 3);
            const scales = new Float32Array(splatBufferData, j * SplatBuffer.RowSize + 4 * 3, 3);
            const rgba = new Uint8ClampedArray(
                splatBufferData,
                j * SplatBuffer.RowSize + 4 * 3 + 4 * 3,
                4,
            );
            const rot = new Uint8ClampedArray(
                splatBufferData,
                j * SplatBuffer.RowSize + 4 * 3 + 4 * 3 + 4,
                4,
            );

            if (propertyTypes["scale_0"]) {
                const qlen = Math.sqrt(
                    rawVertex.rot_0 ** 2 +
                    rawVertex.rot_1 ** 2 +
                    rawVertex.rot_2 ** 2 +
                    rawVertex.rot_3 ** 2,
                );

                rot[0] = (rawVertex.rot_0 / qlen) * 128 + 128;
                rot[1] = (rawVertex.rot_1 / qlen) * 128 + 128;
                rot[2] = (rawVertex.rot_2 / qlen) * 128 + 128;
                rot[3] = (rawVertex.rot_3 / qlen) * 128 + 128;

                scales[0] = Math.exp(rawVertex.scale_0);
                scales[1] = Math.exp(rawVertex.scale_1);
                scales[2] = Math.exp(rawVertex.scale_2);
            } else {
                scales[0] = 0.01;
                scales[1] = 0.01;
                scales[2] = 0.01;

                rot[0] = 255;
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

        const plyLoadEndTime = performance.now() / 1000;
        console.log(`Ply load complete: ${plyLoadEndTime - plyLoadStartTime} seconds.`);

        const splatBuffer = new SplatBuffer(splatBufferData);
        splatBuffer.buildPreComputedBuffers();
        return splatBuffer;


        // define the layout of a single point
        /*const gaussianLayout = [
            ['position', new vec3(f32)],
            ['logScale', new vec3(f32)],
            ['rotQuat', new vec4(f32)],
            ['opacityLogit', f32],
            ['shCoeffs', new StaticArray(new vec3(f32), this.nShCoeffs(sphericalHarmonicsDegree))],
        ];
        // define the layout of the entire point cloud
        this.gaussianArrayLayout = new StaticArray(this.gaussianLayout, vertexCount);

        this.positionsLayout = new vec3(f32);
        this.positionsArrayLayout = new StaticArray(this.positionsLayout, vertexCount);

        // pack the points
        this.gaussiansBuffer = new ArrayBuffer(this.gaussianArrayLayout.size);
        const gaussianWriteView = new DataView(this.gaussiansBuffer);

        this.positionsBuffer = new ArrayBuffer(this.positionsArrayLayout.size);
        const positionsWriteView = new DataView(this.positionsBuffer);

        var readOffset = 0;
        var gaussianWriteOffset = 0;
        var positionWriteOffset = 0;
        for (let i = 0; i < vertexCount; i++) {
            const {offset, rawVertex} = this.readRawVertex(readOffset, vertexData, propertyTypes);
            readOffset = offset;
            gaussianWriteOffset = this.gaussianLayout.pack(
                gaussianWriteOffset,
                this.arrangeVertex(rawVertex, shFeatureOrder),
                gaussianWriteView,
            );

            positionWriteOffset = this.positionsLayout.pack(
                positionWriteOffset,
                [rawVertex.x, rawVertex.y, rawVertex.z],
                positionsWriteView,
            );
        }




       /* const ubuf = new Uint8Array(this.plyBuffer);
        // 10KB ought to be enough for a header...
        const header = new TextDecoder().decode(ubuf.slice(0, 1024 * 10));
        const header_end = "end_header\n";
        const header_end_index = header.indexOf(header_end);
        if (header_end_index < 0)
            throw new Error("Unable to read .ply file header");
        const vertexCount = parseInt(/element vertex (\d+)\n/.exec(header)[1]);
        console.log("Vertex Count", vertexCount);
        let row_offset = 0,
            offsets = {},
            types = {};
        const TYPE_MAP = {
            double: "getFloat64",
            int: "getInt32",
            uint: "getUint32",
            float: "getFloat32",
            short: "getInt16",
            ushort: "getUint16",
            uchar: "getUint8",
        };
        for (let prop of header
            .slice(0, header_end_index)
            .split("\n")
            .filter((k) => k.startsWith("property "))) {
            const [p, type, name] = prop.split(" ");
            const arrayType = TYPE_MAP[type] || "getInt8";
            types[name] = arrayType;
            offsets[name] = row_offset;
            row_offset += parseInt(arrayType.replace(/[^\d]/g, "")) / 8;
        }
        console.log("Bytes per row", row_offset, types, offsets);

        let dataView = new DataView(
            this.plyBuffer,
            header_end_index + header_end.length,
        );
        let row = 0;
        const attrs = new Proxy(
            {},
            {
                get(target, prop) {
                    if (!types[prop]) throw new Error(prop + " not found");
                    return dataView[types[prop]](
                        row * row_offset + offsets[prop],
                        true,
                    );
                },
            },
        );

        console.time("calculate importance");
        let sizeList = new Float32Array(vertexCount);
        let sizeIndex = new Uint32Array(vertexCount);
        for (row = 0; row < vertexCount; row++) {
            sizeIndex[row] = row;
            if (!types["scale_0"]) continue;
            const size =
                Math.exp(attrs.scale_0) *
                Math.exp(attrs.scale_1) *
                Math.exp(attrs.scale_2);
            const opacity = 1 / (1 + Math.exp(-attrs.opacity));
            sizeList[row] = size * opacity;
        }
        console.timeEnd("calculate importance");

        console.time("sort");
        sizeIndex.sort((b, a) => sizeList[a] - sizeList[b]);
        console.timeEnd("sort");

        // 6*4 + 4 + 4 = 8*4
        // XYZ - Position (Float32)
        // XYZ - Scale (Float32)
        // RGBA - colors (uint8)
        // IJKL - quaternion/rot (uint8)
        const rowLength = 3 * 4 + 3 * 4 + 4 + 4;
        const buffer = new ArrayBuffer(rowLength * vertexCount);

        console.time("build buffer");
        for (let j = 0; j < vertexCount; j++) {
            row = sizeIndex[j];

            const position = new Float32Array(buffer, j * rowLength, 3);
            const scales = new Float32Array(buffer, j * rowLength + 4 * 3, 3);
            const rgba = new Uint8ClampedArray(
                buffer,
                j * rowLength + 4 * 3 + 4 * 3,
                4,
            );
            const rot = new Uint8ClampedArray(
                buffer,
                j * rowLength + 4 * 3 + 4 * 3 + 4,
                4,
            );

            if (types["scale_0"]) {
                const qlen = Math.sqrt(
                    attrs.rot_0 ** 2 +
                        attrs.rot_1 ** 2 +
                        attrs.rot_2 ** 2 +
                        attrs.rot_3 ** 2,
                );

                rot[0] = (attrs.rot_0 / qlen) * 128 + 128;
                rot[1] = (attrs.rot_1 / qlen) * 128 + 128;
                rot[2] = (attrs.rot_2 / qlen) * 128 + 128;
                rot[3] = (attrs.rot_3 / qlen) * 128 + 128;

                scales[0] = Math.exp(attrs.scale_0);
                scales[1] = Math.exp(attrs.scale_1);
                scales[2] = Math.exp(attrs.scale_2);
            } else {
                scales[0] = 0.01;
                scales[1] = 0.01;
                scales[2] = 0.01;

                rot[0] = 255;
                rot[1] = 0;
                rot[2] = 0;
                rot[3] = 0;
            }

            position[0] = attrs.x;
            position[1] = attrs.y;
            position[2] = attrs.z;

            if (types["f_dc_0"]) {
                const SH_C0 = 0.28209479177387814;
                rgba[0] = (0.5 + SH_C0 * attrs.f_dc_0) * 255;
                rgba[1] = (0.5 + SH_C0 * attrs.f_dc_1) * 255;
                rgba[2] = (0.5 + SH_C0 * attrs.f_dc_2) * 255;
            } else {
                rgba[0] = attrs.red;
                rgba[1] = attrs.green;
                rgba[2] = attrs.blue;
            }
            if (types["opacity"]) {
                rgba[3] = (1 / (1 + Math.exp(-attrs.opacity))) * 255;
            } else {
                rgba[3] = 255;
            }
        }
        console.timeEnd("end buffer");

        console.timeEnd("start splat buffer");
        const splatBuffer = new SplatBuffer(buffer);
        splatBuffer.buildPreComputedBuffers();
        console.timeEnd("end splat buffer");

        return splatBuffer;*/
    }
}
