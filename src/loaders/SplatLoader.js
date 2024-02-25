import { SplatBufferGenerator } from './SplatBufferGenerator.js';
import { SplatParser } from './SplatParser.js';
import { fetchWithProgress } from '../Util.js';

export class SplatLoader {

    constructor(splatBuffer = null) {
        this.splatBuffer = splatBuffer;
        this.downLoadLink = null;
    }

    loadFromURL(fileName, onProgress, compressionLevel, minimumAlpha, sectionSize, sceneCenter, blockSize, bucketSize) {
        return fetchWithProgress(fileName, onProgress).then((bufferData) => {
            const splatArray = SplatParser.parseStandardSplatToUncompressedSplatArray(bufferData);
            const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(minimumAlpha, compressionLevel,
                                                                                   sectionSize, sceneCenter, blockSize, bucketSize);
             return splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
        });
    }

    setFromBuffer(splatBuffer) {
        this.splatBuffer = splatBuffer;
    }

    static downloadFile = function() {

        let downLoadLink;

        return function(splatBuffer, fileName) {
            const blob = new Blob([splatBuffer.bufferData], {
                type: 'application/octet-stream',
            });

            if (!downLoadLink) {
                downLoadLink = document.createElement('a');
                document.body.appendChild(downLoadLink);
            }
            downLoadLink.download = fileName;
            downLoadLink.href = URL.createObjectURL(blob);
            downLoadLink.click();
        };

    }();

}
