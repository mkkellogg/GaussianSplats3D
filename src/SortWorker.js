
export function createSortWorker(self) {
    let splatBuffer;
    let precomputedCovariance;
    let precomputedColor;
    let vertexCount = 0;
    let viewProj;
    let depthMix = new BigInt64Array();
    let lastProj = [];

    let lastVertexCount = -1;
    let depthArray;
    let indexArray;


    let rowSizeFloats = 0;

    const runSort = (viewProj) => {

        if (!splatBuffer) return;

        const splatArray = new Float32Array(splatBuffer);
        const pCovarianceArray = new Float32Array(precomputedCovariance);
        const pColorArray = new Float32Array(precomputedColor);
        const color = new Float32Array(4 * vertexCount);
        const centerCov = new Float32Array(9 * vertexCount);

       /* if (!depthArray || lastVertexCount != vertexCount || true) {
            depthArray = new Float32Array(vertexCount);
            indexArray = new Uint32Array(vertexCount);

            for (let i = 0; i < vertexCount; i++) {
                indexArray[i] = i;
            }
        }

        for (let j = 0; j < vertexCount; j++) {
            const i = indexArray[j];
            const splatArrayBase = rowSizeFloats * i;
            depthArray[j] = (splatArray[splatArrayBase] * viewProj[2] + splatArray[splatArrayBase + 1] * viewProj[6] + splatArray[splatArrayBase + 2] * viewProj[10]);
        }

        indexArray.sort((a, b) => {
            const splatArrayBaseA = rowSizeFloats * a;
            const splatArrayBaseB = rowSizeFloats * b;
            const pcColorBaseA = 4 * a;
            const pCovarianceBaseA = 6 * a;
            const opacityA = pColorArray[pcColorBaseA + 3];
            const pcColorBaseB = 4 * b;
            const pCovarianceBaseB = 6 * b;
            const opacityB = pColorArray[pcColorBaseB + 3];
            return depthArray[a] > depthArray[b] 
        })


        if (indexArray && indexArray.length == vertexCount) {
			let dot =
				lastProj[2] * viewProj[2] +
				lastProj[6] * viewProj[6] +
				lastProj[10] * viewProj[10];
			if (Math.abs(dot - 1) < 0.01) {
				return;
			}
		}

		let maxDepth = -Infinity;
		let minDepth = Infinity;
		let sizeList = new Int32Array(vertexCount);
		for (let i = 0; i < vertexCount; i++) {
            const splatArrayBase = rowSizeFloats * i;
			let depth =
				((viewProj[2] * splatArray[splatArrayBase + 0] +
					viewProj[6] * splatArray[splatArrayBase + 1] +
					viewProj[10] * splatArray[splatArrayBase + 2]) *
					4096) |
				0;
			sizeList[i] = depth;
			if (depth > maxDepth) maxDepth = depth;
			if (depth < minDepth) minDepth = depth;
		}
		// console.time("sort");

		// This is a 16 bit single-pass counting sort
		let depthInv = (256 * 256) / (maxDepth - minDepth);
		let counts0 = new Uint32Array(256*256);
		for (let i = 0; i < vertexCount; i++) {
			sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
			counts0[sizeList[i]]++;
		}
		let starts0 = new Uint32Array(256*256);
		for (let i = 1; i < 256*256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1];
		indexArray = new Uint32Array(vertexCount);
		for (let i = 0; i < vertexCount; i++) indexArray[starts0[sizeList[i]]++] = i;*/



        /*for (let j = 0; j < vertexCount; j++) {
            const i = indexArray[j];

            const centerCovBase = 9 * j;
            const pCovarianceBase = 6 * i;
            const colorBase = 4 * j;
            const pcColorBase = 4 * i;
            const splatArrayBase = rowSizeFloats * i;

            centerCov[centerCovBase] = splatArray[splatArrayBase];
            centerCov[centerCovBase + 1] = splatArray[splatArrayBase + 1];
            centerCov[centerCovBase + 2] = splatArray[splatArrayBase + 2];

            color[colorBase] = pColorArray[pcColorBase];
            color[colorBase + 1] = pColorArray[pcColorBase + 1];
            color[colorBase + 2] = pColorArray[pcColorBase + 2];
            color[colorBase + 3] = pColorArray[pcColorBase + 3];

            //const depth = splatArray[splatArrayBase] * viewProj[2] + splatArray[splatArrayBase + 1] * viewProj[6] + splatArray[splatArrayBase + 2] * viewProj[10];
            //color[colorBase + 1] *= Math.pow(1 / Math.exp(-(1.0 - (depth + 1) / 2.0)), 0.75);

            centerCov[centerCovBase + 3] = pCovarianceArray[pCovarianceBase];
            centerCov[centerCovBase + 4] = pCovarianceArray[pCovarianceBase + 1];
            centerCov[centerCovBase + 5] = pCovarianceArray[pCovarianceBase + 2];
            centerCov[centerCovBase + 6] = pCovarianceArray[pCovarianceBase + 3];
            centerCov[centerCovBase + 7] = pCovarianceArray[pCovarianceBase + 4];
            centerCov[centerCovBase + 8] = pCovarianceArray[pCovarianceBase + 5];
        }*/

        if (depthMix.length !== vertexCount) {
            depthMix = new BigInt64Array(vertexCount);
            const indexMix = new Uint32Array(depthMix.buffer);
            for (let j = 0; j < vertexCount; j++) {
                indexMix[2 * j] = j;
            }
        } else {
            let dot =
                lastProj[2] * viewProj[2] +
                lastProj[6] * viewProj[6] +
                lastProj[10] * viewProj[10];
            if (Math.abs(dot - 1) < 0.01) {
                return;
            }
        }

        const floatMix = new Float32Array(depthMix.buffer);
        const indexMix = new Uint32Array(depthMix.buffer);

        for (let j = 0; j < vertexCount; j++) {
            let i = indexMix[2 * j];
            const splatArrayBase = rowSizeFloats * i;
            floatMix[2 * j + 1] =
                -10000 +
                -viewProj[2] * splatArray[splatArrayBase] +
                -viewProj[6] * splatArray[splatArrayBase + 1] +
                -viewProj[10] * splatArray[splatArrayBase + 2];
        }

        lastProj = viewProj;

        depthMix.sort();

        for (let j = 0; j < vertexCount; j++) {
            const i = indexMix[2 * j];

            const centerCovBase = 9 * j;
            const pCovarianceBase = 6 * i;
            const colorBase = 4 * j;
            const pcColorBase = 4 * i;
            const splatArrayBase = rowSizeFloats * i;

            centerCov[centerCovBase] = splatArray[splatArrayBase];
            centerCov[centerCovBase + 1] = splatArray[splatArrayBase + 1];
            centerCov[centerCovBase + 2] = splatArray[splatArrayBase + 2];

            color[colorBase] = pColorArray[pcColorBase];
            color[colorBase + 1] = pColorArray[pcColorBase + 1];
            color[colorBase + 2] = pColorArray[pcColorBase + 2];
            color[colorBase + 3] = pColorArray[pcColorBase + 3];

            centerCov[centerCovBase + 3] = pCovarianceArray[pCovarianceBase];
            centerCov[centerCovBase + 4] = pCovarianceArray[pCovarianceBase + 1];
            centerCov[centerCovBase + 5] = pCovarianceArray[pCovarianceBase + 2];
            centerCov[centerCovBase + 6] = pCovarianceArray[pCovarianceBase + 3];
            centerCov[centerCovBase + 7] = pCovarianceArray[pCovarianceBase + 4];
            centerCov[centerCovBase + 8] = pCovarianceArray[pCovarianceBase + 5];
        }

        lastVertexCount = vertexCount;

        self.postMessage({color, centerCov}, [
            color.buffer,
            centerCov.buffer,
        ]);

    };

    const throttledSort = () => {
        if (!sortRunning) {
            sortRunning = true;
            let lastView = viewProj;
            runSort(lastView);
            setTimeout(() => {
                sortRunning = false;
                if (lastView !== viewProj) {
                    throttledSort();
                }
            }, 0);
        }
    };

    let sortRunning;
    self.onmessage = (e) => {
        if (e.data.bufferUpdate) {
            rowSizeFloats = e.data.bufferUpdate.rowSizeFloats;
            rowSizeBytes = e.data.bufferUpdate.rowSizeBytes;
            splatBuffer = e.data.bufferUpdate.splatBuffer;
            precomputedCovariance = e.data.bufferUpdate.precomputedCovariance;
            precomputedColor = e.data.bufferUpdate.precomputedColor;
            vertexCount = e.data.bufferUpdate.vertexCount;
        } else if (e.data.sort) {
            viewProj = e.data.sort.view;
            throttledSort();
        }
    };
}
