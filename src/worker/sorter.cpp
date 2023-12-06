#include <emscripten/emscripten.h>
#include <iostream>
#include <wasm_simd128.h>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

EXTERN EMSCRIPTEN_KEEPALIVE void sortIndexes(unsigned int* indexes, int* centers, int* precomputedDistances, 
                                             int* mappedDistances, unsigned int * frequencies, int* modelViewProj,
                                             unsigned int* indexesOut, unsigned int distanceMapRange, unsigned int sortCount,
                                             unsigned int renderCount, unsigned int splatCount, bool usePrecomputedDistances) {

    int maxDistance = -2147483640;
    int minDistance = 2147483640;

    unsigned int sortStart = renderCount - sortCount;

    if (usePrecomputedDistances) {
        for (unsigned int i = sortStart; i < renderCount; i++) {
            int distance = precomputedDistances[indexes[i]];
            mappedDistances[i] = distance;
            if (distance > maxDistance) maxDistance = distance;
            if (distance < minDistance) minDistance = distance;
        }
    } else {
        int tempIn[4];
        int tempOut[4];
        int tempViewProj[] = {modelViewProj[2], modelViewProj[6], modelViewProj[10], 1};
        v128_t b = wasm_v128_load(&tempViewProj[0]);
        for (unsigned int i = sortStart; i < renderCount; i++) {
            v128_t a = wasm_v128_load(&centers[4 * indexes[i]]);
            v128_t prod = wasm_i32x4_mul(a, b);
            wasm_v128_store(&tempOut[0], prod);
            int distance = tempOut[0] + tempOut[1] + tempOut[2];
            mappedDistances[i] = distance;
            if (distance > maxDistance) maxDistance = distance;
            if (distance < minDistance) minDistance = distance;
        }
    }

    float distancesRange = (float)maxDistance - (float)minDistance;
    float rangeMap = (float)(distanceMapRange - 1) / distancesRange;

    for (unsigned int i = sortStart; i < renderCount; i++) {
        unsigned int frequenciesIndex = (int)((float)(mappedDistances[i] - minDistance) * rangeMap);
        mappedDistances[i] = frequenciesIndex;
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
        unsigned int frequenciesIndex = mappedDistances[i];
        unsigned int freq = frequencies[frequenciesIndex];
        indexesOut[renderCount - freq] = indexes[i];
        frequencies[frequenciesIndex] = freq - 1;
    }
}
