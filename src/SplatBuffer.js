import * as THREE from 'three';

export class SplatBuffer {

    // Row format:
    //     Center position (XYZ) - Float32 * 3
    //     Scale (XYZ)  - Float32 * 3
    //     Color (RGBA) - Uint8 * 4
    //     Rotation (IJKW) - Float32 * 4

    static RowSizeBytes = 44;
    static RowSizeFloats = 11;
    static CovarianceSizeFloat = 6;
    static CovarianceSizeBytes = 24;
    static ColorSizeFloats = 4;
    static ColorSizeBytes = 16;

    static ScaleRowOffsetFloats = 3;
    static ScaleRowOffsetBytes = 12;
    static ColorRowOffsetBytes = 24;
    static RotationRowOffsetFloats = 7;
    static RotationRowOffsetBytes = 28;

    constructor(bufferDataOrVertexCount) {
        if (typeof bufferDataOrVertexCount === 'number') {
            this.bufferData = new ArrayBuffer(SplatBuffer.RowSizeBytes * bufferDataOrVertexCount);
            this.floatArray = new Float32Array(this.bufferData);
            this.uintArray = new Uint8Array(this.bufferData);
            this.precomputedCovarianceBufferData = null;
            this.precomputedColorBufferData = null;
        } else {
            this.bufferData = bufferDataOrVertexCount;
            this.floatArray = new Float32Array(this.bufferData);
            this.uintArray = new Uint8Array(this.bufferData);
            this.precomputedCovarianceBufferData = null;
            this.precomputedColorBufferData = null;
        }
    }

    buildPreComputedBuffers() {
        const vertexCount = this.getVertexCount();

        this.precomputedCovarianceBufferData = new ArrayBuffer(SplatBuffer.CovarianceSizeBytes * vertexCount);
        const covarianceArray = new Float32Array(this.precomputedCovarianceBufferData);

        this.precomputedColorBufferData = new ArrayBuffer(SplatBuffer.ColorSizeBytes * vertexCount);
        const colorArray = new Float32Array(this.precomputedColorBufferData);

        const scale = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const rotationMatrix = new THREE.Matrix3();
        const scaleMatrix = new THREE.Matrix3();
        const covarianceMatrix = new THREE.Matrix3();
        const tempMatrix4 = new THREE.Matrix4();
        for (let i = 0; i < vertexCount; i++) {

            const colorBase = SplatBuffer.RowSizeBytes * i + SplatBuffer.ColorRowOffsetBytes;
            colorArray[SplatBuffer.ColorSizeFloats * i] = this.uintArray[colorBase] / 255;
            colorArray[SplatBuffer.ColorSizeFloats * i + 1] = this.uintArray[colorBase + 1] / 255;
            colorArray[SplatBuffer.ColorSizeFloats * i + 2] = this.uintArray[colorBase + 2] / 255;
            colorArray[SplatBuffer.ColorSizeFloats * i + 3] = this.uintArray[colorBase + 3] / 255;

            const scaleBase = SplatBuffer.RowSizeFloats * i + SplatBuffer.ScaleRowOffsetFloats;
            scale.set(this.floatArray[scaleBase], this.floatArray[scaleBase + 1], this.floatArray[scaleBase + 2]);
            tempMatrix4.makeScale(scale.x, scale.y, scale.z);
            scaleMatrix.setFromMatrix4(tempMatrix4);

            const rotationBase = SplatBuffer.RowSizeFloats * i + SplatBuffer.RotationRowOffsetFloats;
            rotation.set(this.floatArray[rotationBase + 1],
                         this.floatArray[rotationBase + 2],
                         this.floatArray[rotationBase + 3],
                         this.floatArray[rotationBase]);
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

    getPosition(index, outPosition = new THREE.Vector3()) {
        const positionBase = SplatBuffer.RowSizeFloats * index;
        outPosition.set(this.floatArray[positionBase], this.floatArray[positionBase + 1], this.floatArray[positionBase + 2]);
        return outPosition;
    }

    getScale(index, outScale = new THREE.Vector3()) {
        const scaleBase = SplatBuffer.RowSizeFloats * index + SplatBuffer.ScaleRowOffsetFloats;
        outScale.set(this.floatArray[scaleBase], this.floatArray[scaleBase + 1], this.floatArray[scaleBase + 2]);
        return outScale;
    }

    getColor(index, outColor = new THREE.Color()) {
        const colorBase = SplatBuffer.RowSizeBytes * index + SplatBuffer.ColorRowOffsetBytes;
        outColor.set(this.uintArray[colorBase], this.uintArray[colorBase + 1], this.uintArray[colorBase + 2]);
        return outColor;
    }

    getPrecomputedCovarianceBufferData() {
        return this.precomputedCovarianceBufferData;
    }

    getPrecomputedColorBufferData() {
        return this.precomputedColorBufferData;
    }

    getVertexCount() {
        return this.bufferData.byteLength / SplatBuffer.RowSizeBytes;
    }

    setVertexDataFromComponents(index, position, scale, rotation, color, opacity) {
        const positionBase = SplatBuffer.RowSizeFloats * index;
        this.floatArray[positionBase] = position.x;
        this.floatArray[positionBase + 1] = position.y;
        this.floatArray[positionBase + 2] = position.z;

        const scaleBase = SplatBuffer.RowSizeFloats * index + SplatBuffer.ScaleRowOffsetFloats;
        this.floatArray[scaleBase] = scale.x;
        this.floatArray[scaleBase + 1] = scale.y;
        this.floatArray[scaleBase + 2] = scale.z;

        const rotationBase = SplatBuffer.RowSizeFloats * i + SplatBuffer.RotationRowOffsetFloats;
        this.floatArray[rotationBase] = rotation.w;
        this.floatArray[rotationBase + 1] = rotation.x;
        this.floatArray[rotationBase + 2] = rotation.y;
        this.floatArray[rotationBase + 3] = rotation.z;

        const colorBase = SplatBuffer.RowSizeBytes * i + SplatBuffer.ColorRowOffsetBytes;
        this.uintArray[colorBase] = Math.floor(color.r * 255);
        this.uintArray[colorBase + 1] = Math.floor(color.g * 255);
        this.uintArray[colorBase + 2] = Math.floor(color.b * 255);
        this.uintArray[colorBase + 3] = Math.floor(opacity * 255);
    }

    copyVertexFromSplatBuffer(otherSplatBuffer, srcIndex, destIndex) {
        const srcArray = new Float32Array(otherSplatBuffer.bufferData, srcIndex * SplatBuffer.RowSizeBytes, SplatBuffer.RowSizeFloats);
        const destArray = new Float32Array(this.bufferData, destIndex * SplatBuffer.RowSizeBytes, SplatBuffer.RowSizeFloats);
        destArray.set(srcArray);
    }

}
