import * as THREE from 'three';

/**
 * SplatScene: Descriptor for a single splat scene managed by an instance of SplatMesh.
 */
export class SplatScene {

    constructor(splatBuffer, position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1)) {
        this.splatBuffer = splatBuffer;
        this.position = position.clone();
        this.quaternion = quaternion.clone();
        this.scale = scale.clone();
        this.transform = new THREE.Matrix4();
        this.updateTransform();
    }

    copyTransformData(otherScene) {
        this.position.copy(otherScene.position);
        this.quaternion.copy(otherScene.quaternion);
        this.scale.copy(otherScene.scale);
        this.transform.copy(otherScene.transform);
    }

    updateTransform() {
        this.transform.compose(this.position, this.quaternion, this.scale);
    }
}
