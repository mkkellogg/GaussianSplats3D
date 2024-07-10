em++ -std=c++11 sorter.cpp -Os -s WASM=1 -s SIDE_MODULE=2 -o sorter.wasm -s IMPORTED_MEMORY=1 -s USE_PTHREADS=1 -msimd128
