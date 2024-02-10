import { SplatBuffer } from './SplatBuffer.js';
import { SplatCompressor } from './SplatCompressor.js';
import { SplatParser } from './SplatParser.js';
import { fetchWithProgress } from '../Util.js';
import { SceneFormat } from '../SceneFormat.js';

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

    loadFromURL(fileName, onProgress, compressionLevel, minimumAlpha, blockSize, bucketSize, format) {
        return fetchWithProgress(fileName, onProgress).then((bufferData) => {
            const isCustomSplatFormat = format === SceneFormat.KSplat || SplatLoader.isCustomSplatFormat(fileName);
            let splatBuffer;
            if (isCustomSplatFormat) {
                splatBuffer = new SplatBuffer(bufferData);
            } else {
                const splatArray = SplatParser.parseStandardSplatToUncompressedSplatArray(bufferData);
                const splatPartitioner = GaussianSplats3D.SplatPartitioner.getStandardPartitioner();
                const partitionResults = splatPartitioner.partitionUncompressedSplatArray(splatArray);
                const splatCompressor = new GaussianSplats3D.SplatCompressor(minimumAlpha, compressionLevel);
                return splatCompressor.uncompressedSplatArraysToSplatBuffer(partitionResults.splatArrays,
                                                                            blockSize, bucketSize, partitionResults.parameters);
            }
            return splatBuffer;
        });
    }

    setFromBuffer(splatBuffer) {
        this.splatBuffer = splatBuffer;
    }

    static downloadFile = function() {

        let downLoadLink;

        return function(splatBuffer, fileName) {
            const headerData = new Uint8Array(splatBuffer.getHeaderBufferData());
            const sectionHeaderData = new Uint8Array(splatBuffer.getSectionHeaderBufferData());
            const splatData = new Uint8Array(splatBuffer.getSplatBufferData());
            const blob = new Blob([headerData.buffer, sectionHeaderData.buffer, splatData.buffer], {
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
