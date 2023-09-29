
export function createSortWorker(self) {
    let splatBuffer;
    let precomputedCovariance;
    let precomputedColor;
    let vertexCount = 0;
    let viewProj;
    let depthMix = new BigInt64Array();
    let lastProj = [];
    let sharedColor;
    let sharedCenterCov;

    let rowSizeFloats = 0;

    const runSort = (viewProj) => {

        if (!splatBuffer) return;

        const splatArray = new Float32Array(splatBuffer);
        const pCovarianceArray = new Float32Array(precomputedCovariance);
        const pColorArray = new Float32Array(precomputedColor);
        const color = new Float32Array(4 * vertexCount);
        const centerCov = new Float32Array(9 * vertexCount);

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
                10000 +
                viewProj[2] * splatArray[splatArrayBase] +
                viewProj[6] * splatArray[splatArrayBase + 1] +
                viewProj[10] * splatArray[splatArrayBase + 2];
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
            sharedColor = e.data.bufferUpdate.sharedColor;
            sharedCenterCov = e.data.bufferUpdate.sharedCenterCov;
        } else if (e.data.sort) {
            viewProj = e.data.sort.view;
            throttledSort();
        }
    };
}