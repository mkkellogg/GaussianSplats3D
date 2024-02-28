import * as THREE from 'three';
import { SplatPartitioner } from './SplatPartitioner.js';
import { SplatBuffer } from './SplatBuffer.js';

export class SplatBufferGenerator {

    constructor(splatPartitioner, alphaRemovalThreshold, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize) {
        this.splatPartitioner = splatPartitioner;
        this.alphaRemovalThreshold = alphaRemovalThreshold;
        this.compressionLevel = compressionLevel;
        this.sectionSize = sectionSize;
        this.sceneCenter = sceneCenter ? new THREE.Vector3().copy(sceneCenter) : undefined;
        this.blockSize = blockSize;
        this.bucketSize = bucketSize;
    }

    generateFromUncompressedSplatArray(splatArray) {
        const partitionResults = this.splatPartitioner.partitionUncompressedSplatArray(splatArray);
        return SplatBuffer.generateFromUncompressedSplatArrays(partitionResults.splatArrays,
                                                               this.alphaRemovalThreshold, this.compressionLevel,
                                                               this.sceneCenter, this.blockSize, this.bucketSize,
                                                               partitionResults.parameters);
    }

    static getStandardGenerator(alphaRemovalThreshold = 1, compressionLevel = 1, sectionSize = 0, sceneCenter = new THREE.Vector3(),
                                blockSize = SplatBuffer.BucketBlockSize, bucketSize = SplatBuffer.BucketSize) {
        const splatPartitioner = SplatPartitioner.getStandardPartitioner(sectionSize, sceneCenter, blockSize, bucketSize);
        return new SplatBufferGenerator(splatPartitioner, alphaRemovalThreshold, compressionLevel,
                                        sectionSize, sceneCenter, blockSize, bucketSize);
    }
}
