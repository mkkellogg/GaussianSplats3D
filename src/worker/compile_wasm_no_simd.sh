em++ -std=c++11 sorter_no_simd.cpp -Os -s WASM=1 -s SIDE_MODULE=2 -o sorter_no_simd.wasm -s IMPORTED_MEMORY=1 -s USE_PTHREADS=1
