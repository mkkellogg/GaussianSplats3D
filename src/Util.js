import { AbortablePromise } from './AbortablePromise.js';

export const floatToHalf = function() {

    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);

    return function(val) {
        floatView[0] = val;
        const x = int32View[0];

        let bits = (x >> 16) & 0x8000;
        let m = (x >> 12) & 0x07ff;
        const e = (x >> 23) & 0xff;

        if (e < 103) return bits;

        if (e > 142) {
            bits |= 0x7c00;
            bits |= ((e == 255) ? 0 : 1) && (x & 0x007fffff);
            return bits;
        }

        if (e < 113) {
            m |= 0x0800;
            bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
            return bits;
        }

        bits |= (( e - 112) << 10) | (m >> 1);
        bits += m & 1;
        return bits;
    };

}();

export const uintEncodedFloat = function() {

    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);

    return function(f) {
        floatView[0] = f;
        return int32View[0];
    };

}();

export const rgbaToInteger = function(r, g, b, a) {
    return r + (g << 8) + (b << 16) + (a << 24);
};

export const fetchWithProgress = function(path, onProgress) {

    const abortController = new AbortController();
    const signal = abortController.signal;
    let aborted = false;
    let rejectFunc = null;
    const abortHandler = () => {
        abortController.abort();
        rejectFunc('Fetch aborted');
        aborted = true;
    };

    return new AbortablePromise((resolve, reject) => {
        rejectFunc = reject;
        fetch(path, { signal })
        .then(async (data) => {
            const reader = data.body.getReader();
            let bytesDownloaded = 0;
            let _fileSize = data.headers.get('Content-Length');
            let fileSize = _fileSize ? parseInt(_fileSize) : undefined;

            const chunks = [];

            while (!aborted) {
                try {
                    const { value: chunk, done } = await reader.read();
                    if (done) {
                        if (onProgress) {
                            onProgress(100, '100%', chunk);
                        }
                        const buffer = new Blob(chunks).arrayBuffer();
                        resolve(buffer);
                        break;
                    }
                    bytesDownloaded += chunk.length;
                    let percent;
                    let percentLabel;
                    if (fileSize !== undefined) {
                        percent = bytesDownloaded / fileSize * 100;
                        percentLabel = `${percent.toFixed(2)}%`;
                    }
                    chunks.push(chunk);
                    if (onProgress) {
                        onProgress(percent, percentLabel, chunk);
                    }
                } catch (error) {
                    reject(error);
                    break;
                }
            }
        });
    }, abortHandler);

};

export const clamp = function(val, min, max) {
    return Math.max(Math.min(val, max), min);
};

export const getCurrentTime = function() {
    return performance.now() / 1000;
};

export const disposeAllMeshes = (object3D) => {
    if (object3D.geometry) {
        object3D.geometry.dispose();
        object3D.geometry = null;
    }
    if (object3D.material) {
        object3D.material.dispose();
        object3D.material = null;
    }
    if (object3D.children) {
        for (let child of object3D.children) {
            disposeAllMeshes(child);
        }
    }
};
