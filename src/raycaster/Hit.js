import * as THREE from 'three';

export class Hit {

    constructor() {
        this.origin = new THREE.Vector3();
        this.normal = new THREE.Vector3();
        this.distance = 0;
        this.splatIndex = 0;
    }

    set(origin, normal, distance, splatIndex) {
        this.origin.copy(origin);
        this.normal.copy(normal);
        this.distance = distance;
        this.splatIndex = splatIndex;
    }

    clone() {
        const hitClone = new Hit();
        hitClone.origin.copy(this.origin);
        hitClone.normal.copy(this.normal);
        hitClone.distance = this.distance;
        hitClone.splatIndex = this.splatIndex;
        return hitClone;
    }

}
