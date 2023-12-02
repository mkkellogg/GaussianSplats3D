import * as THREE from 'three';
import { SplatBuffer } from './SplatBuffer.js';
import { SplatCompressor } from './SplatCompressor.js';
import { fetchWithProgress } from './Util.js';

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

    loadFromURL(fileName, onProgress) {
        return new Promise((resolve, reject) => {
            fetchWithProgress(fileName, onProgress)
            .then((bufferData) => {
                let splatBuffer;
                if (SplatLoader.isCustomSplatFormat(fileName)) {
                    splatBuffer = new SplatBuffer(bufferData);
                } else {
                    const splatCompressor = new SplatCompressor(0, 1);
                    const splatArray = SplatLoader.parseStandardSplatToUncompressedSplatArray(bufferData);
                    splatBuffer = splatCompressor.uncompressedSplatArrayToSplatBuffer(splatArray);
                }
                resolve(splatBuffer);
            })
            .catch((err) => {
                reject(err);
            });
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

        const splatArray = [];
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
            const splat = {
                'scale_0': inScale[0],
                'scale_1': inScale[1],
                'scale_2': inScale[2],
                'rot_0': quat.w,
                'rot_1': quat.x,
                'rot_2': quat.y,
                'rot_3': quat.z,
                'x': inCenter[0],
                'y': inCenter[1],
                'z': inCenter[2],
                'f_dc_0': inColor[0],
                'f_dc_1': inColor[1],
                'f_dc_2': inColor[2],
                'opacity': inColor[3]
            };
            splatArray.push(splat);
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
