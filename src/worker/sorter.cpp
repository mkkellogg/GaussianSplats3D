#include <emscripten/emscripten.h>
#include <iostream>
#include <wasm_simd128.h>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

inline int abs(int x) {
    int s = x >> 31;
    return (x ^ s) - s;
}


EXTERN EMSCRIPTEN_KEEPALIVE void sortIndexes(unsigned int* indexes, int* positions, char* sortBuffers, int* viewProj,
                                             unsigned int* indexesOut, float cameraX, float cameraY,
                                             float cameraZ, unsigned int distanceMapRange, unsigned int sortCount,
                                             unsigned int renderCount, unsigned int splatCount) {

    int maxDistance = -2147483640;
    int minDistance = 2147483640;
    int* distances = (int*)sortBuffers;

    unsigned int sortStart = renderCount - sortCount;

    int iCameraX = (int)cameraX * 1000;
    int iCameraY = (int)cameraY * 1000;
    int iCameraZ = (int)cameraZ * 1000;

    int tempIn[4];
    int tempOut[4];
    int tempViewProj[] = {viewProj[2], viewProj[6], viewProj[10], 1};
    v128_t b = wasm_v128_load(&tempViewProj[0]);
    for (unsigned int i = sortStart; i < renderCount; i++) {
        v128_t a = wasm_v128_load(&positions[4 * indexes[i]]);
        v128_t prod = wasm_i32x4_mul(a, b);
        wasm_v128_store(&tempOut[0], prod);
        int depth = tempOut[0] + tempOut[1] + tempOut[2];
        distances[i] = depth;
        if (depth > maxDistance) maxDistance = depth;
        if (depth < minDistance) minDistance = depth;
    }

    float distancesRange = (float)maxDistance - (float)minDistance;
    float rangeMap = (float)distanceMapRange / distancesRange;

    unsigned int* frequencies = ((unsigned int *)distances) + splatCount;

    for (unsigned int i = sortStart; i < renderCount; i++) {
        unsigned int frequenciesIndex = (int)((float)(distances[i] - minDistance) * rangeMap);
        distances[i] = frequenciesIndex;
        frequencies[frequenciesIndex] = frequencies[frequenciesIndex] + 1;   
    }

    unsigned int cumulativeFreq = frequencies[0];
    for (unsigned int i = 1; i < distanceMapRange; i++) {
        unsigned int freq = frequencies[i];
        cumulativeFreq += freq;
        frequencies[i] = cumulativeFreq;
    }

    for (int i = (int)sortStart - 1; i >= 0; i--) {
        indexesOut[i] = indexes[i];
    }

    for (int i = (int)renderCount - 1; i >= (int)sortStart; i--) {
        unsigned int frequenciesIndex = distances[i];
        unsigned int freq = frequencies[frequenciesIndex];
        indexesOut[renderCount - freq] = indexes[i];
        frequencies[frequenciesIndex] = freq - 1;
    }
}