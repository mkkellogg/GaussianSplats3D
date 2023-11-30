import { PlyParser } from './PlyParser.js';
import { fetchWithProgress } from './Util.js';

export class PlyLoader {

    constructor() {
        this.splatBuffer = null;
    }

    fetchFile(fileName, onProgress, signal) {
        return new Promise((resolve, reject) => {
            fetchWithProgress(fileName, onProgress, signal)
            .then((data) => {
                resolve(data);
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    loadFromURL(fileName, onProgress, compressionLevel = 0, minimumAlpha = 1, signal) {
        return new Promise((resolve, reject) => {
            const loadPromise = this.fetchFile(fileName, onProgress, signal);
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
