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

    loadFromURL(fileName, compressionLevel = 0, minimumAlpha = 1) {
        return new Promise((resolve, reject) => {
            const loadPromise = this.fetchFile(fileName);
            loadPromise
            .then((plyFileData) => {
                const plyParser = new PlyParser(plyFileData);
                const splatBuffer = plyParser.parseToSplatBuffer(compressionLevel, minimumAlpha);
                this.splatBuffer = splatBuffer;
                resolve(splatBuffer);
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

}
