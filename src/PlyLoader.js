import { PlyParser } from './PlyParser.js';
import { fetchWithProgress } from './Util.js';
import { AbortablePromise } from './AbortablePromise.js';

export class PlyLoader {

    constructor() {
        this.splatBuffer = null;
    }

    loadFromURL(fileName, onProgress, compressionLevel, minimumAlpha, blockSize, bucketSize) {
        const fetchPromise = fetchWithProgress(fileName, onProgress);
        return new AbortablePromise((resolve, reject) => {
            fetchPromise.then((plyFileData) => {
                const plyParser = new PlyParser(plyFileData);
                const splatBuffer = plyParser.parseToSplatBuffer(compressionLevel, minimumAlpha, blockSize, bucketSize);
                this.splatBuffer = splatBuffer;
                resolve(splatBuffer);
            })
            .catch((err) => {
                reject(err);
            });
        }, fetchPromise.abortHandler);
    }

}
