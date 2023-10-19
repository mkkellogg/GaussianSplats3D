import * as THREE from 'three';

export class Hit {

    constructor() {
        this.origin = new THREE.Vector3();
        this.normal = new THREE.Vector3();
        this.distance = 0;
    }

    set(origin, normal, distance) {
        this.origin.copy(origin);
        this.normal.copy(normal);
        this.distance = distance;
    }

    clone() {
        const hitClone = new Hit();
        hitClone.origin.copy(this.origin);
        hitClone.normal.copy(this.normal);
        hitClone.distance = this.distance;
        return hitClone;
    }

}
