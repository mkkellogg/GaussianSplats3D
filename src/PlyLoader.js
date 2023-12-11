import { PlyParser } from './PlyParser.js';
import { fetchWithProgress } from './Util.js';

export class PlyLoader {

    constructor() {
        this.splatBuffer = null;
    }

    loadFromURL(fileName, onProgress, compressionLevel, minimumAlpha, blockSize, bucketSize) {
        return fetchWithProgress(fileName, onProgress).then((plyFileData) => {
            const plyParser = new PlyParser(plyFileData);
            const splatBuffer = plyParser.parseToSplatBuffer(compressionLevel, minimumAlpha, blockSize, bucketSize);
            this.splatBuffer = splatBuffer;
            return splatBuffer;
        });
    }

}
