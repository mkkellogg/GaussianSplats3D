import SorterWasm from './sorter.wasm';
import { Constants } from '../Constants.js';

function sortWorker(self) {

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

    let Constants;

    function sort(vertexSortCount, viewProj, cameraPosition) {

        // console.time('WASM SORT');
        if (!countsZero) countsZero = new Uint32Array(Constants.DepthMapRange);
        const viewProjArray = new Int32Array(wasmMemory, viewProjOffset, 16);
        for (let i = 0; i < 16; i++) {
            viewProjArray[i] = Math.round(viewProj[i] * 1000.0);
        }
        const counts1 = new Uint32Array(wasmMemory, sortBuffersOffset + vertexCount * 4, Constants.DepthMapRange);
        const counts2 = new Uint32Array(wasmMemory,
                                        sortBuffersOffset + vertexCount * 4 + Constants.DepthMapRange * 4, Constants.DepthMapRange);
        counts1.set(countsZero);
        counts2.set(countsZero);
        wasmInstance.exports.sortIndexes(indexesOffset, positionsOffset, sortBuffersOffset, viewProjOffset,
                                         indexesOutOffset, cameraPosition[0], cameraPosition[1],
                                         cameraPosition[2], Constants.DepthMapRange, vertexSortCount, vertexCount);

        // console.timeEnd('WASM SORT');


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
            const floatPositions = new Float32Array(positions);
            const intPositions = new Int32Array(vertexCount * 3);
            for (let i = 0; i < vertexCount * 3; i++) {
                intPositions[i] = Math.round(floatPositions[i] * 1000.0 );
            }
            new Int32Array(wasmMemory, positionsOffset, vertexCount * 3).set(intPositions);
            self.postMessage({
                'sortSetupComplete': true,
            });
        } else if (e.data.sort) {
            const sortCount = e.data.sort.vertexSortCount || 0;
            if (sortCount > 0) {
                sort(sortCount, e.data.sort.view, e.data.sort.cameraPosition, e.data.sort.inIndexBuffer);
            }
        } else if (e.data.init) {
            // Yep, this is super hacky and gross :(
            Constants = e.data.init.Constants;

            vertexCount = e.data.init.vertexCount;

            const INDEXES_BYTES_PER_ENTRY = Constants.BytesPerInt;
            const POSITIONS_BYTES_PER_ENTRY = Constants.BytesPerFloat * 3;

            const sorterWasmBytes = new Uint8Array(e.data.init.sorterWasmBytes);
            const memoryBytesPerVertex = INDEXES_BYTES_PER_ENTRY + POSITIONS_BYTES_PER_ENTRY;
            const memoryRequiredForVertices = vertexCount * memoryBytesPerVertex;
            const memoryRequiredForSortBuffers = vertexCount * Constants.BytesPerInt * 2 +
                                                 Constants.DepthMapRange * Constants.BytesPerInt * 2;
            const extraMemory = Constants.MemoryPageSize * 32;
            const totalRequiredMemory = memoryRequiredForVertices + memoryRequiredForSortBuffers + extraMemory;
            const totalPagesRequired = Math.floor(totalRequiredMemory / Constants.MemoryPageSize ) + 1;
            const sorterWasmImport = {
                module: {},
                env: {
                    memory: new WebAssembly.Memory({
                        initial: totalPagesRequired * 2,
                        maximum: totalPagesRequired * 3,
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
                indexesOffset = 0;
                positionsOffset = vertexCount * INDEXES_BYTES_PER_ENTRY;
                viewProjOffset = positionsOffset + vertexCount * POSITIONS_BYTES_PER_ENTRY;
                sortBuffersOffset = viewProjOffset + 16 * Constants.BytesPerFloat;
                indexesOutOffset = sortBuffersOffset + vertexCount * Constants.BytesPerInt +
                                   Constants.DepthMapRange * Constants.BytesPerInt * 2;
                wasmMemory = sorterWasmImport.env.memory.buffer;
                self.postMessage({
                    'sortSetupPhase1Complete': true,
                    'inIndexBuffer': wasmMemory,
                    'inIndexOffset': 0,
                    'outIndexBuffer': wasmMemory,
                    'outIndexOffset': indexesOutOffset
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
            'splatBufferRowBytes': splatBufferRowBytes,
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
