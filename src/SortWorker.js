
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
    let workerTransferDistanceBuffer;
    let workerTransferCenterCovarianceBuffer;
    let workerTransferColorBuffer;

    let distances;
    let frequencies;
    let realIndex;

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
         }

        console.time("DEFAULT");
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
        console.timeEnd("DEFAULT");


       

        /*console.time("MYCOUNT");
        if (!distances || distances.length < vertexRenderCount) {
            distances = new Uint32Array(vertexRenderCount);
        }
        let minDistance;
        let maxDistance;
        for (let j = 0; j < vertexRenderCount; j++) {
            let i = indexArray[j];
            const splatArrayBase = rowSizeFloats * i;
            const dx = splatArray[splatArrayBase] - cameraPosition[0];
            const dy = splatArray[splatArrayBase + 1] - cameraPosition[1];
            const dz = splatArray[splatArrayBase + 2] - cameraPosition[2];
            const distance = Math.floor((dx * dx + dy * dy + dz * dz) * 1000);
            distances[j] = distance;
            if (j === 0 || distance < minDistance) minDistance = distance;
            if (j === 0 || distance > maxDistance) maxDistance = distance;
        }

        const distancesRange = maxDistance - minDistance;
        const mappedRange = 0x1 << 16;
        const rangeMap = mappedRange / distancesRange;
        //if (!frequencies || frequencies.length < mappedRange) {
            frequencies = new Uint32Array(mappedRange);
       // }
       // for (let i = 0; i < mappedRange; i++) frequencies[i] = 0;

        for (let i = 0; i < vertexRenderCount; i++) {
            const frequenciesIndex = Math.floor((distances[i] - minDistance) * rangeMap);
            const cFreq = frequencies[frequenciesIndex] || 0;
            frequencies[frequenciesIndex] = cFreq + 1;   
        }

        let cumulativeFreq = 0;
        for (let i = 1; i < mappedRange; i++) {
            const cFreq = frequencies[i];
            cumulativeFreq += cFreq;
            frequencies[i] = cumulativeFreq;
        }

        if (!realIndex || realIndex.length < vertexRenderCount) {
            realIndex = new Uint32Array(vertexRenderCount);
        }

        for (let i = vertexRenderCount - 1; i >= 0; i--) {
            const frequenciesIndex =  Math.floor((distances[i] - minDistance) * rangeMap);
            const freq = frequencies[frequenciesIndex];
            realIndex[freq- 1] = indexArray[i];
            frequencies[frequenciesIndex] = freq - 1;
        }
        console.timeEnd("MYCOUNT");*/



        /*console.time("COUNT");
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

        console.timeEnd("COUNT");*/



        for (let j = 0; j < vertexRenderCount; j++) {
            const i = indexMix[2 * j];
          //  const i = realIndex[j];
         //  const i = depthIndex[j];

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
            workerTransferDistanceBuffer = e.data.buffer.workerTransferDistanceBuffer,
            workerTransferCenterCovarianceBuffer = e.data.buffer.workerTransferCenterCovarianceBuffer,
            workerTransferColorBuffer = e.data.buffer.workerTransferColorBuffer,
            precomputedCovariance = e.data.buffer.precomputedCovariance;
            precomputedColor = e.data.buffer.precomputedColor;
            vertexCount = e.data.buffer.vertexCount;
        }
    };
}
