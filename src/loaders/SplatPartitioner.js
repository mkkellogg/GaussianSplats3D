import { UncompressedSplatArray } from './UncompressedSplatArray.js';

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

    static getStandardPartitioner(partitionSize = 20000, blockSize = 10.0, bucketSize = 5) {
        const partitionGenerator = (splatArray) => {
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
