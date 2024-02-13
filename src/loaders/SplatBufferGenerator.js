import { SplatPartitioner } from './SplatPartitioner.js';
import { SplatBuffer } from './SplatBuffer.js';

export class SplatBufferGenerator {

    constructor(splatPartitioner, alphaRemovalThreshold, compressionLevel, blockSize, bucketSize) {
        this.splatPartitioner = splatPartitioner;
        this.alphaRemovalThreshold = alphaRemovalThreshold;
        this.compressionLevel = compressionLevel;
        this.blockSize = blockSize;
        this.bucketSize = bucketSize;
    }

    generateFromUncompressedSplatArray(splatArray) {
        const partitionResults = this.splatPartitioner.partitionUncompressedSplatArray(splatArray);
        return SplatBuffer.generateFromUncompressedSplatArrays(partitionResults.splatArrays,
                                                               this.alphaRemovalThreshold, this.compressionLevel,
                                                               this.blockSize, this.bucketSize, partitionResults.parameters);
    }

    static getStandardGenerator(alphaRemovalThreshold, compressionLevel, blockSize, bucketSize) {
        const splatPartitioner = SplatPartitioner.getFineGrainedPartitioner();
        return new SplatBufferGenerator(splatPartitioner, alphaRemovalThreshold, compressionLevel, blockSize, bucketSize);
    }
}
