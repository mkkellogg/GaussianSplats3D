import * as THREE from 'three';

const _axis = new THREE.Vector3();

export class ArrowHelper extends THREE.Object3D {

    constructor(dir = new THREE.Vector3(0, 0, 1), origin = new THREE.Vector3(0, 0, 0), length = 1,
                radius = 0.1, color = 0xffff00, headLength = length * 0.2, headRadius = headLength * 0.2) {
        super();

        this.type = 'ArrowHelper';

        const lineGeometry = new THREE.CylinderGeometry(radius, radius, length, 32);
        lineGeometry.translate(0, length / 2.0, 0);
        const coneGeometry = new THREE.CylinderGeometry( 0, headRadius, headLength, 32);
        coneGeometry.translate(0, length, 0);

        this.position.copy( origin );

        this.line = new THREE.Mesh(lineGeometry, new THREE.MeshBasicMaterial({color: color, toneMapped: false}));
        this.line.matrixAutoUpdate = false;
        this.add(this.line);

        this.cone = new THREE.Mesh(coneGeometry, new THREE.MeshBasicMaterial({color: color, toneMapped: false}));
        this.cone.matrixAutoUpdate = false;
        this.add(this.cone);

        this.setDirection(dir);
    }

    setDirection( dir ) {
        if (dir.y > 0.99999) {
            this.quaternion.set(0, 0, 0, 1);
        } else if (dir.y < - 0.99999) {
            this.quaternion.set(1, 0, 0, 0);
        } else {
            _axis.set(dir.z, 0, -dir.x).normalize();
            const radians = Math.acos(dir.y);
            this.quaternion.setFromAxisAngle(_axis, radians);
        }
    }

    setColor( color ) {
        this.line.material.color.set(color);
        this.cone.material.color.set(color);
    }

    copy(source) {
        super.copy(source, false);
        this.line.copy(source.line);
        this.cone.copy(source.cone);
        return this;
    }

    dispose() {
        this.line.geometry.dispose();
        this.line.material.dispose();
        this.cone.geometry.dispose();
        this.cone.material.dispose();
    }

}
