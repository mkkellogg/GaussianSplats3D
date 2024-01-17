import * as THREE from 'three';
import { SplatBuffer } from './SplatBuffer.js';
import { SplatCompressor } from './SplatCompressor.js';
import { fetchWithProgress } from './Util.js';
import { SceneFormat } from './SceneFormat.js';

export class SplatLoader {

    constructor(splatBuffer = null) {
        this.splatBuffer = splatBuffer;
        this.downLoadLink = null;
    }

    static isFileSplatFormat(fileName) {
        return SplatLoader.isCustomSplatFormat(fileName) || SplatLoader.isStandardSplatFormat(fileName);
    }

    static isCustomSplatFormat(fileName) {
        return fileName.endsWith('.ksplat');
    }

    static isStandardSplatFormat(fileName) {
        return fileName.endsWith('.splat');
    }

    loadFromURL(fileName, onProgress, compressionLevel, minimumAlpha, blockSize, bucketSize, format) {
        return fetchWithProgress(fileName, onProgress).then((bufferData) => {
            const isCustomSplatFormat = format === SceneFormat.KSplat || SplatLoader.isCustomSplatFormat(fileName);
            let splatBuffer;
            if (isCustomSplatFormat) {
                splatBuffer = new SplatBuffer(bufferData);
            } else {
                const splatCompressor = new SplatCompressor(compressionLevel, minimumAlpha, blockSize, bucketSize);
                const splatArray = SplatLoader.parseStandardSplatToUncompressedSplatArray(bufferData);
                splatBuffer = splatCompressor.uncompressedSplatArrayToSplatBuffer(splatArray);
            }
            return splatBuffer;
        });
    }

    static parseStandardSplatToUncompressedSplatArray(inBuffer) {
        // Standard .splat row layout:
        // XYZ - Position (Float32)
        // XYZ - Scale (Float32)
        // RGBA - colors (uint8)
        // IJKL - quaternion/rot (uint8)

        const InBufferRowSizeBytes = 32;
        const splatCount = inBuffer.byteLength / InBufferRowSizeBytes;

        const splatArray = SplatCompressor.createEmptyUncompressedSplatArray();

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

            splatArray.addSplat(inCenter[0], inCenter[1], inCenter[2], inScale[0], inScale[1], inScale[2],
                                quat.w, quat.x, quat.y, quat.z, inColor[0], inColor[1], inColor[2], inColor[3]);
        }

        return splatArray;
    }

    setFromBuffer(splatBuffer) {
        this.splatBuffer = splatBuffer;
    }

    downloadFile(fileName) {
        const headerData = new Uint8Array(this.splatBuffer.getHeaderBufferData());
        const splatData = new Uint8Array(this.splatBuffer.getSplatBufferData());
        const blob = new Blob([headerData.buffer, splatData.buffer], {
            type: 'application/octet-stream',
        });

        if (!this.downLoadLink) {
            this.downLoadLink = document.createElement('a');
            document.body.appendChild(this.downLoadLink);
        }
        this.downLoadLink.download = fileName;
        this.downLoadLink.href = URL.createObjectURL(blob);
        this.downLoadLink.click();
    }

}
