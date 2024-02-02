import * as THREE from 'three';

/**
 * SplatScene: Descriptor for a single splat scene managed by an instance of SplatMesh.
 */
export class SplatScene {

    constructor(
        /** @type {ArrayBuffer} */ splatBuffer,
        position = new THREE.Vector3(),
        quaternion = new THREE.Quaternion(),
        scale = new THREE.Vector3(1, 1, 1)
    ) {
        /** @type {ArrayBuffer} */
        this.splatBuffer = splatBuffer;
        /** @type {THREE.Vector3} */
        this.position = position.clone();
        /** @type {THREE.Quaternion} */
        this.quaternion = quaternion.clone();
        /** @type {THREE.Vector3} */
        this.scale = scale.clone();
        /** @type {THREE.Matrix4} */
        this.transform = new THREE.Matrix4();
        this.updateTransform();
    }

    copyTransformData(/** @type {THREE.Scene} */ otherScene) {
        this.position.copy(otherScene.position);
        this.quaternion.copy(otherScene.quaternion);
        this.scale.copy(otherScene.scale);
        this.transform.copy(otherScene.transform);
    }

    updateTransform() {
        this.transform.compose(this.position, this.quaternion, this.scale);
    }
}
