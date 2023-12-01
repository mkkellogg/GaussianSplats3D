import * as THREE from 'three';
import { SplatBuffer } from './SplatBuffer.js';
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
                    splatBuffer = SplatLoader.parseStandardSplatToSplatBuffer(bufferData);
                }
                resolve(splatBuffer);
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    static parseStandardSplatToSplatBuffer(inBuffer) {
        // Standard .splat row layout:
        // XYZ - Position (Float32)
        // XYZ - Scale (Float32)
        // RGBA - colors (uint8)
        // IJKL - quaternion/rot (uint8)

        const InBufferRowSizeBytes = 32;
        const splatCount = inBuffer.byteLength / InBufferRowSizeBytes;

        const headerSize = SplatBuffer.HeaderSizeBytes;
        const headerUint8 = new Uint8Array(new ArrayBuffer(headerSize));
        const headerUint32 = new Uint32Array(headerUint8.buffer);

        headerUint8[0] = 0; // version major
        headerUint8[1] = 0; // version minor
        headerUint8[2] = 0; // header extra K
        headerUint8[3] = 0; // compression level
        headerUint32[1] = splatCount;
        headerUint32[6] = 0; // compression scale rnage

        let bytesPerCenter = SplatBuffer.CompressionLevels[0].BytesPerCenter;
        let bytesPerScale = SplatBuffer.CompressionLevels[0].BytesPerScale;
        let bytesPerColor = SplatBuffer.CompressionLevels[0].BytesPerColor;
        let bytesPerRotation = SplatBuffer.CompressionLevels[0].BytesPerRotation;
        const centerBuffer = new ArrayBuffer(bytesPerCenter * splatCount);
        const scaleBuffer = new ArrayBuffer(bytesPerScale * splatCount);
        const colorBuffer = new ArrayBuffer(bytesPerColor * splatCount);
        const rotationBuffer = new ArrayBuffer(bytesPerRotation * splatCount);

        for (let i = 0; i < splatCount; i++) {
            const inCenterSizeBytes = 3 * 4;
            const inScaleSizeBytes = 3 * 4;
            const inColorSizeBytes = 4;
            const inBase = i * InBufferRowSizeBytes;
            const inCenter = new Float32Array(inBuffer, inBase, 3);
            const inScale = new Float32Array(inBuffer, inBase + inCenterSizeBytes, 3);
            const inColor = new Uint8Array(inBuffer, inBase + inCenterSizeBytes + inScaleSizeBytes, 4);
            const inRotation = new Uint8Array(inBuffer, inBase + inCenterSizeBytes + inScaleSizeBytes + inColorSizeBytes, 4);

            const outCenter = new Float32Array(centerBuffer, i * bytesPerCenter, 3);
            const outScale = new Float32Array(scaleBuffer, i * bytesPerScale, 3);
            const outRotation = new Float32Array(rotationBuffer, i * bytesPerRotation, 4);

            const quat = new THREE.Quaternion((inRotation[1] - 128) / 128, (inRotation[2] - 128) / 128,
                                              (inRotation[3] - 128) / 128, (inRotation[0] - 128) / 128);
            quat.normalize();
            outRotation.set([quat.w, quat.x, quat.y, quat.z]);
            outScale.set(inScale);
            outCenter.set(inCenter);

            const outColor = new Uint8ClampedArray(colorBuffer, i * bytesPerColor, 4);
            outColor.set(inColor);
        }

        const splatDataBufferSize = centerBuffer.byteLength + scaleBuffer.byteLength + colorBuffer.byteLength + rotationBuffer.byteLength;
        let unifiedBufferSize = headerSize + splatDataBufferSize;

        const unifiedBuffer = new ArrayBuffer(unifiedBufferSize);
        new Uint8Array(unifiedBuffer, 0, headerSize).set(headerUint8);
        new Uint8Array(unifiedBuffer, headerSize, centerBuffer.byteLength).set(new Uint8Array(centerBuffer));
        new Uint8Array(unifiedBuffer, headerSize + centerBuffer.byteLength, scaleBuffer.byteLength).set(new Uint8Array(scaleBuffer));
        new Uint8Array(unifiedBuffer, headerSize + centerBuffer.byteLength + scaleBuffer.byteLength,
                       colorBuffer.byteLength).set(new Uint8Array(colorBuffer));
        new Uint8Array(unifiedBuffer, headerSize + centerBuffer.byteLength + scaleBuffer.byteLength + colorBuffer.byteLength,
                       rotationBuffer.byteLength).set(new Uint8Array(rotationBuffer));

        const splatBuffer = new SplatBuffer(unifiedBuffer);
        return splatBuffer;
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
