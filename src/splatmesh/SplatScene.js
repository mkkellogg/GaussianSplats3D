import * as THREE from 'three';

/**
 * SplatScene: Descriptor for a single splat scene managed by an instance of SplatMesh.
 */
export class SplatScene extends THREE.Object3D {

    constructor(splatBuffer, position = new THREE.Vector3(), quaternion = new THREE.Quaternion(),
                scale = new THREE.Vector3(1, 1, 1), minimumAlpha = 1, opacity = 1.0, visible = true) {
        super();
        this.splatBuffer = splatBuffer;
        this.position.copy(position);
        this.quaternion.copy(quaternion);
        this.scale.copy(scale);
        this.transform = new THREE.Matrix4();
        this.minimumAlpha = minimumAlpha;
        this.opacity = opacity;
        this.visible = visible;
    }

    copyTransformData(otherScene) {
        this.position.copy(otherScene.position);
        this.quaternion.copy(otherScene.quaternion);
        this.scale.copy(otherScene.scale);
        this.transform.copy(otherScene.transform);
    }

    updateTransform(dynamicMode) {
        if (dynamicMode) {
            if (this.matrixWorldAutoUpdate) this.updateWorldMatrix(true, false);
            this.transform.copy(this.matrixWorld);
        } else {
            if (this.matrixAutoUpdate) this.updateMatrix();
            this.transform.copy(this.matrix);
        }
    }
}
