import SorterWasm from './sorter.wasm';

function sortWorker(self) {

    const DEPTH_MAP_RANGE = 65536;
    const MEMORY_PAGE_SIZE = 65536;

    let wasmInstance;
    let vertexCount;
    let indexesOffset;
    let positionsOffset;
    let viewProjOffset;
    let indexesOutOffset;
    let sortBuffersOffset;
    let wasmMemory;
    let positions;
    let countsZero;
    let depthMix;

    function sort (vertexSortCount, viewProj, cameraPosition, indexBuffer) {

        //console.time("WASM SORT")
        if (!countsZero) countsZero = new Uint32Array(DEPTH_MAP_RANGE);
        const indexArray = new Uint32Array(indexBuffer, 0, vertexSortCount);
        const workerTransferIndexArray = new Uint32Array(wasmMemory);
        workerTransferIndexArray.set(indexArray);
        const viewProjArray = new Float32Array(wasmMemory, viewProjOffset, 16);
        viewProjArray.set(viewProj);
        const counts1 = new Uint32Array(wasmMemory, sortBuffersOffset + vertexCount * 4, DEPTH_MAP_RANGE);
        const counts2 = new Uint32Array(wasmMemory, sortBuffersOffset + vertexCount * 4 + DEPTH_MAP_RANGE * 4, DEPTH_MAP_RANGE);
        counts1.set(countsZero);
        counts2.set(countsZero);
        wasmInstance.exports.sortIndexes(indexesOffset, positionsOffset, sortBuffersOffset, viewProjOffset,
                                         indexesOutOffset, cameraPosition[0], cameraPosition[1], cameraPosition[2], vertexSortCount, vertexCount);
        const sortedIndexes = new Uint32Array(wasmMemory, indexesOutOffset, vertexSortCount);

        indexArray.set(sortedIndexes)
        //console.timeEnd("WASM SORT");



        // Leaving the JavaScript sort code in for debugging
        /*
        console.time("JS SORT");

        const positionsArray = new Float32Array(positions);
        const indexArray = new Uint32Array(indexBuffer, 0, vertexSortCount);

        if (!depthMix || depthMix.length !== vertexCount) {
            depthMix = new BigInt64Array(vertexCount);
        }

        const floatMix = new Float32Array(depthMix.buffer);
        const indexMix = new Uint32Array(depthMix.buffer);

        for (let j = 0; j < vertexSortCount; j++) {
            let i = indexArray[j];
            indexMix[2 * j] = i;
            const splatArrayBase = 3 * i;
            const dx = positionsArray[splatArrayBase] - cameraPosition[0];
            const dy = positionsArray[splatArrayBase + 1] - cameraPosition[1];
            const dz = positionsArray[splatArrayBase + 2] - cameraPosition[2];
            floatMix[2 * j + 1] = dx * dx + dy * dy + dz * dz;
        }
        lastProj = viewProj;

        const depthMixView = new BigInt64Array(depthMix.buffer, 0, vertexSortCount);
        depthMixView.sort();

        for (let j = 0; j < vertexSortCount; j++) {
            indexArray[j] = indexMix[2 * j];
        }
        console.timeEnd("JS SORT");*/


    
        self.postMessage({
            'sortDone': true,
            'vertexSortCount': vertexSortCount
        });
    }

    self.onmessage = (e) => {
        if (e.data.positions) {
            positions = e.data.positions;
            new Float32Array(wasmMemory, positionsOffset, vertexCount * 3).set(new Float32Array(positions));
            self.postMessage({
                'sortSetupComplete': true,
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

            const sorterWasmBytes = new Uint8Array(e.data.init.sorterWasmBytes);
            const memoryBytesPerVertex = INDEXES_BYTES_PER_ENTRY + POSITIONS_BYTES_PER_ENTRY;
            const memoryRequiredForVertices = vertexCount * memoryBytesPerVertex;
            const memoryRequiredForSortBuffers = 2 * 4 * vertexCount + DEPTH_MAP_RANGE * 4 * 2;
            const extraMemory = MEMORY_PAGE_SIZE * 32;
            const totalRequiredMemory = memoryRequiredForVertices + memoryRequiredForSortBuffers + extraMemory;
            const totalPagesRequired = Math.floor(totalRequiredMemory / MEMORY_PAGE_SIZE) + 1;
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
                return WebAssembly.instantiate(wasmModule, sorterWasmImport);
            })
            .then((instance) => {
                wasmInstance = instance;
                indexesOffset = 0;
                positionsOffset = vertexCount * INDEXES_BYTES_PER_ENTRY;
                viewProjOffset = positionsOffset + vertexCount * POSITIONS_BYTES_PER_ENTRY;
                sortBuffersOffset = viewProjOffset + 16 * 4;
                indexesOutOffset = sortBuffersOffset + vertexCount * 4 + DEPTH_MAP_RANGE * 4 * 2;
                wasmMemory = sorterWasmImport.env.memory.buffer;
                self.postMessage({
                    'sortSetupPhase1Complete': true
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