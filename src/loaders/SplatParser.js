import * as THREE from 'three';
import { UncompressedSplatArray } from './UncompressedSplatArray.js';

export class SplatParser {

    static parseStandardSplatToUncompressedSplatArray(inBuffer) {
        // Standard .splat row layout:
        // XYZ - Position (Float32)
        // XYZ - Scale (Float32)
        // RGBA - colors (uint8)
        // IJKL - quaternion/rot (uint8)

        const InBufferRowSizeBytes = 32;
        const splatCount = inBuffer.byteLength / InBufferRowSizeBytes;

        const splatArray = new UncompressedSplatArray();

        for (let i = 0; i < splatCount; i++) {
            const inCenterSizeBytes = 3 * 4;
            const inScaleSizeBytes = 3 * 4;
            const inColorSizeBytes = 4;
            const inBase = i * InBufferRowSizeBytes;
            const inCenter = new Float32Array(inBuffer, inBase, 3);
            const inScale = new Float32Array(inBuffer, inBase + inCenterSizeBytes, 3);
            const inColor = new Uint8Array(inBuffer, inBase + inCenterSizeBytes + inScaleSizeBytes, 4);
            const inRotation = new Uint8Array(inBuffer, inBase + inCenterSizeBytes + inScaleSizeBytes + inColorSizeBytes, 4);

            const quat = new THREE.Quaternion((inRotation[1] - 128) / 128, (inRotation[2] - 128) / 128,
                                              (inRotation[3] - 128) / 128, (inRotation[0] - 128) / 128);
            quat.normalize();

            splatArray.addSplatFromComonents(inCenter[0], inCenter[1], inCenter[2], inScale[0], inScale[1], inScale[2],
                                             quat.w, quat.x, quat.y, quat.z, inColor[0], inColor[1], inColor[2], inColor[3]);
        }

        return splatArray;
    }

}
