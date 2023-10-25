import * as THREE from 'three';

const tempVector3A = new THREE.Vector3();
const tempVector3B = new THREE.Vector3();
const tempVector4A = new THREE.Vector4();
const tempVector4B = new THREE.Vector4();
const tempQuaternion4A = new THREE.Quaternion();
const tempQuaternion4B = new THREE.Quaternion();

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

    static CompressionLevels = {
        0: {
            BytesPerPosition: 12,
            BytesPerScale: 12,
            BytesPerColor: 4,
            BytesPerRotation: 16
        },
        1: {
            BytesPerPosition: 6,
            BytesPerScale: 6,
            BytesPerColor: 4,
            BytesPerRotation: 8
        }
    };

    static CovarianceSizeFloats = 6;
    static CovarianceSizeBytes = 24;

    static HeaderSizeBytes = 1024;

    constructor(bufferData) {
        this.headerBufferData = new ArrayBuffer(SplatBuffer.HeaderSizeBytes);
        this.headerArray = new Uint8Array(this.headerBufferData);
        this.headerArray.set(new Uint8Array(bufferData, 0, SplatBuffer.HeaderSizeBytes));
        this.compressionLevel = this.headerArray[0];
        this.splatCount = (new Uint32Array(this.headerBufferData, 4, 1))[0];

        this.bucketSize = (new Uint32Array(this.headerBufferData, 8, 1))[0];
        this.bucketCount = (new Uint32Array(this.headerBufferData, 12, 1))[0];
        this.bucketBlockSize = (new Float32Array(this.headerBufferData, 16, 1))[0];
        this.bytesPerBucket = (new Uint32Array(this.headerBufferData, 20, 1))[0];

        const dataBufferSizeBytes = bufferData.byteLength - SplatBuffer.HeaderSizeBytes;
        this.splatBufferData = new ArrayBuffer(dataBufferSizeBytes);
        new Uint8Array(this.splatBufferData).set(new Uint8Array(bufferData, SplatBuffer.HeaderSizeBytes, dataBufferSizeBytes));

        this.bytesPerPosition = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerPosition;
        this.bytesPerScale = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerScale;
        this.bytesPerColor = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerColor;
        this.bytesPerRotation = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerRotation;

        this.bytesPerSplat = this.bytesPerPosition + this.bytesPerScale + this.bytesPerColor + this.bytesPerRotation;

        this.linkBufferArrays();

        this.precomputedCovarianceBufferData = null;
    }

    linkBufferArrays() {
        if (this.compressionLevel === 0) {
            this.positionArray = new Float32Array(this.splatBufferData, 0, this.splatCount * SplatBuffer.PositionComponentCount);
            this.scaleArray = new Float32Array(this.splatBufferData, this.bytesPerPosition * this.splatCount,
                                               this.splatCount * SplatBuffer.ScaleComponentCount);
            this.colorArray = new Uint8Array(this.splatBufferData, (this.bytesPerPosition + this.bytesPerScale) * this.splatCount,
                                             this.splatCount * SplatBuffer.ColorComponentCount);
            this.rotationArray = new Float32Array(this.splatBufferData,
                                                 (this.bytesPerPosition + this.bytesPerScale + this.bytesPerColor) * this.splatCount,
                                                  this.splatCount * SplatBuffer.RotationComponentCount);
        } else {
            this.positionArray = new Uint16Array(this.splatBufferData, 0, this.splatCount * SplatBuffer.PositionComponentCount);
            this.scaleArray = new Uint16Array(this.splatBufferData, this.bytesPerPosition * this.splatCount,
                                              this.splatCount * SplatBuffer.ScaleComponentCount);
            this.colorArray = new Uint8Array(this.splatBufferData, (this.bytesPerPosition + this.bytesPerScale) * this.splatCount,
                                             this.splatCount * SplatBuffer.ColorComponentCount);
            this.rotationArray = new Uint16Array(this.splatBufferData,
                                                (this.bytesPerPosition + this.bytesPerScale + this.bytesPerColor) * this.splatCount,
                                                 this.splatCount * SplatBuffer.RotationComponentCount);
        }
        this.bucketsBase = this.splatCount * this.bytesPerSplat;
    }

    fbf(f) {
        if (this.compressionLevel === 0) {
            return f;
        } else {
            return THREE.DataUtils.fromHalfFloat(f);
        }
    };

    tbf(f) {
        if (this.compressionLevel === 0) {
            return f;
        } else {
            return THREE.DataUtils.toHalfFloat(f);
        }
    };

    buildPreComputedBuffers() {
        const splatCount = this.splatCount;

        this.precomputedCovarianceBufferData = new ArrayBuffer(SplatBuffer.CovarianceSizeBytes * splatCount);
        const covarianceArray = new Float32Array(this.precomputedCovarianceBufferData);

        const scale = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const rotationMatrix = new THREE.Matrix3();
        const scaleMatrix = new THREE.Matrix3();
        const covarianceMatrix = new THREE.Matrix3();
        const tempMatrix4 = new THREE.Matrix4();

        const fbf = this.fbf.bind(this);

        for (let i = 0; i < splatCount; i++) {
            const scaleBase = i * SplatBuffer.ScaleComponentCount;
            scale.set(fbf(this.scaleArray[scaleBase]), fbf(this.scaleArray[scaleBase + 1]), fbf(this.scaleArray[scaleBase + 2]));
            tempMatrix4.makeScale(scale.x, scale.y, scale.z);
            scaleMatrix.setFromMatrix4(tempMatrix4);

            const rotationBase = i * SplatBuffer.RotationComponentCount;
            rotation.set(fbf(this.rotationArray[rotationBase + 1]),
                         fbf(this.rotationArray[rotationBase + 2]),
                         fbf(this.rotationArray[rotationBase + 3]),
                         fbf(this.rotationArray[rotationBase]));
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

    getHeaderBufferData() {
        return this.headerBufferData;
    }

    getSplatBufferData() {
        return this.splatBufferData;
    }

    getPosition(index, outPosition = new THREE.Vector3()) {
        let bucket = [0, 0, 0];
        if (this.bucketCount > 0) {
            const bucketIndex = Math.floor(index / this.bucketSize);
            bucket = new Float32Array(this.splatBufferData, this.bucketsBase + bucketIndex * this.bytesPerBucket, 3);
        }
        const fbf = this.fbf.bind(this);
        const positionBase = index * SplatBuffer.PositionComponentCount;
        outPosition.set(fbf(this.positionArray[positionBase]) + bucket[0], fbf(this.positionArray[positionBase + 1]) + bucket[1],
                        fbf(this.positionArray[positionBase + 2]) + bucket[2]);
        return outPosition;
    }

    setPosition(index, position) {
        let bucket = [0, 0, 0];
        if (this.bucketCount > 0) {
            const bucketIndex = Math.floor(index / this.bucketSize);
            bucket = new Float32Array(this.splatBufferData, this.bucketsBase + bucketIndex * this.bytesPerBucket, 3);
        }
        const tbf = this.tbf.bind(this);
        const positionBase = index * SplatBuffer.PositionComponentCount;
        this.positionArray[positionBase] = tbf(position.x - bucket[0]);
        this.positionArray[positionBase + 1] = tbf(position.y - bucket[1]);
        this.positionArray[positionBase + 2] = tbf(position.z - bucket[2]);
    }

    getScale(index, outScale = new THREE.Vector3()) {
        const fbf = this.fbf.bind(this);
        const scaleBase = index * SplatBuffer.ScaleComponentCount;
        outScale.set(fbf(this.scaleArray[scaleBase]), fbf(this.scaleArray[scaleBase + 1]), fbf(this.scaleArray[scaleBase + 2]));
        return outScale;
    }

    setScale(index, scale) {
        const tbf = this.tbf.bind(this);
        const scaleBase = index * SplatBuffer.ScaleComponentCount;
        this.scaleArray[scaleBase] = tbf(scale.x);
        this.scaleArray[scaleBase + 1] = tbf(scale.y);
        this.scaleArray[scaleBase + 2] = tbf(scale.z);
    }

    getRotation(index, outRotation = new THREE.Quaternion()) {
        const fbf = this.fbf.bind(this);
        const rotationBase = index * SplatBuffer.RotationComponentCount;
        outRotation.set(fbf(this.rotationArray[rotationBase + 1]), fbf(this.rotationArray[rotationBase + 2]),
                        fbf(this.rotationArray[rotationBase + 3]), fbf(this.rotationArray[rotationBase]));
        return outRotation;
    }

    setRotation(index, rotation) {
        const tbf = this.tbf.bind(this);
        const rotationBase = index * SplatBuffer.RotationComponentCount;
        this.rotationArray[rotationBase] = tbf(rotation.w);
        this.rotationArray[rotationBase + 1] = tbf(rotation.x);
        this.rotationArray[rotationBase + 2] = tbf(rotation.y);
        this.rotationArray[rotationBase + 3] = tbf(rotation.z);
    }

    getColor(index, outColor = new THREE.Vector4()) {
        const colorBase = index * SplatBuffer.ColorComponentCount;
        outColor.set(this.colorArray[colorBase], this.colorArray[colorBase + 1],
                     this.colorArray[colorBase + 2], this.colorArray[colorBase + 3]);
        return outColor;
    }

    setColor(index, color) {
        const colorBase = index * SplatBuffer.ColorComponentCount;
        this.colorArray[colorBase] = color.x;
        this.colorArray[colorBase + 1] = color.y;
        this.colorArray[colorBase + 2] = color.z;
        this.colorArray[colorBase + 3] = color.w;
    }

    getPrecomputedCovarianceBufferData() {
        return this.precomputedCovarianceBufferData;
    }

    getSplatCount() {
        return this.splatCount;
    }

    fillPositionArray(outPositionArray) {
        const fbf = this.fbf.bind(this);
        const splatCount = this.splatCount;
        let bucket = [0, 0, 0];
        for (let i = 0; i < splatCount; i++) {
            if (this.bucketCount > 0) {
                const bucketIndex = Math.floor(i / this.bucketSize);
                bucket = new Float32Array(this.splatBufferData, this.bucketsBase + bucketIndex * this.bytesPerBucket, 3);
            }
            const positionBase = i * SplatBuffer.PositionComponentCount;
            outPositionArray[positionBase] = fbf(this.positionArray[positionBase]) + bucket[0];
            outPositionArray[positionBase + 1] = fbf(this.positionArray[positionBase + 1]) + bucket[1];
            outPositionArray[positionBase + 2] = fbf(this.positionArray[positionBase + 2]) + bucket[2];
        }
    }

    fillScaleArray(outScaleArray) {
        const fbf = this.fbf.bind(this);
        const splatCount = this.splatCount;
        for (let i = 0; i < splatCount; i++) {
            const scaleBase = i * SplatBuffer.ScaleComponentCount;
            outScaleArray[scaleBase] = fbf(this.scaleArray[scaleBase]);
            outScaleArray[scaleBase + 1] = fbf(this.scaleArray[scaleBase + 1]);
            outScaleArray[scaleBase + 2] = fbf(this.scaleArray[scaleBase + 2]);
        }
    }

    fillRotationArray(outRotationArray) {
        const fbf = this.fbf.bind(this);
        const splatCount = this.splatCount;
        for (let i = 0; i < splatCount; i++) {
            const rotationBase = i * SplatBuffer.RotationComponentCount;
            outRotationArray[rotationBase] = fbf(this.rotationArray[rotationBase]);
            outRotationArray[rotationBase + 1] = fbf(this.rotationArray[rotationBase + 1]);
            outRotationArray[rotationBase + 2] = fbf(this.rotationArray[rotationBase + 2]);
            outRotationArray[rotationBase + 3] = fbf(this.rotationArray[rotationBase + 3]);
        }
    }

    fillColorArray(outColorArray) {
        const splatCount = this.splatCount;
        for (let i = 0; i < splatCount; i++) {
            const colorBase = i * SplatBuffer.ColorComponentCount;
            outColorArray[colorBase] = this.colorArray[colorBase];
            outColorArray[colorBase + 1] = this.colorArray[colorBase + 1];
            outColorArray[colorBase + 2] = this.colorArray[colorBase + 2];
            outColorArray[colorBase + 3] = this.colorArray[colorBase + 3];
        }
    }

    swapVertices(indexA, indexB) {

        this.getPosition(indexA, tempVector3A);
        this.getPosition(indexB, tempVector3B);
        this.setPosition(indexB, tempVector3A);
        this.setPosition(indexA, tempVector3B);

        this.getScale(indexA, tempVector3A);
        this.getScale(indexB, tempVector3B);
        this.setScale(indexB, tempVector3A);
        this.setScale(indexA, tempVector3B);

        this.getRotation(indexA, tempQuaternion4A);
        this.getRotation(indexB, tempQuaternion4B);
        this.setRotation(indexB, tempQuaternion4A);
        this.setRotation(indexA, tempQuaternion4B);

        this.getColor(indexA, tempVector4A);
        this.getColor(indexB, tempVector4B);
        this.setColor(indexB, tempVector4A);
        this.setColor(indexA, tempVector4B);

    }

}
