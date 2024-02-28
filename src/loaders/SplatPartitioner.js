import * as THREE from 'three';
import { UncompressedSplatArray } from './UncompressedSplatArray.js';
import { SplatBuffer } from './SplatBuffer.js';

export class SplatPartitioner {

    constructor(sectionCount, sectionFilters, groupingParameters, partitionGenerator) {
        this.sectionCount = sectionCount;
        this.sectionFilters = sectionFilters;
        this.groupingParameters = groupingParameters;
        this.partitionGenerator = partitionGenerator;
    }

    partitionUncompressedSplatArray(splatArray) {
        let groupingParameters;
        let sectionCount;
        let sectionFilters;
        if (this.partitionGenerator) {
            const results = this.partitionGenerator(splatArray);
            groupingParameters = results.groupingParameters;
            sectionCount = results.sectionCount;
            sectionFilters = results.sectionFilters;
        } else {
            groupingParameters = this.groupingParameters;
            sectionCount = this.sectionCount;
            sectionFilters = this.sectionFilters;
        }

        const newArrays = [];
        for (let s = 0; s < sectionCount; s++) {
            const sectionSplats = new UncompressedSplatArray();
            const sectionFilter = sectionFilters[s];
            for (let i = 0; i < splatArray.splatCount; i++) {
                if (sectionFilter(i)) {
                    sectionSplats.addSplatFromArray(splatArray, i);
                }
            }
            newArrays.push(sectionSplats);
        }
        return {
            splatArrays: newArrays,
            parameters: groupingParameters
        };
    }

    static getStandardPartitioner(partitionSize = 0, sceneCenter = new THREE.Vector3(),
                                  blockSize = SplatBuffer.BucketBlockSize, bucketSize = SplatBuffer.BucketSize) {
        const partitionGenerator = (splatArray) => {

            if (partitionSize <= 0) partitionSize = splatArray.splatCount;

            const centerA = new THREE.Vector3();
            const centerB = new THREE.Vector3();
            const bucketizeSize = 0.5;
            const bucketSize = (point) => {
                point.x = Math.floor(point.x / bucketizeSize) * bucketizeSize;
                point.y = Math.floor(point.y / bucketizeSize) * bucketizeSize;
                point.z = Math.floor(point.z / bucketizeSize) * bucketizeSize;
            };
            splatArray.splats.sort((a, b) => {
                centerA.set(a['x'], a['y'], a['z']).sub(sceneCenter);
                bucketSize(centerA);
                const centerADist = centerA.lengthSq();
                centerB.set(b['x'], b['y'], b['z']).sub(sceneCenter);
                bucketSize(centerB);
                const centerBDist = centerB.lengthSq();
                if (centerADist > centerBDist) return 1;
                else return -1;
            });

            const sectionFilters = [];
            const groupingParameters = [];
            partitionSize = Math.min(splatArray.splatCount, partitionSize);
            const patitionCount = Math.ceil(splatArray.splatCount / partitionSize);
            let currentStartSplat = 0;
            for (let i = 0; i < patitionCount; i ++) {
                let startSplat = currentStartSplat;
                sectionFilters.push((splatIndex) => {
                    return splatIndex >= startSplat && splatIndex < startSplat + partitionSize;
                });
                groupingParameters.push({
                    'blocksSize': blockSize,
                    'bucketSize': bucketSize,
                });
                currentStartSplat += partitionSize;
            }
            return {
                'sectionCount': sectionFilters.length,
                sectionFilters,
                groupingParameters
            };
        };
        return new SplatPartitioner(undefined, undefined, undefined, partitionGenerator);
    }
}
