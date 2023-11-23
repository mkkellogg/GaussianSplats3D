import * as THREE from 'three';

const tempVector3A = new THREE.Vector3();
const tempVector3B = new THREE.Vector3();
const tempVector4A = new THREE.Vector4();
const tempVector4B = new THREE.Vector4();
const tempQuaternion4A = new THREE.Quaternion();
const tempQuaternion4B = new THREE.Quaternion();

let fbf;
let tbf;

export class SplatBuffer {

    static CenterComponentCount = 3;
    static ScaleComponentCount = 3;
    static RotationComponentCount = 4;
    static ColorComponentCount = 4;

    static CompressionLevels = {
        0: {
            BytesPerCenter: 12,
            BytesPerScale: 12,
            BytesPerColor: 4,
            BytesPerRotation: 16,
            ScaleRange: 1
        },
        1: {
            BytesPerCenter: 6,
            BytesPerScale: 6,
            BytesPerColor: 4,
            BytesPerRotation: 8,
            ScaleRange: 32767
        }
    };

    static CovarianceSizeFloats = 6;
    static CovarianceSizeBytes = 24;

    static HeaderSizeBytes = 1024;

    constructor(bufferData) {
        this.headerBufferData = new ArrayBuffer(SplatBuffer.HeaderSizeBytes);
        this.headerArrayUint8 = new Uint8Array(this.headerBufferData);
        this.headerArrayUint32 = new Uint32Array(this.headerBufferData);
        this.headerArrayFloat32 = new Float32Array(this.headerBufferData);
        this.headerArrayUint8.set(new Uint8Array(bufferData, 0, SplatBuffer.HeaderSizeBytes));
        this.versionMajor = this.headerArrayUint8[0];
        this.versionMinor = this.headerArrayUint8[1];
        this.headerExtraK = this.headerArrayUint8[2];
        this.compressionLevel = this.headerArrayUint8[3];
        this.splatCount = this.headerArrayUint32[1];
        this.bucketSize = this.headerArrayUint32[2];
        this.bucketCount = this.headerArrayUint32[3];
        this.bucketBlockSize = this.headerArrayFloat32[4];
        this.halfBucketBlockSize = this.bucketBlockSize / 2.0;
        this.bytesPerBucket = this.headerArrayUint32[5];
        this.compressionScaleRange = this.headerArrayUint32[6] || SplatBuffer.CompressionLevels[this.compressionLevel].ScaleRange;
        this.compressionScaleFactor = this.halfBucketBlockSize / this.compressionScaleRange;

        const dataBufferSizeBytes = bufferData.byteLength - SplatBuffer.HeaderSizeBytes;
        this.splatBufferData = new ArrayBuffer(dataBufferSizeBytes);
        new Uint8Array(this.splatBufferData).set(new Uint8Array(bufferData, SplatBuffer.HeaderSizeBytes, dataBufferSizeBytes));

        this.bytesPerCenter = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerCenter;
        this.bytesPerScale = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerScale;
        this.bytesPerColor = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerColor;
        this.bytesPerRotation = SplatBuffer.CompressionLevels[this.compressionLevel].BytesPerRotation;

        this.bytesPerSplat = this.bytesPerCenter + this.bytesPerScale + this.bytesPerColor + this.bytesPerRotation;

        fbf = this.fbf.bind(this);
        tbf = this.tbf.bind(this);

        this.linkBufferArrays();
    }

