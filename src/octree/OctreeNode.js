import * as THREE from 'three';

export class OctreeNode {

    constructor(min, max, depth) {
        this.min = new THREE.Vector3().copy(min);
        this.max = new THREE.Vector3().copy(max);
        this.center = new THREE.Vector3().copy(this.max).sub(this.min).multiplyScalar(0.5).add(this.min);
        this.depth = depth;
        this.children = [];
        this.data = null;
    }

}