import { PlyParser } from './PlyParser.js';
import { fetchWithProgress, delayedExecute } from '../../Util.js';
import { LoaderStatus } from '../LoaderStatus.js';

export class PlyLoader {

    constructor() {
        this.splatBuffer = null;
    }

    loadFromURL(fileName, onProgress, compressionLevel, minimumAlpha, sectionSize, sceneCenter, blockSize, bucketSize, compressed) {
        const downloadProgress = (percent, percentLabel) => {
            if (onProgress) onProgress(percent, percentLabel, LoaderStatus.Downloading);
        };
        return fetchWithProgress(fileName, downloadProgress).then((plyFileData) => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            return delayedExecute(() => {
                if (compressed) {

                } else {
                    return PlyParser.parseToUncompressedSplatArray(plyFileData);
                }
            });
        })
        .then((splatArray) => {
            const splatBufferGenerator = GaussianSplats3D.SplatBufferGenerator.getStandardGenerator(minimumAlpha,
                                                                                                    compressionLevel, sectionSize,
                                                                                                    sceneCenter, blockSize, bucketSize);
            const splatBuffer = splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
            if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
            return splatBuffer;
        });
    }

}
