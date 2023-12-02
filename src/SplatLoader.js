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

        const splatArray = {
            'splatCount': splatCount,
            'scale_0': [],
            'scale_1': [],
            'scale_2': [],
            'rot_0': [],
            'rot_1': [],
            'rot_2': [],
            'rot_3': [],
            'x': [],
            'y': [],
            'z': [],
            'f_dc_0': [],
            'f_dc_1': [],
            'f_dc_2': [],
            'opacity': []
        };

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

            splatArray['scale_0'][i] = inScale[0];
            splatArray['scale_1'][i] = inScale[1];
            splatArray['scale_2'][i] = inScale[2];

            splatArray['rot_0'][i] = quat.w;
            splatArray['rot_1'][i] = quat.x;
            splatArray['rot_2'][i] = quat.y;
            splatArray['rot_3'][i] = quat.z;

            splatArray['x'][i] = inCenter[0];
            splatArray['y'][i] = inCenter[1];
            splatArray['z'][i] = inCenter[2];

            splatArray['f_dc_0'][i] = inColor[0];
            splatArray['f_dc_1'][i] = inColor[1];
            splatArray['f_dc_2'][i] = inColor[2];
            splatArray['opacity'][i] = inColor[3];
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
