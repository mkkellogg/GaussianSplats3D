

export class SplatBuffer {

    // XYZ - Position (Float32)
    // XYZ - Scale (Float32)
    // RGBA - colors (uint8)
    // IJKL - quaternion/rot (uint8)
    static RowSize = 32;
    static CovariancePositionSizeFloat = 9;
    static CovariancePositionSizeBytes = 36;

    constructor(bufferData) {
        this.bufferData = bufferData;
        this.covariancePositionBuffer = null;
    }

    initPreComputedBuffers(){
        const vertexCount = this.getVertexCount();
        this.covariancePositionBuffer = new ArrayBuffer(SplatBuffer.CovariancePositionSizeBytes * vertexCount);
        const covariancePositionArray = new Float32Array(this.covariancePositionBuffer);

        const f_buffer = new Float32Array(this.bufferData);
		const u_buffer = new Uint8Array(this.bufferData);
        for (let i = 0; i < vertexCount; i++) {
			//const i = indexMix[2 * j];

			///center[3 * j + 0] = f_buffer[8 * i + 0];
			///center[3 * j + 1] = f_buffer[8 * i + 1];
			///center[3 * j + 2] = f_buffer[8 * i + 2];

            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i] = f_buffer[8 * i];
            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i + 1] = f_buffer[8 * i + 1];
            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i + 2] = f_buffer[8 * i + 2];

			let scale = [
				f_buffer[8 * i + 3 + 0],
				f_buffer[8 * i + 3 + 1],
				f_buffer[8 * i + 3 + 2],
			];
			let rot = [
				(u_buffer[32 * i + 28 + 0] - 128) / 128,
				(u_buffer[32 * i + 28 + 1] - 128) / 128,
				(u_buffer[32 * i + 28 + 2] - 128) / 128,
				(u_buffer[32 * i + 28 + 3] - 128) / 128,
			];

			const R = [
				1.0 - 2.0 * (rot[2] * rot[2] + rot[3] * rot[3]),
				2.0 * (rot[1] * rot[2] + rot[0] * rot[3]),
				2.0 * (rot[1] * rot[3] - rot[0] * rot[2]),

				2.0 * (rot[1] * rot[2] - rot[0] * rot[3]),
				1.0 - 2.0 * (rot[1] * rot[1] + rot[3] * rot[3]),
				2.0 * (rot[2] * rot[3] + rot[0] * rot[1]),

				2.0 * (rot[1] * rot[3] + rot[0] * rot[2]),
				2.0 * (rot[2] * rot[3] - rot[0] * rot[1]),
				1.0 - 2.0 * (rot[1] * rot[1] + rot[2] * rot[2]),
			];

			// Compute the matrix product of S and R (M = S * R)
			const M = [
				scale[0] * R[0],
				scale[0] * R[1],
				scale[0] * R[2],
				scale[1] * R[3],
				scale[1] * R[4],
				scale[1] * R[5],
				scale[2] * R[6],
				scale[2] * R[7],
				scale[2] * R[8],
			];

            //covA[3 * j + 0] = M[0] * M[0] + M[3] * M[3] + M[6] * M[6];
			//covA[3 * j + 1] = M[0] * M[1] + M[3] * M[4] + M[6] * M[7];
			//covA[3 * j + 2] = M[0] * M[2] + M[3] * M[5] + M[6] * M[8];
			//covB[3 * j + 0] = M[1] * M[1] + M[4] * M[4] + M[7] * M[7];
			//covB[3 * j + 1] = M[1] * M[2] + M[4] * M[5] + M[7] * M[8];
			//covB[3 * j + 2] = M[2] * M[2] + M[5] * M[5] + M[8] * M[8];

            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i + 3] = M[0] * M[0] + M[3] * M[3] + M[6] * M[6];
            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i + 4] = M[0] * M[1] + M[3] * M[4] + M[6] * M[7];
            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i + 5] = M[0] * M[2] + M[3] * M[5] + M[6] * M[8];
            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i + 6] = M[1] * M[1] + M[4] * M[4] + M[7] * M[7];
            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i + 7] = M[1] * M[2] + M[4] * M[5] + M[7] * M[8];
            covariancePositionArray[SplatBuffer.CovariancePositionSizeFloat * i + 8] = M[2] * M[2] + M[5] * M[5] + M[8] * M[8];
		}
    }

    getBufferData() {
        return this.bufferData;
    }

    getVertexCount() {
        return this.bufferData.byteLength / SplatBuffer.RowSize;
    }

}
