
export function createSortWorker(self) {
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

    let depthMixTiers = [];
    let depthMixTierVertexCounts = [];
    let tierCount = 5;
    let aggregateTraveled = [];
    let maxCameraTravel = 5.0;

    let workerTransferCenterCovarianceBuffer;
    let workerTransferColorBuffer;

    const runSort = (viewProj) => {

        if (!splatBuffer) return;

        const splatArray = new Float32Array(splatBuffer);
        const pCovarianceArray = new Float32Array(precomputedCovariance);
        const pColorArray = new Float32Array(precomputedColor);
        const color = new Float32Array(workerTransferColorBuffer);
        const centerCov = new Float32Array(workerTransferCenterCovarianceBuffer);

        let fullRefresh = false;

        if (depthMix.length !== vertexCount) {
            depthMix = new BigInt64Array(vertexCount);
            for (let i = 0; i < tierCount; i++) {
                aggregateTraveled[i] = 0;
                depthMixTierVertexCounts[i] = Math.floor(i * vertexCount / tierCount);
                depthMixTiers[i] = new BigInt64Array(depthMix.buffer, 0, depthMixTierVertexCounts[i]);
            }
            const indexMix = new Uint32Array(depthMix.buffer);
            for (let j = 0; j < vertexCount; j++) {
                indexMix[2 * j] = j;
            }
            fullRefresh = true;
        } else {
            let dot =
                lastProj[2] * viewProj[2] +
                lastProj[6] * viewProj[6] +
                lastProj[10] * viewProj[10];
            if (Math.abs(dot - 1) < 0.01) {
                return;
            }
        }

        let distanceTraveled = maxCameraTravel;
        let depthMixTier = tierCount - 1;
        if (lastCameraPosition) {
            const dx = lastCameraPosition[0] - cameraPosition[0];
            const dy = lastCameraPosition[1] - cameraPosition[1];
            const dz = lastCameraPosition[2] - cameraPosition[2];
            distanceTraveled = Math.sqrt(dx * dx + dy * dy + dz * dz);

            for (let i = 0; i < tierCount; i++) {
                const maxTravelForTier = maxCameraTravel / tierCount * i;
                aggregateTraveled[i] += distanceTraveled;
                if (aggregateTraveled[i] >= maxTravelForTier) {
                    for (let j = i; j >= 0; j--) {
                        aggregateTraveled[j] = 0;
                    }
                    depthMixTier = i;
                }
            }
        }

        const floatMix = new Float32Array(depthMix.buffer);
        const indexMix = new Uint32Array(depthMix.buffer);

        for (let j = 0; j < vertexCount; j++) {
            let i = indexMix[2 * j];
            const splatArrayBase = rowSizeFloats * i;
            const dx = splatArray[splatArrayBase] - cameraPosition[0];
            const dy = splatArray[splatArrayBase + 1] - cameraPosition[1];
            const dz = splatArray[splatArrayBase + 2] - cameraPosition[2];
            floatMix[2 * j + 1] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        lastProj = viewProj;

        if (fullRefresh) {
            depthMix.sort();
        } else {
            depthMixTiers[depthMixTier].sort();
        }

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
        
        self.postMessage({'sortDone': true});

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
        if (e.data.view) {
            viewProj = e.data.view.view;
            cameraPosition = e.data.view.cameraPosition;
            throttledSort();
        } else if (e.data.buffer) {
            rowSizeFloats = e.data.buffer.rowSizeFloats;
            rowSizeBytes = e.data.buffer.rowSizeBytes;
            splatBuffer = e.data.buffer.splatBuffer;
            workerTransferCenterCovarianceBuffer = e.data.buffer.workerTransferCenterCovarianceBuffer,
            workerTransferColorBuffer = e.data.buffer.workerTransferColorBuffer,
            precomputedCovariance = e.data.buffer.precomputedCovariance;
            precomputedColor = e.data.buffer.precomputedColor;
            vertexCount = e.data.buffer.vertexCount;
            viewProj = e.data.buffer.view;
            cameraPosition = e.data.buffer.cameraPosition;
            throttledSort();
        }
    };
}
