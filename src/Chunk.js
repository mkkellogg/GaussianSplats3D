import * as THREE from 'three';

export class Chunk {

    constructor(min, max) {
        this.min = new THREE.Vector3().copy(min);
        this.max = new THREE.Vector3().copy(max);
        this.data = null;
    }

    setData(data) {
        this.data = data;
    }
}