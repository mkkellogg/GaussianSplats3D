import * as THREE from 'three';

export class SplatBuffer {

    // Row format: 
    //     Center position (XYZ) - Float32 * 3
    //     Scale (XYZ)  - Float32 * 3
    //     Color (RGBA) - Uint8 * 4
    //     Rotation (IJKW) - Uint8 * 4

    static RowSize = 32;
    static CovarianceSizeFloat = 6;
    static CovarianceSizeBytes = 24;
    static ColorRowOffset = 24;
    static ColorSizeFloat = 4;
    static ColorSizeBytes = 16;

    constructor(bufferData) {
        this.bufferData = bufferData;
        this.covarianceBufferData = null;
        this.colorBufferData = null;
    }

    buildPreComputedBuffers(){
        const vertexCount = this.getVertexCount();

        this.covarianceBufferData = new ArrayBuffer(SplatBuffer.CovarianceSizeBytes * vertexCount); 
        const covarianceArray = new Float32Array(this.covarianceBufferData);

        this.colorBufferData = new ArrayBuffer(SplatBuffer.ColorSizeBytes * vertexCount);
        const colorArray = new Float32Array(this.colorBufferData);

        const splatFloatArray = new Float32Array(this.bufferData);
        const splatUintArray = new Uint8Array(this.bufferData);

        const scale = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const rotationMatrix = new THREE.Matrix3();
        const scaleMatrix = new THREE.Matrix3();
        const covarianceMatrix = new THREE.Matrix3();
        const tempMatrix4 = new THREE.Matrix4();
        for (let i = 0; i < vertexCount; i++) {

            const baseColor = SplatBuffer.RowSize * i + SplatBuffer.ColorRowOffset;
            colorArray[SplatBuffer.ColorSizeFloat * i] = splatUintArray[baseColor] / 255;
            colorArray[SplatBuffer.ColorSizeFloat * i + 1] = splatUintArray[baseColor + 1] / 255;
            colorArray[SplatBuffer.ColorSizeFloat * i + 2] = splatUintArray[baseColor + 2] / 255;
            colorArray[SplatBuffer.ColorSizeFloat * i + 3] = splatUintArray[baseColor + 3] / 255;

            const baseScale = 8 * i + 3;
            scale.set(splatFloatArray[baseScale], splatFloatArray[baseScale + 1], splatFloatArray[baseScale + 2]);
            tempMatrix4.makeScale(scale.x, scale.y, scale.z);
            scaleMatrix.setFromMatrix4(tempMatrix4);
   
            const rotationBase = 32 * i + 28;
            rotation.set((splatUintArray[rotationBase + 1] - 128) / 128,
                         (splatUintArray[rotationBase + 2] - 128) / 128,
                         (splatUintArray[rotationBase + 3] - 128) / 128,
                         (splatUintArray[rotationBase ] - 128) / 128);
            tempMatrix4.makeRotationFromQuaternion(rotation);
            rotationMatrix.setFromMatrix4(tempMatrix4);

            covarianceMatrix.copy(rotationMatrix).multiply(scaleMatrix);
            const M = covarianceMatrix.elements;
            covarianceArray[SplatBuffer.CovarianceSizeFloat * i] = M[0] * M[0] + M[3] * M[3] + M[6] * M[6];
            covarianceArray[SplatBuffer.CovarianceSizeFloat * i + 1] = M[0] * M[1] + M[3] * M[4] + M[6] * M[7];
            covarianceArray[SplatBuffer.CovarianceSizeFloat * i + 2] = M[0] * M[2] + M[3] * M[5] + M[6] * M[8];
            covarianceArray[SplatBuffer.CovarianceSizeFloat * i + 3] = M[1] * M[1] + M[4] * M[4] + M[7] * M[7];
            covarianceArray[SplatBuffer.CovarianceSizeFloat * i + 4] = M[1] * M[2] + M[4] * M[5] + M[7] * M[8];
            covarianceArray[SplatBuffer.CovarianceSizeFloat * i + 5] = M[2] * M[2] + M[5] * M[5] + M[8] * M[8];
        }
    }

    getBufferData() {
        return this.bufferData;
    }

    getCovarianceBufferData() {
        return this.covarianceBufferData;
    }

    getColorBufferData() {
        return this.colorBufferData;
    }

    getVertexCount() {
        return this.bufferData.byteLength / SplatBuffer.RowSize;
    }

}
