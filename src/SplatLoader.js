import { SplatBuffer } from './SplatBuffer.js';
import { fetchWithProgress } from './Util.js';

export class SplatLoader {

    constructor(splatBuffer = null) {
        this.splatBuffer = splatBuffer;
        this.downLoadLink = null;
    }

    loadFromURL(fileName, onProgress) {
        return new Promise((resolve, reject) => {
            fetchWithProgress(fileName, onProgress)
            .then((bufferData) => {
                const splatBuffer = new SplatBuffer(bufferData);
                resolve(splatBuffer);
            })
            .catch((err) => {
                reject(err);
            });
        });
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
