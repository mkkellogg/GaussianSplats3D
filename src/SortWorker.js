
export function createSortWorker(self) {
    let precomputedCovariance;
    let precomputedColor;
    let vertexCount = 0;
    let viewProj;
    let depthMix = new BigInt64Array();
    let lastProj = [];

    let cameraPosition;
    let rowSizeFloats = 0;

    let vertexRenderCount;
    let workerTransferSplatBuffer;
    let workerTransferIndexBuffer;
    let workerTransferCenterCovarianceBuffer;
    let workerTransferColorBuffer;

    const runSort = (viewProj) => {

        if (!workerTransferSplatBuffer) {
            self.postMessage({'sortCanceled': true});
            return;
        }

        const splatArray = new Float32Array(workerTransferSplatBuffer);
        const indexArray = new Uint32Array(workerTransferIndexBuffer);
        const pCovarianceArray = new Float32Array(precomputedCovariance);
        const pColorArray = new Float32Array(precomputedColor);
        const color = new Float32Array(workerTransferColorBuffer);
        const centerCov = new Float32Array(workerTransferCenterCovarianceBuffer);


        if (depthMix.length !== vertexCount) {
            depthMix = new BigInt64Array(vertexCount);
        } else {
            let dot =
                lastProj[2] * viewProj[2] +
                lastProj[6] * viewProj[6] +
                lastProj[10] * viewProj[10];
            if (Math.abs(dot - 1) < 0.01) {
                self.postMessage({'sortCanceled': true});
                return;
            }
        }

        const floatMix = new Float32Array(depthMix.buffer);
        const indexMix = new Uint32Array(depthMix.buffer);

        for (let j = 0; j < vertexRenderCount; j++) {
            let i = indexArray[j];
            indexMix[2 * j] = i;
            const splatArrayBase = rowSizeFloats * i;
            const dx = splatArray[splatArrayBase] - cameraPosition[0];
            const dy = splatArray[splatArrayBase + 1] - cameraPosition[1];
            const dz = splatArray[splatArrayBase + 2] - cameraPosition[2];
            floatMix[2 * j + 1] = dx * dx + dy * dy + dz * dz;
        }
        lastProj = viewProj;
        depthMix.sort();

        for (let j = 0; j < vertexRenderCount; j++) {
            const i = indexMix[2 * j];

            const centerCovBase = 9 * j;
            const colorBase = 4 * j;
            const pCovarianceBase = 6 * i;
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

        self.postMessage({
            'sortDone': true,
            'sortedVertexCount': vertexRenderCount
        });

    };

    self.onmessage = (e) => {
        if (e.data.view) {
            viewProj = e.data.view.view;
            cameraPosition = e.data.view.cameraPosition;
            vertexRenderCount = e.data.view.vertexRenderCount;
            runSort(viewProj);
        } else if (e.data.buffer) {
            rowSizeFloats = e.data.buffer.rowSizeFloats;
            rowSizeBytes = e.data.buffer.rowSizeBytes;
            workerTransferSplatBuffer = e.data.buffer.workerTransferSplatBuffer,
            workerTransferIndexBuffer = e.data.buffer.workerTransferIndexBuffer,
            workerTransferCenterCovarianceBuffer = e.data.buffer.workerTransferCenterCovarianceBuffer,
            workerTransferColorBuffer = e.data.buffer.workerTransferColorBuffer,
            precomputedCovariance = e.data.buffer.precomputedCovariance;
            precomputedColor = e.data.buffer.precomputedColor;
            vertexCount = e.data.buffer.vertexCount;
        }
    };
}
