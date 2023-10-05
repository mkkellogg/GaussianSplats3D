#include <emscripten/emscripten.h>
#include <iostream>

#ifdef __cplusplus
#define EXTERN extern "C"
#else
#define EXTERN
#endif

EXTERN EMSCRIPTEN_KEEPALIVE void sortIndexes(unsigned int *indexes, float* positions,
                                             float* precomputedCovariances, float* precomputedColors,
                                             float* centerCovariances, float* outColors, char* sortBuffers, float* viewProj,
                                             unsigned int cameraX, unsigned int cameraY, unsigned int cameraZ,
                                             unsigned int sortCount, unsigned int vertexCount) {
    /*
    let maxDepth = -Infinity;
		let minDepth = Infinity;
		let sizeList = new Int32Array(vertexRenderCount);
		for (let i = 0; i < vertexRenderCount; i++) {
            const splatArrayBase = rowSizeFloats * indexArray[i];
            let depth =
				((viewProj[2] * splatArray[splatArrayBase] +
					viewProj[6] * splatArray[splatArrayBase + 1] +
					viewProj[10] * splatArray[splatArrayBase + 2]) *
					4096) |
				0;
			sizeList[i] = depth;
			if (depth > maxDepth) maxDepth = depth;
			if (depth < minDepth) minDepth = depth;
		}

		// This is a 16 bit single-pass counting sort
		let depthInv = (256 * 256) / (maxDepth - minDepth);
		let counts0 = new Uint32Array(256*256);
		for (let i = 0; i < vertexRenderCount; i++) {
			sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
			counts0[sizeList[i]]++;
		}
		let starts0 = new Uint32Array(256*256);
		for (let i = 1; i < 256*256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1];
		depthIndex = new Uint32Array(vertexRenderCount);
		for (let i = 0; i < vertexRenderCount; i++) depthIndex[starts0[sizeList[i]]++] = indexArray[i];
    */

    int maxDepth = -2147483648;
    int minDepth = 2147483647;
    int* sizeList = (int*)sortBuffers;
    for (unsigned int i = 0; i < sortCount; i++) {
        unsigned int positionBase = 3 * indexes[i];
        int depth =
            (int)((viewProj[2] * positions[positionBase] +
                    viewProj[6] * positions[positionBase + 1] +
                    viewProj[10] * positions[positionBase + 2]) *
                    4096.0);
        sizeList[i] = depth;
        if (depth > maxDepth) maxDepth = depth;
        if (depth < minDepth) minDepth = depth;
    }

    // This is a 16 bit single-pass counting sort
    float depthInv = (float)(256 * 256) / ((float)maxDepth - (float)minDepth);

    unsigned int* counts0 = ((unsigned int *)sizeList) + vertexCount;
    /* for (unsigned int i = 0; i < 256 * 256; i++) {
        counts0[i] = counts0[i] - counts0[i];
    }*/

    unsigned int* starts0 = ((unsigned int *)counts0) + (256 * 256);
    /*for (unsigned int i = 0; i < 256 * 256; i++) {
        starts0[i] = counts0[i];
    }*/

    for (unsigned int i = 0; i < sortCount; i++) {
        sizeList[i] = (int)(((float)sizeList[i] - (float)minDepth) * depthInv);
        counts0[sizeList[i]]++;
    }

    for (unsigned int i = 1; i < 256*256; i++) {
        starts0[i] = starts0[i - 1] + counts0[i - 1];
    }

    unsigned int* depthIndex = ((unsigned int *)starts0) + (256 * 256);
    for (unsigned int i = 0; i < sortCount; i++) {
        depthIndex[starts0[sizeList[i]]++] = indexes[i];
    }

}
