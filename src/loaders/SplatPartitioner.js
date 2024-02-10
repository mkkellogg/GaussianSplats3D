import { UncompressedSplatArray } from './UncompressedSplatArray.js';

export class SplatPartitioner {

    constructor(sectionCount, sectionFilters, groupingParameters) {
        this.sectionCount = sectionCount;
        this.sectionFilters = sectionFilters;
        this.groupingParameters = groupingParameters;
    }

    partitionUncompressedSplatArray(splatArray) {
        const newArrays = [];
        for (let s = 0; s < this.sectionCount; s++) {
            const sectionSplats = new UncompressedSplatArray();
            const sectionFilter = this.sectionFilters[s];
            for (let i = 0; i < splatArray.splatCount; i++) {
                if (sectionFilter(i)) {
                    sectionSplats.addSplatFromArray(splatArray, i);
                }
            }
            newArrays.push(sectionSplats);
        }
        return {
            splatArrays: newArrays,
            parameters: this.groupingParameters
        };

    }

    static getStandardPartitioner() {
        const previewSectionFilter = (splatIndex) => {
            return splatIndex % 10 === 0;
        };
        const mainSectionFilter = (splatIndex) => {
            return splatIndex % 10 !== 0;
        };
        const sectionFilters = [previewSectionFilter, mainSectionFilter];
        const groupingParameters = [
            {
                blockSizeFactor: 1.0,
                bucketSizeFactor: .1,
            },
            {
                blockSizeFactor: 1.0,
                bucketSizeFactor: 1.0
            }
        ];
        return new SplatPartitioner(2, sectionFilters, groupingParameters);
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
