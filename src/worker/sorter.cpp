#include <emscripten/emscripten.h>
#include<iostream>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

EXTERN EMSCRIPTEN_KEEPALIVE void sortIndexes(unsigned int *indexes, unsigned int indexCount) {
    for (int i = 0; i < indexCount / 2; i++) {
        indexes[i] = indexes[indexCount - 1 - i];
    }
}
