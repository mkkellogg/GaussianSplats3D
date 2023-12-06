import SorterWasm from './sorter.wasm';
import { Constants } from '../Constants.js';

function sortWorker(self) {

    let wasmInstance;
    let wasmMemory;
    let splatCount;
    let indexesToSortOffset;
    let sortedIndexesOffset;
    let precomputedDistancesOffset;
    let mappedDistancesOffset;
    let frequenciesOffset;
    let centersOffset;
    let modelViewProjOffset;
    let countsZero;

    let Constants;

    function sort(splatSortCount, splatRenderCount, modelViewProj, usePrecomputedDistances) {
        const sortStartTime = performance.now();
        if (!countsZero) countsZero = new Uint32Array(Constants.DepthMapRange);
        new Int32Array(wasmMemory, modelViewProjOffset, 16).set(modelViewProj);
        new Uint32Array(wasmMemory, frequenciesOffset, Constants.DepthMapRange).set(countsZero);
        wasmInstance.exports.sortIndexes(indexesToSortOffset, centersOffset, precomputedDistancesOffset,
                                         mappedDistancesOffset, frequenciesOffset, modelViewProjOffset,
                                         sortedIndexesOffset, Constants.DepthMapRange, splatSortCount,
                                         splatRenderCount, splatCount, usePrecomputedDistances);
        const sortEndTime = performance.now();

        self.postMessage({
            'sortDone': true,
            'splatSortCount': splatSortCount,
            'splatRenderCount': splatRenderCount,
            'sortTime': sortEndTime - sortStartTime
        });
    }

    self.onmessage = (e) => {
        if (e.data.centers) {
            centers = e.data.centers;
            new Int32Array(wasmMemory, centersOffset, splatCount * 4).set(new Int32Array(centers));
            self.postMessage({
                'sortSetupComplete': true,
            });
        } else if (e.data.sort) {
            const renderCount = e.data.sort.splatRenderCount || 0;
            const sortCount = e.data.sort.splatSortCount || 0;
            sort(sortCount, renderCount, e.data.sort.modelViewProj, e.data.sort.usePrecomputedDistances);
        } else if (e.data.init) {
            // Yep, this is super hacky and gross :(
            Constants = e.data.init.Constants;

            splatCount = e.data.init.splatCount;

            const CENTERS_BYTES_PER_ENTRY = Constants.BytesPerInt * 4;

            const sorterWasmBytes = new Uint8Array(e.data.init.sorterWasmBytes);

            const memoryRequiredForIndexesToSort = splatCount * Constants.BytesPerInt;
            const memoryRequiredForCenters = splatCount * CENTERS_BYTES_PER_ENTRY;
            const memoryRequiredForViewProjMatrix = 16 * Constants.BytesPerFloat;
            const memoryRequiredForPrecomputedDistances = splatCount * Constants.BytesPerInt;
            const memoryRequiredForMappedDistances = splatCount * Constants.BytesPerInt;
            const memoryRequiredForSortedIndexes = splatCount * Constants.BytesPerInt;
            const memoryRequiredForIntermediateSortBuffers = Constants.DepthMapRange * Constants.BytesPerInt * 2;
            const extraMemory = Constants.MemoryPageSize * 32;

            const totalRequiredMemory = memoryRequiredForIndexesToSort +
                                        memoryRequiredForCenters +
                                        memoryRequiredForViewProjMatrix +
                                        memoryRequiredForPrecomputedDistances +
                                        memoryRequiredForMappedDistances +
                                        memoryRequiredForSortedIndexes +
                                        memoryRequiredForIntermediateSortBuffers +
                                        extraMemory;
            const totalPagesRequired = Math.floor(totalRequiredMemory / Constants.MemoryPageSize ) + 1;
            const sorterWasmImport = {
                module: {},
                env: {
                    memory: new WebAssembly.Memory({
                        initial: totalPagesRequired * 2,
                        maximum: totalPagesRequired * 4,
                        shared: true,
                    }),
                }
            };
            WebAssembly.compile(sorterWasmBytes)
            .then((wasmModule) => {
                return WebAssembly.instantiate(wasmModule, sorterWasmImport);
            })
            .then((instance) => {
                wasmInstance = instance;
                indexesToSortOffset = 0;
                centersOffset = indexesToSortOffset + memoryRequiredForIndexesToSort;
                modelViewProjOffset = centersOffset + memoryRequiredForCenters;
                precomputedDistancesOffset = modelViewProjOffset + memoryRequiredForViewProjMatrix;
                mappedDistancesOffset = precomputedDistancesOffset + memoryRequiredForPrecomputedDistances;
                frequenciesOffset = mappedDistancesOffset + memoryRequiredForMappedDistances;
                sortedIndexesOffset = frequenciesOffset + memoryRequiredForIntermediateSortBuffers;
                wasmMemory = sorterWasmImport.env.memory.buffer;
                self.postMessage({
                    'sortSetupPhase1Complete': true,
                    'indexesToSortBuffer': wasmMemory,
                    'indexesToSortOffset': indexesToSortOffset,
                    'sortedIndexesBuffer': wasmMemory,
                    'sortedIndexesOffset': sortedIndexesOffset,
                    'precomputedDistancesBuffer': wasmMemory,
                    'precomputedDistancesOffset': precomputedDistancesOffset
                });
            });
        }
    };
}

export function createSortWorker(splatCount) {
    const worker = new Worker(
        URL.createObjectURL(
            new Blob(['(', sortWorker.toString(), ')(self)'], {
                type: 'application/javascript',
            }),
        ),
    );

    const sorterWasmBinaryString = atob(SorterWasm);
    const sorterWasmBytes = new Uint8Array(sorterWasmBinaryString.length);
    for (let i = 0; i < sorterWasmBinaryString.length; i++) {
        sorterWasmBytes[i] = sorterWasmBinaryString.charCodeAt(i);
    }

    worker.postMessage({
        'init': {
            'sorterWasmBytes': sorterWasmBytes.buffer,
            'splatCount': splatCount,
            // Super hacky
            'Constants': {
                'BytesPerFloat': Constants.BytesPerFloat,
                'BytesPerInt': Constants.BytesPerInt,
                'DepthMapRange': Constants.DepthMapRange,
                'MemoryPageSize': Constants.MemoryPageSize
            }
        }
    });
    return worker;
}
