import SorterWasm from './sorter.wasm';

function sortWorker(self) {

    let wasmModule;

    function sort () {
        self.postMessage({
            'sortDone': true,
        });
    }

    self.onmessage = (e) => {
        if(e.data.sort) {
            sort();
        } else if (e.data.wasm) {
            wasmModule = e.data.wasm;
        }
    };
}

export function createSortWorker(maxIndexes) {
    return new Promise((resolve) => {

        var sorterWasmBinaryString = atob(SorterWasm);
        var sorterWasmBytes = new Uint8Array(sorterWasmBinaryString.length);
        for (let i = 0; i < sorterWasmBinaryString.length; i++) {
            sorterWasmBytes[i] = sorterWasmBinaryString.charCodeAt(i);
        }

        const sorterWasmImport = {
            module: {},
            env: {
              memory: new WebAssembly.Memory({ initial: 1024 }), //1024 pages, 1 page = 64Kb
            }
        };
        WebAssembly.compile(sorterWasmBytes)
        .then((wasmModule) => {
            //console.log(wasmModule)
            return WebAssembly.instantiate(wasmModule, sorterWasmImport);
        })
        .then((wasmInstance) => {
            //console.log(wasmInstance)
            //console.log(sorterWasmImport.env.memory)

            const textIndexCount = 1024;
            const testIndexes = new Uint32Array(textIndexCount);
            for (let i = 0; i < textIndexCount; i++) {
                testIndexes[i] = i;
            }
            const dest = new Uint32Array(sorterWasmImport.env.memory.buffer);
            dest.set(testIndexes);
            wasmInstance.exports.sortIndexes(0, textIndexCount);
        });
        

        const worker = new Worker(
            URL.createObjectURL(
                new Blob(['(', sortWorker.toString(), ')(self)'], {
                    type: 'application/javascript',
                }),
            ),
        );
        resolve(worker);

        /*SorterWasm().then((wasm) => {
            const worker = new Worker(
                URL.createObjectURL(
                    new Blob(['(', sortWorker.toString(), ')(self)'], {
                        type: 'application/javascript',
                    }),
                ),
            );
            const GOT = {};
            const GOTFuncHandler = () => {};
            const GOTMemHandler = () => {};
         
            const byteArray = new SharedArrayBuffer(1024);
            const importObject={
                env:{
                    memoryBase: 0,
                    tableBase: 0,
                    memory: new WebAssembly.Memory({
                      initial: 256
                    }),
                    table: new WebAssembly.Table({
                      initial: 0,
                      element: 'anyfunc'
                    }),
                  },

            }
              var g_importObject = {
                'env': {
                    memory: new WebAssembly.Memory({ initial: 256 }),
                }
            };
            const importObject2 = {
                env: {
                  __memory_base: 0,
                }
              };
              WebAssembly.instantiate(wasm, g_importObject).then((instance) => {
               // instance.exports.exported_func();
              });
            worker.postMessage({
                'wasm': wasm
            });
            resolve(worker);
        });*/
    });
}