    linkBufferArrays() {
        let FloatArray = (this.compressionLevel === 0) ? Float32Array : Uint16Array;
        this.centerArray = new FloatArray(this.splatBufferData, 0, this.splatCount * SplatBuffer.CenterComponentCount);
        this.scaleArray = new FloatArray(this.splatBufferData, this.bytesPerCenter * this.splatCount,
                                         this.splatCount * SplatBuffer.ScaleComponentCount);
        this.colorArray = new Uint8Array(this.splatBufferData, (this.bytesPerCenter + this.bytesPerScale) * this.splatCount,
                                         this.splatCount * SplatBuffer.ColorComponentCount);
        this.rotationArray = new FloatArray(this.splatBufferData,
                                             (this.bytesPerCenter + this.bytesPerScale + this.bytesPerColor) * this.splatCount,
                                              this.splatCount * SplatBuffer.RotationComponentCount);
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

    getHeaderBufferData() {
        return this.headerBufferData;
    }

    getSplatBufferData() {
        return this.splatBufferData;
    }

    getCenter(index, outCenter = new THREE.Vector3()) {
        let bucket = [0, 0, 0];
        const centerBase = index * SplatBuffer.CenterComponentCount;
        if (this.compressionLevel > 0) {
            const sf = this.compressionScaleFactor;
            const sr = this.compressionScaleRange;
            const bucketIndex = Math.floor(index / this.bucketSize);
            bucket = new Float32Array(this.splatBufferData, this.bucketsBase + bucketIndex * this.bytesPerBucket, 3);
            outCenter.x = (this.centerArray[centerBase] - sr) * sf + bucket[0];
            outCenter.y = (this.centerArray[centerBase + 1] - sr) * sf + bucket[1];
            outCenter.z = (this.centerArray[centerBase + 2] - sr) * sf + bucket[2];
        } else {
            outCenter.x = this.centerArray[centerBase];
            outCenter.y = this.centerArray[centerBase + 1];
            outCenter.z = this.centerArray[centerBase + 2];
        }
        return outCenter;
    }

    setCenter(index, center) {
        let bucket = [0, 0, 0];
        const centerBase = index * SplatBuffer.CenterComponentCount;
        if (this.compressionLevel > 0) {
            const sf = 1.0 / this.compressionScaleFactor;
            const sr = this.compressionScaleRange;
            const maxR = sr * 2 + 1;
            const bucketIndex = Math.floor(index / this.bucketSize);
            bucket = new Float32Array(this.splatBufferData, this.bucketsBase + bucketIndex * this.bytesPerBucket, 3);
            this.centerArray[centerBase] = clamp(Math.round((center.x - bucket[0]) * sf) + sr, 0, maxR);
            this.centerArray[centerBase + 1] = clamp(Math.round((center.y - bucket[1]) * sf) + sr, 0, maxR);
            this.centerArray[centerBase + 2] = clamp(Math.round((center.z - bucket[2]) * sf) + sr, 0, maxR);
        } else {
            this.centerArray[centerBase] = center.x;
            this.centerArray[centerBase + 1] = center.y;
            this.centerArray[centerBase + 2] = center.z;
        }
    }

    getScale(index, outScale = new THREE.Vector3()) {
        const scaleBase = index * SplatBuffer.ScaleComponentCount;
        outScale.set(fbf(this.scaleArray[scaleBase]), fbf(this.scaleArray[scaleBase + 1]), fbf(this.scaleArray[scaleBase + 2]));
        return outScale;
    }

    setScale(index, scale) {
        const scaleBase = index * SplatBuffer.ScaleComponentCount;
        this.scaleArray[scaleBase] = tbf(scale.x);
        this.scaleArray[scaleBase + 1] = tbf(scale.y);
        this.scaleArray[scaleBase + 2] = tbf(scale.z);
    }

    getRotation(index, outRotation = new THREE.Quaternion()) {
        const rotationBase = index * SplatBuffer.RotationComponentCount;
        outRotation.set(fbf(this.rotationArray[rotationBase + 1]), fbf(this.rotationArray[rotationBase + 2]),
                        fbf(this.rotationArray[rotationBase + 3]), fbf(this.rotationArray[rotationBase]));
        return outRotation;
    }

    setRotation(index, rotation) {
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

    getSplatCount() {
        return this.splatCount;
    }

    fillCovarianceArray(covarianceArray, destOffset) {
        const splatCount = this.splatCount;

        const scale = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const rotationMatrix = new THREE.Matrix3();
        const scaleMatrix = new THREE.Matrix3();
        const covarianceMatrix = new THREE.Matrix3();
        const tempMatrix4 = new THREE.Matrix4();

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
            const covBase = SplatBuffer.CovarianceSizeFloats * (i + destOffset);
            covarianceArray[covBase] = M[0] * M[0] + M[3] * M[3] + M[6] * M[6];
            covarianceArray[covBase + 1] = M[0] * M[1] + M[3] * M[4] + M[6] * M[7];
            covarianceArray[covBase + 2] = M[0] * M[2] + M[3] * M[5] + M[6] * M[8];
            covarianceArray[covBase + 3] = M[1] * M[1] + M[4] * M[4] + M[7] * M[7];
            covarianceArray[covBase + 4] = M[1] * M[2] + M[4] * M[5] + M[7] * M[8];
            covarianceArray[covBase + 5] = M[2] * M[2] + M[5] * M[5] + M[8] * M[8];
        }
    }

    fillCenterArray(outCenterArray, destOffset) {
        const splatCount = this.splatCount;
        let bucket = [0, 0, 0];
        for (let i = 0; i < splatCount; i++) {
            const centerBase = (i + destOffset) * SplatBuffer.CenterComponentCount;
            if (this.compressionLevel > 0) {
                const bucketIndex = Math.floor(i / this.bucketSize);
                bucket = new Float32Array(this.splatBufferData, this.bucketsBase + bucketIndex * this.bytesPerBucket, 3);
                const sf = this.compressionScaleFactor;
                const sr = this.compressionScaleRange;
                outCenterArray[centerBase] = (this.centerArray[centerBase] - sr) * sf + bucket[0];
                outCenterArray[centerBase + 1] = (this.centerArray[centerBase + 1] - sr) * sf + bucket[1];
                outCenterArray[centerBase + 2] = (this.centerArray[centerBase + 2] - sr) * sf + bucket[2];
            } else {
                outCenterArray[centerBase] = this.centerArray[centerBase];
                outCenterArray[centerBase + 1] = this.centerArray[centerBase + 1];
                outCenterArray[centerBase + 2] = this.centerArray[centerBase + 2];
            }
        }
    }

    fillScaleArray(outScaleArray, destOffset) {
        const fbf = this.fbf.bind(this);
        const splatCount = this.splatCount;
        for (let i = 0; i < splatCount; i++) {
            const scaleBase = (i + destOffset) * SplatBuffer.ScaleComponentCount;
            outScaleArray[scaleBase] = fbf(this.scaleArray[scaleBase]);
            outScaleArray[scaleBase + 1] = fbf(this.scaleArray[scaleBase + 1]);
            outScaleArray[scaleBase + 2] = fbf(this.scaleArray[scaleBase + 2]);
        }
    }

    fillRotationArray(outRotationArray, destOffset) {
        const fbf = this.fbf.bind(this);
        const splatCount = this.splatCount;
        for (let i = 0; i < splatCount; i++) {
            const rotationBase = (i + destOffset) * SplatBuffer.RotationComponentCount;
            outRotationArray[rotationBase] = fbf(this.rotationArray[rotationBase]);
            outRotationArray[rotationBase + 1] = fbf(this.rotationArray[rotationBase + 1]);
            outRotationArray[rotationBase + 2] = fbf(this.rotationArray[rotationBase + 2]);
            outRotationArray[rotationBase + 3] = fbf(this.rotationArray[rotationBase + 3]);
        }
    }

    fillColorArray(outColorArray, destOffset) {
        const splatCount = this.splatCount;
        for (let i = 0; i < splatCount; i++) {
            const colorBase = (i + destOffset) * SplatBuffer.ColorComponentCount;
            outColorArray[colorBase] = this.colorArray[colorBase];
            outColorArray[colorBase + 1] = this.colorArray[colorBase + 1];
            outColorArray[colorBase + 2] = this.colorArray[colorBase + 2];
            outColorArray[colorBase + 3] = this.colorArray[colorBase + 3];
        }
    }

    swapVertices(indexA, indexB) {

        this.getCenter(indexA, tempVector3A);
        this.getCenter(indexB, tempVector3B);
        this.setCenter(indexB, tempVector3A);
        this.setCenter(indexA, tempVector3B);

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
