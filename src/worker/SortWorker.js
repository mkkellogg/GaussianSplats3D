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

    let positions;

    let countsZero;

    function sort (vertexSortCount, viewProj, cameraPosition, indexBuffer) {
  
        if (!countsZero) countsZero = new Uint32Array(65536);
        const indexArray = new Uint32Array(indexBuffer, 0, vertexSortCount);
        const workerTransferIndexArray = new Uint32Array(wasmMemory);
        workerTransferIndexArray.set(indexArray);
        const viewProjArray = new Float32Array(wasmMemory, viewProjOffset, 16);
        viewProjArray.set(viewProj);
        console.time("SORT")
        const counts = new Uint32Array(wasmMemory, sortBuffersOffset + vertexCount * 4, 65536);
        const counts2 = new Uint32Array(wasmMemory, sortBuffersOffset + vertexCount * 4 + 65536, 65536);
        counts.set(countsZero);
        counts2.set(countsZero);
        console.time("SORT_MAIN")
        wasmInstance.exports.sortIndexes(indexesOffset, positionsOffset, precomputedCovariancesOffset,
                                         precomputedColorsOffset, centerCovariancesOffset, outColorsOffset, sortBuffersOffset,
                                         viewProjOffset, cameraPosition[0], cameraPosition[1], cameraPosition[2], vertexSortCount, vertexCount);
        const sortedIndexes = new Uint32Array(wasmMemory, sortBuffersOffset + vertexCount * 4 + 65536 + 65536, vertexSortCount);
        indexArray.set(sortedIndexes)
        console.timeEnd("SORT_MAIN");
        console.timeEnd("SORT");
        self.postMessage({
            'sortDone': true,
            'vertexSortCount': vertexSortCount
        });
    }

    self.onmessage = (e) => {
        if (e.data.buffers) {
            positions = e.data.buffers.positions;
            new Float32Array(wasmMemory, positionsOffset, vertexCount * 3).set(new Float32Array(positions));
            self.postMessage({
                'sortBuffersSetup': true,
            });
        } else if(e.data.sort) {
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
                        'sortSetupComplete': true
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