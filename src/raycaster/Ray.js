import * as THREE from 'three';

const VectorRight = new THREE.Vector3(1, 0, 0);
const VectorUp = new THREE.Vector3(0, 1, 0);
const VectorBackward = new THREE.Vector3(0, 0, 1);

export class Ray {

    constructor(origin = new THREE.Vector3(), direction = new THREE.Vector3()) {
        this.origin = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.setParameters(origin, direction);
    }

    setParameters(origin, direction) {
        this.origin.copy(origin);
        this.direction.copy(direction).normalize();
    }

    boxContainsPoint(box, point, epsilon) {
        return point.x < box.min.x - epsilon || point.x > box.max.x + epsilon ||
               point.y < box.min.y - epsilon || point.y > box.max.y + epsilon ||
               point.z < box.min.z - epsilon || point.z > box.max.z + epsilon ? false : true;
    }

    intersectBox = function() {

        const planeIntersectionPoint = new THREE.Vector3();
        const planeIntersectionPointArray = [];
        const originArray = [];
        const directionArray = [];

        return function(box, outHit) {

            originArray[0] = this.origin.x;
            originArray[1] = this.origin.y;
            originArray[2] = this.origin.z;
            directionArray[0] = this.direction.x;
            directionArray[1] = this.direction.y;
            directionArray[2] = this.direction.z;

            if (this.boxContainsPoint(box, this.origin, 0.0001)) {
                if (outHit) {
                    outHit.origin.copy(this.origin);
                    outHit.normal.set(0, 0, 0);
                    outHit.distance = -1;
                }
                return true;
            }

            for (let i = 0; i < 3; i++) {
                if (directionArray[i] == 0.0) continue;

                const hitNormal = i == 0 ? VectorRight : i == 1 ? VectorUp : VectorBackward;
                const extremeVec = directionArray[i] < 0 ? box.max : box.min;
                let multiplier = -Math.sign(directionArray[i]);
                planeIntersectionPointArray[0] = i == 0 ? extremeVec.x : i == 1 ? extremeVec.y : extremeVec.z;
                let toSide = planeIntersectionPointArray[0] - originArray[i];

                if (toSide * multiplier < 0) {
                    const idx1 = (i + 1) % 3;
                    const idx2 = (i + 2) % 3;
                    planeIntersectionPointArray[2] = directionArray[idx1] / directionArray[i] * toSide + originArray[idx1];
                    planeIntersectionPointArray[1] = directionArray[idx2] / directionArray[i] * toSide + originArray[idx2];
                    planeIntersectionPoint.set(planeIntersectionPointArray[i],
                                               planeIntersectionPointArray[idx2],
                                               planeIntersectionPointArray[idx1]);
                    if (this.boxContainsPoint(box, planeIntersectionPoint, 0.0001)) {
                        if (outHit) {
                            outHit.origin.copy(planeIntersectionPoint);
                            outHit.normal.copy(hitNormal).multiplyScalar(multiplier);
                            outHit.distance = planeIntersectionPoint.sub(this.origin).length();
                        }
                        return true;
                    }
                }
            }

            return false;
        };

    }();

    intersectSphere = function() {

        const toSphereCenterVec = new THREE.Vector3();

        return function(center, radius, outHit) {
            toSphereCenterVec.copy(center).sub(this.origin);
            const toClosestApproach = toSphereCenterVec.dot(this.direction);
            const toClosestApproachSq = toClosestApproach * toClosestApproach;
            const toSphereCenterSq = toSphereCenterVec.dot(toSphereCenterVec);
            const diffSq = toSphereCenterSq - toClosestApproachSq;
            const radiusSq = radius * radius;

            if (diffSq > radiusSq) return false;

            const thc = Math.sqrt(radiusSq - diffSq);
            const t0 = toClosestApproach - thc;
            const t1 = toClosestApproach + thc;

            if (t1 < 0) return false;
            let t = t0 < 0 ? t1 : t0;

            if (outHit) {
                outHit.origin.copy(this.origin).addScaledVector(this.direction, t);
                outHit.normal.copy(outHit.origin).sub(center).normalize();
                outHit.distance = t;
            }
            return true;
        };

    }();
}
