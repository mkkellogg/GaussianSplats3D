import * as THREE from 'three';

export class SplatBuffer {

    // Row format:
    //     Center position (XYZ) - Float32 * 3
    //     Scale (XYZ)  - Float32 * 3
    //     Color (RGBA) - Uint8 * 4
    //     Rotation (IJKW) - Float32 * 4

    static PositionComponentCount = 3;
    static ScaleComponentCount = 3;
    static RotationComponentCount = 4;
    static ColorComponentCount = 4;

    static RowSizeBytes = 44;
    static RowSizeFloats = 11;
    static PositionSizeFloats = 3;
    static PositionSizeBytes = 12;
    static CovarianceSizeFloats = 6;
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
            this.uint8Array = new Uint8Array(this.bufferData);
            this.precomputedCovarianceBufferData = null;
            this.precomputedColorBufferData = null;
        } else {
            this.bufferData = bufferDataOrVertexCount;
            this.floatArray = new Float32Array(this.bufferData);
            this.uint8Array = new Uint8Array(this.bufferData);
            this.precomputedCovarianceBufferData = null;
            this.precomputedColorBufferData = null;
        }
    }

    optimize(minAlpha) {
        let vertexCount = this.getVertexCount();
        const oldVertexCount = vertexCount;
        const oldByteCount = vertexCount * SplatBuffer.RowSizeBytes;

        let index = 0;
        while (index < vertexCount) {
            const colorBase = SplatBuffer.RowSizeBytes * index + SplatBuffer.ColorRowOffsetBytes;
            const baseAlpha = this.uint8Array[colorBase + 3];
            if (baseAlpha <= minAlpha) {
                this.swapVertices(index, vertexCount - 1);
                vertexCount--;
            } else {
                index++;
            }
        }

        const newByteCount = vertexCount * SplatBuffer.RowSizeBytes;

        console.log("Splat buffer optimization");
        console.log("-------------------------------");
        console.log("Old vertex count: " + oldVertexCount);
        console.log("Old byte count: " + oldByteCount);
        console.log("New vertex count: " + vertexCount);
        console.log("New byte count: " + newByteCount);
        console.log("Reduction: " + ((oldByteCount - newByteCount) / oldByteCount * 100).toFixed(3) + '%');
        console.log("==============================");
        console.log("");

        const newBufferData = this.bufferData.transfer(newByteCount);
        this.bufferData = newBufferData;
        this.floatArray = new Float32Array(this.bufferData);
        this.uint8Array = new Uint8Array(this.bufferData);
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
            colorArray[SplatBuffer.ColorSizeFloats * i] = this.uint8Array[colorBase] / 255;
            colorArray[SplatBuffer.ColorSizeFloats * i + 1] = this.uint8Array[colorBase + 1] / 255;
            colorArray[SplatBuffer.ColorSizeFloats * i + 2] = this.uint8Array[colorBase + 2] / 255;
            colorArray[SplatBuffer.ColorSizeFloats * i + 3] = this.uint8Array[colorBase + 3] / 255;

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
            covarianceArray[SplatBuffer.CovarianceSizeFloats * i] = M[0] * M[0] + M[3] * M[3] + M[6] * M[6];
            covarianceArray[SplatBuffer.CovarianceSizeFloats * i + 1] = M[0] * M[1] + M[3] * M[4] + M[6] * M[7];
            covarianceArray[SplatBuffer.CovarianceSizeFloats * i + 2] = M[0] * M[2] + M[3] * M[5] + M[6] * M[8];
            covarianceArray[SplatBuffer.CovarianceSizeFloats * i + 3] = M[1] * M[1] + M[4] * M[4] + M[7] * M[7];
            covarianceArray[SplatBuffer.CovarianceSizeFloats * i + 4] = M[1] * M[2] + M[4] * M[5] + M[7] * M[8];
            covarianceArray[SplatBuffer.CovarianceSizeFloats * i + 5] = M[2] * M[2] + M[5] * M[5] + M[8] * M[8];
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

    getRotation(index, outRotation = new THREE.Quaternion()) {
        const rotationBase = SplatBuffer.RowSizeFloats * index + SplatBuffer.RotationRowOffsetFloats;
        outRotation.set(this.floatArray[rotationBase + 1], this.floatArray[rotationBase + 2],  this.floatArray[rotationBase + 3], this.floatArray[rotationBase]);
        return outRotation;
    }

    getColor(index, outColor = new THREE.Color()) {
        const colorBase = SplatBuffer.RowSizeBytes * index + SplatBuffer.ColorRowOffsetBytes;
        outColor.set(this.uint8Array[colorBase], this.uint8Array[colorBase + 1], this.uint8Array[colorBase + 2]);
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

    fillPositionArray(outPositionArray) {
        const vertexCount = this.getVertexCount();
        for (let i = 0; i < vertexCount; i++) {
            const outPositionBase = i * SplatBuffer.PositionComponentCount;
            const srcPositionBase = SplatBuffer.RowSizeFloats * i;
            outPositionArray[outPositionBase] = this.floatArray[srcPositionBase];
            outPositionArray[outPositionBase + 1] = this.floatArray[srcPositionBase + 1];
            outPositionArray[outPositionBase + 2] = this.floatArray[srcPositionBase + 2];
        }
    }

    fillScaleArray(outScaleArray) {
        const vertexCount = this.getVertexCount();
        for (let i = 0; i < vertexCount; i++) {
            const outScaleBase = i * SplatBuffer.ScaleComponentCount;
            const srcScaleBase = SplatBuffer.RowSizeFloats * i + SplatBuffer.ScaleRowOffsetFloats;
            outScaleArray[outScaleBase] = this.floatArray[srcScaleBase];
            outScaleArray[outScaleBase + 1] = this.floatArray[srcScaleBase + 1];
            outScaleArray[outScaleBase + 2] = this.floatArray[srcScaleBase + 2];
        }
    }

    fillRotationArray(outRotationArray) {
        const vertexCount = this.getVertexCount();
        for (let i = 0; i < vertexCount; i++) {
            const outRotationBase = i * SplatBuffer.RotationComponentCount;
            const srcRotationBase = SplatBuffer.RowSizeFloats * i + SplatBuffer.RotationRowOffsetFloats;
            outRotationArray[outRotationBase] = this.floatArray[srcRotationBase];
            outRotationArray[outRotationBase + 1] = this.floatArray[srcRotationBase + 1];
            outRotationArray[outRotationBase + 2] = this.floatArray[srcRotationBase + 2];
            outRotationArray[outRotationBase + 3] = this.floatArray[srcRotationBase + 3];
        }
    }

    fillColorArray(outColorArray) {
        const vertexCount = this.getVertexCount();
        for (let i = 0; i < vertexCount; i++) {
            const outColorBase = i * SplatBuffer.ColorComponentCount;
            const srcColorBase = SplatBuffer.RowSizeBytes * i + SplatBuffer.ColorRowOffsetBytes;
            outColorArray[outColorBase] = this.uint8Array[srcColorBase];
            outColorArray[outColorBase + 1] = this.uint8Array[srcColorBase + 1];
            outColorArray[outColorBase + 2] = this.uint8Array[srcColorBase + 2];
            outColorArray[outColorBase + 3] = this.uint8Array[srcColorBase + 3];
        }
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
        this.uint8Array[colorBase] = Math.floor(color.r * 255);
        this.uint8Array[colorBase + 1] = Math.floor(color.g * 255);
        this.uint8Array[colorBase + 2] = Math.floor(color.b * 255);
        this.uint8Array[colorBase + 3] = Math.floor(opacity * 255);
    }

    swapVertices(indexA, indexB) {
        let temp = 0;

        const positionBaseA = SplatBuffer.RowSizeFloats * indexA;
        const positionBaseB = SplatBuffer.RowSizeFloats * indexB;
        temp = this.floatArray[positionBaseB];
        this.floatArray[positionBaseB] = this.floatArray[positionBaseA];
        this.floatArray[positionBaseA] = temp;
        temp = this.floatArray[positionBaseB + 1];
        this.floatArray[positionBaseB + 1] = this.floatArray[positionBaseA + 1];
        this.floatArray[positionBaseA + 1] = temp;
        temp = this.floatArray[positionBaseB + 2];
        this.floatArray[positionBaseB + 2] = this.floatArray[positionBaseA + 2];
        this.floatArray[positionBaseA + 2] = temp;

        const scaleBaseA = SplatBuffer.RowSizeFloats * indexA + SplatBuffer.ScaleRowOffsetFloats;
        const scaleBaseB = SplatBuffer.RowSizeFloats * indexB + SplatBuffer.ScaleRowOffsetFloats;
        temp = this.floatArray[scaleBaseB];
        this.floatArray[scaleBaseB] = this.floatArray[scaleBaseA];
        this.floatArray[scaleBaseA] = temp;
        temp = this.floatArray[scaleBaseB + 1];
        this.floatArray[scaleBaseB + 1] = this.floatArray[scaleBaseA + 1];
        this.floatArray[scaleBaseA + 1] = temp;
        temp = this.floatArray[scaleBaseB + 2];
        this.floatArray[scaleBaseB + 2] = this.floatArray[scaleBaseA + 2];
        this.floatArray[scaleBaseA + 2] = temp;

        const rotationBaseA = SplatBuffer.RowSizeFloats * indexA + SplatBuffer.RotationRowOffsetFloats;
        const rotationBaseB = SplatBuffer.RowSizeFloats * indexB + SplatBuffer.RotationRowOffsetFloats;
        temp = this.floatArray[rotationBaseB];
        this.floatArray[rotationBaseB] = this.floatArray[rotationBaseA];
        this.floatArray[rotationBaseA] = temp;
        temp = this.floatArray[rotationBaseB + 1];
        this.floatArray[rotationBaseB + 1] = this.floatArray[rotationBaseA + 1];
        this.floatArray[rotationBaseA + 1] = temp;
        temp = this.floatArray[rotationBaseB + 2];
        this.floatArray[rotationBaseB + 2] = this.floatArray[rotationBaseA + 2];
        this.floatArray[rotationBaseA + 2] = temp;
        temp = this.floatArray[rotationBaseB + 3];
        this.floatArray[rotationBaseB + 3] = this.floatArray[rotationBaseA + 3];
        this.floatArray[rotationBaseA + 3] = temp;

        const colorBaseA = SplatBuffer.RowSizeBytes * indexA + SplatBuffer.ColorRowOffsetBytes;
        const colorBaseB = SplatBuffer.RowSizeBytes * indexB + SplatBuffer.ColorRowOffsetBytes;
        temp = this.uint8Array[colorBaseB];
        this.uint8Array[colorBaseB] = this.uint8Array[colorBaseA];
        this.uint8Array[colorBaseA] = temp;
        temp = this.uint8Array[colorBaseB + 1];
        this.uint8Array[colorBaseB + 1] = this.uint8Array[colorBaseA + 1];
        this.uint8Array[colorBaseA + 1] = temp;
        temp = this.uint8Array[colorBaseB + 2];
        this.uint8Array[colorBaseB + 2] = this.uint8Array[colorBaseA + 2];
        this.uint8Array[colorBaseA + 2] = temp;
        temp = this.uint8Array[colorBaseB + 3];
        this.uint8Array[colorBaseB + 3] = this.uint8Array[colorBaseA + 3];
        this.uint8Array[colorBaseA + 3] = temp;
    }

    copyVertexFromSplatBuffer(otherSplatBuffer, srcIndex, destIndex) {
        const srcArray = new Float32Array(otherSplatBuffer.bufferData, srcIndex * SplatBuffer.RowSizeBytes, SplatBuffer.RowSizeFloats);
        const destArray = new Float32Array(this.bufferData, destIndex * SplatBuffer.RowSizeBytes, SplatBuffer.RowSizeFloats);
        destArray.set(srcArray);
    }

}
