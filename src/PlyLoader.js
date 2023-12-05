import { PlyParser } from './PlyParser.js';
import { fetchWithProgress } from './Util.js';

export class PlyLoader {

    constructor() {
        this.splatBuffer = null;
    }

    fetchFile(fileName, onProgress) {
        return new Promise((resolve, reject) => {
            fetchWithProgress(fileName, onProgress)
            .then((data) => {
                resolve(data);
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    loadFromURL(fileName, onProgress, compressionLevel, minimumAlpha, blockSize, bucketSize) {
        return new Promise((resolve, reject) => {
            const loadPromise = this.fetchFile(fileName, onProgress);
            loadPromise
            .then((plyFileData) => {
                const plyParser = new PlyParser(plyFileData);
                const splatBuffer = plyParser.parseToSplatBuffer(compressionLevel, minimumAlpha, blockSize, bucketSize);
                this.splatBuffer = splatBuffer;
                resolve(splatBuffer);
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

}
