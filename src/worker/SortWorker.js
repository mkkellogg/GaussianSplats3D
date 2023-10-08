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

    function sort(vertexSortCount, vertexRenderCount, viewProj, cameraPosition) {

        // console.time('WASM SORT');
        if (!countsZero) countsZero = new Uint32Array(Constants.DepthMapRange);
        const viewProjArray = new Int32Array(wasmMemory, viewProjOffset, 16);
        for (let i = 0; i < 16; i++) {
            viewProjArray[i] = Math.round(viewProj[i] * 1000.0);
        }
        const frequencies = new Uint32Array(wasmMemory, sortBuffersOffset + vertexCount * 4, Constants.DepthMapRange);
        frequencies.set(countsZero);
        wasmInstance.exports.sortIndexes(indexesOffset, positionsOffset, sortBuffersOffset, viewProjOffset,
                                         indexesOutOffset, cameraPosition[0], cameraPosition[1],
                                         cameraPosition[2], Constants.DepthMapRange, vertexSortCount, vertexRenderCount, vertexCount);

        // console.timeEnd('WASM SORT');

        self.postMessage({
            'sortDone': true,
            'vertexSortCount': vertexSortCount,
            'vertexRenderCount': vertexRenderCount
        });
    }

    self.onmessage = (e) => {
        if (e.data.positions) {
            positions = e.data.positions;
            const floatPositions = new Float32Array(positions);
            const intPositions = new Int32Array(vertexCount * 3);
            for (let i = 0; i < vertexCount * 3; i++) {
                intPositions[i] = Math.round(floatPositions[i] * 1000.0);
            }
            new Int32Array(wasmMemory, positionsOffset, vertexCount * 3).set(intPositions);
            self.postMessage({
                'sortSetupComplete': true,
            });
        } else if (e.data.sort) {
            const renderCount = e.data.sort.vertexRenderCount || 0;
            const sortCount = e.data.sort.vertexSortCount || 0;
            sort(sortCount, renderCount, e.data.sort.view, e.data.sort.cameraPosition, e.data.sort.inIndexBuffer);
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
