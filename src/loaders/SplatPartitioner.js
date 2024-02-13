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

    static getFineGrainedPartitioner() {
        const partitionGenerator = (splatArray) => {
            const partitionSize = 50000;
            const bucketSizeFactor = partitionSize / 1300000;
            const sectionFilters = [];
            const groupingParameters = [];
            const patitionCount = Math.floor(splatArray.splatCount / partitionSize);
            for (let i = 0; i < patitionCount; i ++) {
                let targetIndex = i;
                sectionFilters.push((splatIndex) => {
                    return splatIndex % patitionCount === targetIndex;
                });
                groupingParameters.push({
                    blockSizeFactor: 1.0,
                    bucketSizeFactor: bucketSizeFactor,
                });
            }
            return {
                'sectionCount': sectionFilters.length,
                sectionFilters,
                groupingParameters
            };
        };
        return new SplatPartitioner(undefined, undefined, undefined, partitionGenerator);
    }

    static getStandardPartitioner() {
        const sectionFilters = [
            (splatIndex) => {
                return splatIndex % 10 === 0;
            },
            (splatIndex) => {
                return splatIndex % 10 !== 0;
            }
        ];
        const groupingParameters = [
            {
                blockSizeFactor: 1.0,
                bucketSizeFactor: 1.0,
            },
            {
                blockSizeFactor: 1.0,
                bucketSizeFactor: 0.1,
            }
        ];
        return new SplatPartitioner(sectionFilters.length, sectionFilters, groupingParameters);
    }

    static getSingleSectionPartitioner() {
        const groupingParameters = [
            {
                blockSizeFactor: 1.0,
                bucketSizeFactor: 1.0,
            }
        ];
        return new SplatPartitioner(1, [() => true], groupingParameters);
    }
}
