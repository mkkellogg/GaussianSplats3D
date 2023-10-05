#include <emscripten/emscripten.h>
#include <iostream>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

EXTERN EMSCRIPTEN_KEEPALIVE void sortIndexes(unsigned int indexes[], float* positions, char* sortBuffers, float* viewProj,
                                             unsigned int* indexesOut, unsigned int cameraX, unsigned int cameraY,
                                             unsigned int cameraZ, unsigned int sortCount, unsigned int vertexCount) {
    const unsigned int MAP_RANGE = 65536;

    int maxDepth = -2147483648;
    int minDepth = 2147483647;
    int* sizeList = (int*)sortBuffers;
    for (unsigned int i = 0; i < sortCount; i++) {
        unsigned int indexOffset = 3 * (unsigned int)indexes[i];
        int depth =
            (int)(((float)viewProj[2] * (float)positions[indexOffset] +
                    (float)viewProj[6] * (float)positions[indexOffset + 1] +
                    (float)viewProj[10] * (float)positions[indexOffset + 2]) *
                    4096.0);
        sizeList[i] = depth;
        if (depth > maxDepth) maxDepth = depth;
        if (depth < minDepth) minDepth = depth;
    }

    float depthMap = (float)MAP_RANGE / ((float)maxDepth - (float)minDepth);

    unsigned int* counts0 = ((unsigned int *)sizeList) + vertexCount;
    unsigned int* starts0 = ((unsigned int *)counts0) + MAP_RANGE;

    for (unsigned int i = 0; i < sortCount; i++) {
        sizeList[i] = (int)(((float)sizeList[i] - (float)minDepth) * depthMap);
        counts0[(int)sizeList[i]]++;
    }

    for (unsigned int i = 1; i < MAP_RANGE; i++) {
        starts0[i] = (unsigned int)starts0[i - 1] + (unsigned int)counts0[i - 1];
    }

    for (unsigned int i = 0; i < sortCount; i++) {
        indexesOut[(unsigned int)starts0[(int)sizeList[i]]++] = (unsigned int)indexes[i];
    }

}
