import { SplatPartitioner } from './SplatPartitioner.js';
import { SplatBuffer } from './SplatBuffer.js';

export class SplatBufferGenerator {

    constructor(splatPartitioner, alphaRemovalThreshold, compressionLevel, sectionSize, blockSize, bucketSize) {
        this.splatPartitioner = splatPartitioner;
        this.alphaRemovalThreshold = alphaRemovalThreshold;
        this.compressionLevel = compressionLevel;
        this.sectionSize = sectionSize;
        this.blockSize = blockSize;
        this.bucketSize = bucketSize;
    }

    generateFromUncompressedSplatArray(splatArray) {
        const partitionResults = this.splatPartitioner.partitionUncompressedSplatArray(splatArray);
        return SplatBuffer.generateFromUncompressedSplatArrays(partitionResults.splatArrays,
                                                               this.alphaRemovalThreshold, this.compressionLevel,
                                                               this.blockSize, this.bucketSize, partitionResults.parameters);
    }

    static getStandardGenerator(alphaRemovalThreshold = 1, compressionLevel = 1, sectionSize = 20000,
                                blockSize = SplatBuffer.BucketBlockSize, bucketSize = SplatBuffer.BucketSize) {
        const splatPartitioner = SplatPartitioner.getStandardPartitioner(sectionSize, blockSize, bucketSize);
        return new SplatBufferGenerator(splatPartitioner, alphaRemovalThreshold, compressionLevel, sectionSize, blockSize, bucketSize);
    }
}
