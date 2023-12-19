#include <emscripten/emscripten.h>
#include <iostream>
#include <wasm_simd128.h>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

EXTERN EMSCRIPTEN_KEEPALIVE void sortIndexes(unsigned int* indexes, void* centers, void* precomputedDistances, 
                                             int* mappedDistances, unsigned int * frequencies, float* modelViewProj,
                                             unsigned int* indexesOut,  unsigned int* transformIndexes, float* transforms,
                                             unsigned int distanceMapRange, unsigned int sortCount, unsigned int renderCount,
                                             unsigned int splatCount, bool usePrecomputedDistances, bool useIntegerSort,
                                             bool dynamicMode) {

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
            if (dynamicMode) {
                int lastTransformIndex = -1;
                int tempOut[4];
                int tempCenter[4];
                v128_t b;
                for (unsigned int i = sortStart; i < renderCount; i++) {
                    unsigned int realIndex = indexes[i];
                    unsigned int transformIndex = transformIndexes[realIndex];
                    if ((int)transformIndex != lastTransformIndex) {
                        float t1  = modelViewProj[2] * transforms[transformIndex * 16] +
                                    modelViewProj[6] * transforms[transformIndex * 16 + 1] +
                                    modelViewProj[10] * transforms[transformIndex * 16 + 2] +
                                    modelViewProj[14] * transforms[transformIndex * 16 + 3];
                            
                        float t2 = modelViewProj[2] * transforms[transformIndex * 16 + 4] +
                                   modelViewProj[6] * transforms[transformIndex * 16 + 5] +
                                   modelViewProj[10] * transforms[transformIndex * 16 + 6] +
                                   modelViewProj[14] * transforms[transformIndex * 16 + 7];
                        
                        float t3 = modelViewProj[2] * transforms[transformIndex * 16 + 8] +
                                   modelViewProj[6] * transforms[transformIndex * 16 + 9] +
                                   modelViewProj[10] * transforms[transformIndex * 16 + 10] +
                                   modelViewProj[14] * transforms[transformIndex * 16 + 11];

                        float t4 = modelViewProj[2] * transforms[transformIndex * 16 + 12] +
                                   modelViewProj[6] * transforms[transformIndex * 16 + 13] +
                                   modelViewProj[10] * transforms[transformIndex * 16 + 14] +
                                   modelViewProj[14] * transforms[transformIndex * 16 + 15];

                        int modelViewProjElements[] = {(int)(t1 * 1000.0), (int)(t2 * 1000.0), (int)(t3 * 1000.0), (int)(t4 * 1000.0)};
                        b = wasm_v128_load(&modelViewProjElements[0]);
                        lastTransformIndex = (int)transformIndex;
                    }

                    v128_t a = wasm_v128_load(&intCenters[4 * realIndex]);
                    v128_t prod = wasm_i32x4_mul(a, b);
                    wasm_v128_store(&tempOut[0], prod);
                    int distance = tempOut[0] + tempOut[1] + tempOut[2] + tempOut[3];
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
        }
    } else {
        float* floatCenters = (float*)centers;
        float* floatPrecomputedDistances = (float*)precomputedDistances;
        float* floatModelViewProj = (float*)modelViewProj;
        float* floatTransforms = (float *)transforms;
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
