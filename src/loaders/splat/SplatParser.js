import * as THREE from 'three';
import { SplatBuffer } from '../SplatBuffer.js';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';

export class SplatParser {

    static RowSizeBytes = 32;
    static CenterSizeBytes = 12;
    static ScaleSizeBytes = 12;
    static RotationSizeBytes = 4;
    static ColorSizeBytes = 4;

    static parseToUncompressedSplatBufferSection(fromSplat, toSplat, fromBuffer, fromOffset, toBuffer, toOffset) {

        const outBytesPerCenter = SplatBuffer.CompressionLevels[0].BytesPerCenter;
        const outBytesPerScale = SplatBuffer.CompressionLevels[0].BytesPerScale;
        const outBytesPerRotation = SplatBuffer.CompressionLevels[0].BytesPerRotation;
        const outBytesPerSplat = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[0].BytesPerSplat;

        for (let i = fromSplat; i <= toSplat; i++) {
            const inBase = i * SplatParser.RowSizeBytes + fromOffset;
            const inCenter = new Float32Array(fromBuffer, inBase, 3);
            const inScale = new Float32Array(fromBuffer, inBase + SplatParser.CenterSizeBytes, 3);
            const inColor = new Uint8Array(fromBuffer, inBase + SplatParser.CenterSizeBytes + SplatParser.ScaleSizeBytes, 4);
            const inRotation = new Uint8Array(fromBuffer, inBase + SplatParser.CenterSizeBytes + SplatParser.ScaleSizeBytes +
                                              SplatParser.RotationSizeBytes, 4);

            const quat = new THREE.Quaternion((inRotation[1] - 128) / 128, (inRotation[2] - 128) / 128,
                                              (inRotation[3] - 128) / 128, (inRotation[0] - 128) / 128);
            quat.normalize();

            const outBase = i * outBytesPerSplat + toOffset;
            const outCenter = new Float32Array(toBuffer, outBase, 3);
            const outScale = new Float32Array(toBuffer, outBase + outBytesPerCenter, 3);
            const outRotation = new Float32Array(toBuffer, outBase + outBytesPerCenter + outBytesPerScale, 4);
            const outColor = new Uint8Array(toBuffer, outBase + outBytesPerCenter + outBytesPerScale + outBytesPerRotation, 4);

            outCenter[0] = inCenter[0];
            outCenter[1] = inCenter[1];
            outCenter[2] = inCenter[2];

            outScale[0] = inScale[0];
            outScale[1] = inScale[1];
            outScale[2] = inScale[2];

            outRotation[0] = quat.w;
            outRotation[1] = quat.x;
            outRotation[2] = quat.y;
            outRotation[3] = quat.z;

            outColor[0] = inColor[0];
            outColor[1] = inColor[1];
            outColor[2] = inColor[2];
            outColor[3] = inColor[3];
        }
    }

    static parseToUncompressedSplatArraySection(fromSplat, toSplat, fromBuffer, fromOffset, splatArray) {

        for (let i = fromSplat; i <= toSplat; i++) {
            const inBase = i * SplatParser.RowSizeBytes + fromOffset;
            const inCenter = new Float32Array(fromBuffer, inBase, 3);
            const inScale = new Float32Array(fromBuffer, inBase + SplatParser.CenterSizeBytes, 3);
            const inColor = new Uint8Array(fromBuffer, inBase + SplatParser.CenterSizeBytes + SplatParser.ScaleSizeBytes, 4);
            const inRotation = new Uint8Array(fromBuffer, inBase + SplatParser.CenterSizeBytes + SplatParser.ScaleSizeBytes +
                                              SplatParser.RotationSizeBytes, 4);

            const quat = new THREE.Quaternion((inRotation[1] - 128) / 128, (inRotation[2] - 128) / 128,
                                              (inRotation[3] - 128) / 128, (inRotation[0] - 128) / 128);
            quat.normalize();

            splatArray.addSplatFromComonents(inCenter[0], inCenter[1], inCenter[2], inScale[0], inScale[1], inScale[2],
                                             quat.w, quat.x, quat.y, quat.z, inColor[0], inColor[1], inColor[2], inColor[3]);
        }
    }

    static parseStandardSplatToUncompressedSplatArray(inBuffer) {
        // Standard .splat row layout:
        // XYZ - Position (Float32)
        // XYZ - Scale (Float32)
        // RGBA - colors (uint8)
        // IJKL - quaternion/rot (uint8)

        const splatCount = inBuffer.byteLength / SplatParser.RowSizeBytes;

        const splatArray = new UncompressedSplatArray();

        for (let i = 0; i < splatCount; i++) {
            const inBase = i * SplatParser.RowSizeBytes;
            const inCenter = new Float32Array(inBuffer, inBase, 3);
            const inScale = new Float32Array(inBuffer, inBase + SplatParser.CenterSizeBytes, 3);
            const inColor = new Uint8Array(inBuffer, inBase + SplatParser.CenterSizeBytes + SplatParser.ScaleSizeBytes, 4);
            const inRotation = new Uint8Array(inBuffer, inBase + SplatParser.CenterSizeBytes +
                                              SplatParser.ScaleSizeBytes + SplatParser.ColorSizeBytes, 4);

            const quat = new THREE.Quaternion((inRotation[1] - 128) / 128, (inRotation[2] - 128) / 128,
                                              (inRotation[3] - 128) / 128, (inRotation[0] - 128) / 128);
            quat.normalize();

            splatArray.addSplatFromComonents(inCenter[0], inCenter[1], inCenter[2], inScale[0], inScale[1], inScale[2],
                                             quat.w, quat.x, quat.y, quat.z, inColor[0], inColor[1], inColor[2], inColor[3]);
        }

        return splatArray;
    }

}
