
export function createNodeSortWorker(self) {
    let splatBuffer;
    let precomputedCovariance;
    let precomputedColor;
    let vertexCount = 0;
    let viewProj;
    let depthMix = new BigInt64Array();
    let lastProj = [];

    let lastVertexCount = -1;
    let cameraPosition;
    let lastCameraPosition;
    let rowSizeFloats = 0;
    let rowSizeBytes = 0;

    let workerTransferCenterCovarianceBuffer;
    let workerTransferColorBuffer;

    let id = -1;

    const runSort = (viewProj) => {

        if (!splatBuffer) return;

        const splatArray = new Float32Array(splatBuffer);
        const pCovarianceArray = new Float32Array(precomputedCovariance);
        const pColorArray = new Float32Array(precomputedColor);
        const color = new Float32Array(workerTransferColorBuffer);
        const centerCov = new Float32Array(workerTransferCenterCovarianceBuffer);

        if (depthMix.length !== vertexCount) {
            depthMix = new BigInt64Array(vertexCount);
            const indexMix = new Uint32Array(depthMix.buffer);
            for (let j = 0; j < vertexCount; j++) {
                indexMix[2 * j] = j;
            }
        }

        let depthMixView = new BigInt64Array(depthMix.buffer, 0, vertexCount);
        const floatMix = new Float32Array(depthMix.buffer, 0, vertexCount * 2);
        const indexMix = new Uint32Array(depthMix.buffer, 0, vertexCount * 2);

        for (let j = 0; j < vertexCount; j++) {
            let i = j;
            indexMix[2 * j] = j;
            const splatArrayBase = rowSizeFloats * j;
            const dx = splatArray[splatArrayBase] - cameraPosition[0];
            const dy = splatArray[splatArrayBase + 1] - cameraPosition[1];
            const dz = splatArray[splatArrayBase + 2] - cameraPosition[2];
            floatMix[2 * j + 1] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        lastProj = viewProj;

        depthMixView.sort();

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
        lastCameraPosition = cameraPosition;
        
        self.postMessage({
            'sortDone': true,
            'id': id
        });

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
        if (e.data.sort) {
            rowSizeFloats = e.data.sort.rowSizeFloats;
            rowSizeBytes = e.data.sort.rowSizeBytes;
            splatBuffer = e.data.sort.splatBuffer;
            workerTransferCenterCovarianceBuffer = e.data.sort.workerTransferCenterCovarianceBuffer,
            workerTransferColorBuffer = e.data.sort.workerTransferColorBuffer,
            precomputedCovariance = e.data.sort.precomputedCovariance;
            precomputedColor = e.data.sort.precomputedColor;
            vertexCount = e.data.sort.vertexCount;
            viewProj = e.data.sort.view;
            cameraPosition = e.data.sort.cameraPosition;
            id = e.data.sort.id;
            throttledSort();
        }
    };
}
