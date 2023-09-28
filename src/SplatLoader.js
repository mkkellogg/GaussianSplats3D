import { SplatBuffer } from './SplatBuffer.js';

export class SplatLoader {

    constructor(splatBuffer = null) {
        this.splatBuffer = splatBuffer;
        this.downLoadLink = null;
    }

    loadFromFile(fileName) {
        return new Promise((resolve, reject) => {
            fetch(fileName)
            .then((res) => {
                return res.arrayBuffer()
            })
            .then((bufferData) => {
                const splatBuffer = new SplatBuffer(bufferData);
                const fBuffer = new Float32Array(bufferData);
                for (let i = 0 ; i < splatBuffer.getVertexCount(); i++) {
                    const offset = i * 8;
                    const z = fBuffer[offset + 2];
                    const y = fBuffer[offset + 1];
                   // fBuffer[offset + 2] = y;
                   // fBuffer[offset + 1] = z;
                }
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

    saveToFile(fileName) {
        const splatData = new Uint8Array(this.splatBuffer.getBufferData());
        const blob = new Blob([splatData.buffer], {
            type: "application/octet-stream",
        });
       
        if (!this.downLoadLink) {
            this.downLoadLink = document.createElement("a");
            document.body.appendChild(this.downLoadLink);
        }
        this.downLoadLink.download = fileName;
        this.downLoadLink.href = URL.createObjectURL(blob);
        this.downLoadLink.click();
    }

}