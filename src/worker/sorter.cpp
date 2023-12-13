#include <emscripten/emscripten.h>
#include <iostream>
#include <wasm_simd128.h>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

EXTERN EMSCRIPTEN_KEEPALIVE void sortIndexes(unsigned int* indexes, void* centers, void* precomputedDistances, 
                                             int* mappedDistances, unsigned int * frequencies, void* modelViewProj,
                                             unsigned int* indexesOut, unsigned int distanceMapRange, unsigned int sortCount,
                                             unsigned int renderCount, unsigned int splatCount, bool usePrecomputedDistances, bool useIntegerSort) {

    int maxDistance = -2147483640;
    int minDistance = 2147483640;

    unsigned int sortStart = renderCount - sortCount;
    if (useIntegerSort) {
        int* intCenters = (int*)centers;
        int* intPrecomputedDistances = (int*)precomputedDistances;
        int* intModelViewProj = (int*)modelViewProj;
        if (usePrecomputedDistances) {
            for (unsigned int i = sortStart; i < renderCount; i++) {
                int distance = intPrecomputedDistances[indexes[i]];
                mappedDistances[i] = distance;
                if (distance > maxDistance) maxDistance = distance;
                if (distance < minDistance) minDistance = distance;
            }
        } else {
            int tempOut[4];
            int tempViewProj[] = {intModelViewProj[2], intModelViewProj[6], intModelViewProj[10], 1};
            v128_t b = wasm_v128_load(&tempViewProj[0]);
            for (unsigned int i = sortStart; i < renderCount; i++) {
                v128_t a = wasm_v128_load(&intCenters[4 * indexes[i]]);
                v128_t prod = wasm_i32x4_mul(a, b);
                wasm_v128_store(&tempOut[0], prod);
                int distance = tempOut[0] + tempOut[1] + tempOut[2];
                mappedDistances[i] = distance;
                if (distance > maxDistance) maxDistance = distance;
                if (distance < minDistance) minDistance = distance;
            }
        }
    } else {
        float* floatCenters = (float*)centers;
        float* floatPrecomputedDistances = (float*)precomputedDistances;
        float* floatModelViewProj = (float*)modelViewProj;
        if (usePrecomputedDistances) {
            for (unsigned int i = sortStart; i < renderCount; i++) {
                int distance = (int)(floatPrecomputedDistances[indexes[i]] * 4096.0);
                mappedDistances[i] = distance;
                if (distance > maxDistance) maxDistance = distance;
                if (distance < minDistance) minDistance = distance;
            }
        } else {
            // TODO: For some reason, the SIMD approach with floats seems slower, need to investigate further...
            /* 
            float tempOut[4];
            float tempViewProj[] = {floatModelViewProj[2], floatModelViewProj[6], floatModelViewProj[10], 1.0};
            v128_t b = wasm_v128_load(&tempViewProj[0]);
            for (unsigned int i = sortStart; i < renderCount; i++) {
                v128_t a = wasm_v128_load(&floatCenters[4 * indexes[i]]);
                v128_t prod = wasm_f32x4_mul(a, b);
                wasm_v128_store(&tempOut[0], prod);
                int distance = (int)((tempOut[0] + tempOut[1] + tempOut[2]) * 4096.0);
                mappedDistances[i] = distance;
                if (distance > maxDistance) maxDistance = distance;
                if (distance < minDistance) minDistance = distance;
            }
            */

            for (unsigned int i = sortStart; i < renderCount; i++) {
                unsigned int indexOffset = 4 * (unsigned int)indexes[i];
                int distance =
                    (int)((floatModelViewProj[2] * floatCenters[indexOffset] +
                           floatModelViewProj[6] * floatCenters[indexOffset + 1] +
                           floatModelViewProj[10] * floatCenters[indexOffset + 2]) * 4096.0);
                mappedDistances[i] = distance;
                if (distance > maxDistance) maxDistance = distance;
                if (distance < minDistance) minDistance = distance;
            }
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
