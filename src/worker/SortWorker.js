import SorterWasm from './sorter.wasm';

function sortWorker(self) {

    let wasmInstance;
    let vertexCount;
    let indexesOffset;
    let positionsOffset;
    let precomputedCovariancesOffset;
    let precomputedColorsOffset;
    let centerCovariancesOffset;
    let outColorsOffset;
    let viewProjOffset;

    let sortBuffersOffset;

    let wasmMemory;

    function sort (vertexSortCount, viewProj, cameraPosition, indexBuffer) {
        
        const workerTransferIndexArray = new Float32Array(wasmMemory);
        workerTransferIndexArray.set(new Float32Array(indexBuffer));
        const viewProjArray = new Float32Array(wasmMemory, viewProjOffset, 16);
        viewProjArray.set(viewProj);
        console.time("SORT")
        wasmInstance.exports.sortIndexes(indexesOffset, positionsOffset, precomputedCovariancesOffset,
                                         precomputedColorsOffset, centerCovariancesOffset, outColorsOffset, sortBuffersOffset,
                                         viewProjOffset, cameraPosition[0], cameraPosition[1], cameraPosition[2], vertexSortCount, vertexCount);
        console.timeEnd("SORT");
        self.postMessage({
            'sortDone': true,
            'vertexSortCount': vertexSortCount
        });
    }

    self.onmessage = (e) => {
        if(e.data.sort) {
            const sortCount = e.data.sort.vertexSortCount || 0;
            if (sortCount > 0) {
                sort(sortCount, e.data.sort.view, e.data.sort.cameraPosition, e.data.sort.indexBuffer);
            }
        } else if (e.data.init) {

            vertexCount = e.data.init.vertexCount;

            const INDEXES_BYTES_PER_ENTRY = 4;
            const POSITIONS_BYTES_PER_ENTRY = 12;
            const PRECOMPUTED_COVARIANCES_BYTES_PER_ENTRY = 24;
            const CENTER_COVARIANCES_BYTES_PER_ENTRY = 36;
            const COLORS_BYTES_PER_ENTRY = 16;

            const wasmPromise = new Promise((resolve) => {

                const sorterWasmBytes = new Uint8Array(e.data.init.sorterWasmBytes);
                const memoryBytesPerVertex = INDEXES_BYTES_PER_ENTRY + POSITIONS_BYTES_PER_ENTRY  +
                                             PRECOMPUTED_COVARIANCES_BYTES_PER_ENTRY + COLORS_BYTES_PER_ENTRY +
                                             CENTER_COVARIANCES_BYTES_PER_ENTRY + COLORS_BYTES_PER_ENTRY;
                const memoryRequiredForVertices = vertexCount * memoryBytesPerVertex;
                const memoryRequiredForSortBuffers = 2 * 4 * vertexCount + 65536 * 2;
                const extraMemory = 65536 * 32;
                const totalRequiredMemory = memoryRequiredForVertices + memoryRequiredForSortBuffers + extraMemory;
                const totalPagesRequired = Math.floor(totalRequiredMemory / 65536);
                const sorterWasmImport = {
                    module: {},
                    env: {
                        memory: new WebAssembly.Memory({
                            initial: totalPagesRequired * 2,
                            maximum: totalPagesRequired * 3,
                            shared: false, 
                        }),
                    }
                };
                WebAssembly.compile(sorterWasmBytes)
                .then((wasmModule) => {
                    //console.log(wasmModule)
                    return WebAssembly.instantiate(wasmModule, sorterWasmImport);
                })
                .then((instance) => {
                    //console.log(wasmInstance)
                    //console.log(sorterWasmImport.env.memory)
        
                    wasmInstance = instance;

                    indexesOffset = 0;
                    positionsOffset = vertexCount * INDEXES_BYTES_PER_ENTRY;
                    precomputedCovariancesOffset = positionsOffset + vertexCount * POSITIONS_BYTES_PER_ENTRY;
                    precomputedColorsOffset = precomputedCovariancesOffset + vertexCount * PRECOMPUTED_COVARIANCES_BYTES_PER_ENTRY;
                    centerCovariancesOffset = precomputedColorsOffset + vertexCount * COLORS_BYTES_PER_ENTRY;
                    outColorsOffset = centerCovariancesOffset + vertexCount * CENTER_COVARIANCES_BYTES_PER_ENTRY;
                    viewProjOffset = outColorsOffset + vertexCount * COLORS_BYTES_PER_ENTRY;
                    sortBuffersOffset = viewProjOffset + 16 * 4;

                    wasmMemory = sorterWasmImport.env.memory.buffer;
                    self.postMessage({
                        'sortSetupComplete': true,
                        'wasmMemory': wasmMemory,
                        'indexesOffset': indexesOffset,
                        'positionsOffset': positionsOffset,
                        'precomputedCovariancesOffset': precomputedCovariancesOffset,
                        'precomputedColorsOffset': precomputedColorsOffset,
                        'centerCovariancesOffset': centerCovariancesOffset,
                        'outColorsOffset': outColorsOffset
                    });
                });
            });
        }
    };
}

export function createSortWorker(vertexCount, splatBufferRowBytes) {
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
            'vertexCount': vertexCount,
            'splatBufferRowBytes': splatBufferRowBytes
        }
    });
    return worker;
}