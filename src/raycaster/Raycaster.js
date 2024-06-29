import * as THREE from 'three';
import { Ray } from './Ray.js';
import { Hit } from './Hit.js';
import { SplatRenderMode } from '../SplatRenderMode.js';

export class Raycaster {

    constructor(origin, direction, raycastAgainstTrueSplatEllipsoid = false) {
        this.ray = new Ray(origin, direction);
        this.raycastAgainstTrueSplatEllipsoid = raycastAgainstTrueSplatEllipsoid;
    }

    setFromCameraAndScreenPosition = function() {

        const ndcCoords = new THREE.Vector2();

        return function(camera, screenPosition, screenDimensions) {
            ndcCoords.x = screenPosition.x / screenDimensions.x * 2.0 - 1.0;
            ndcCoords.y = (screenDimensions.y - screenPosition.y) / screenDimensions.y * 2.0 - 1.0;
            if (camera.isPerspectiveCamera) {
                this.ray.origin.setFromMatrixPosition(camera.matrixWorld);
                this.ray.direction.set(ndcCoords.x, ndcCoords.y, 0.5 ).unproject(camera).sub(this.ray.origin).normalize();
                this.camera = camera;
            } else if (camera.isOrthographicCamera) {
                this.ray.origin.set(ndcCoords.x, ndcCoords.y,
                                   (camera.near + camera.far) / (camera.near - camera.far)).unproject(camera);
                this.ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
                this.camera = camera;
            } else {
                throw new Error('Raycaster::setFromCameraAndScreenPosition() -> Unsupported camera type');
            }
        };

    }();

    intersectSplatMesh = function() {

        const toLocal = new THREE.Matrix4();
        const fromLocal = new THREE.Matrix4();
        const sceneTransform = new THREE.Matrix4();
        const localRay = new Ray();
        const tempPoint = new THREE.Vector3();

        return function(splatMesh, outHits = []) {
            const splatTree = splatMesh.getSplatTree();

            if (!splatTree) return;

            for (let s = 0; s < splatTree.subTrees.length; s++) {
                const subTree = splatTree.subTrees[s];

                fromLocal.copy(splatMesh.matrixWorld);
                if (splatMesh.dynamicMode) {
                    splatMesh.getSceneTransform(s, sceneTransform);
                    fromLocal.multiply(sceneTransform);
                }
                toLocal.copy(fromLocal).invert();

                localRay.origin.copy(this.ray.origin).applyMatrix4(toLocal);
                localRay.direction.copy(this.ray.origin).add(this.ray.direction);
                localRay.direction.applyMatrix4(toLocal).sub(localRay.origin).normalize();

                const outHitsForSubTree = [];
                if (subTree.rootNode) {
                    this.castRayAtSplatTreeNode(localRay, splatTree, subTree.rootNode, outHitsForSubTree);
                }

                outHitsForSubTree.forEach((hit) => {
                    hit.origin.applyMatrix4(fromLocal);
                    hit.normal.applyMatrix4(fromLocal).normalize();
                    hit.distance = tempPoint.copy(hit.origin).sub(this.ray.origin).length();
                });

                outHits.push(...outHitsForSubTree);
            }

            outHits.sort((a, b) => {
                if (a.distance > b.distance) return 1;
                else return -1;
            });

            return outHits;
        };

    }();

    castRayAtSplatTreeNode = function() {

        const tempColor = new THREE.Vector4();
        const tempCenter = new THREE.Vector3();
        const tempScale = new THREE.Vector3();
        const tempRotation = new THREE.Quaternion();
        const tempHit = new Hit();
        const scaleEpsilon = 0.0000001;

        const origin = new THREE.Vector3(0, 0, 0);
        const uniformScaleMatrix = new THREE.Matrix4();
        const scaleMatrix = new THREE.Matrix4();
        const rotationMatrix = new THREE.Matrix4();
        const toSphereSpace = new THREE.Matrix4();
        const fromSphereSpace = new THREE.Matrix4();
        const tempRay = new Ray();

        return function(ray, splatTree, node, outHits = []) {
            if (!ray.intersectBox(node.boundingBox)) {
                return;
            }
            if (node.data && node.data.indexes && node.data.indexes.length > 0) {
                for (let i = 0; i < node.data.indexes.length; i++) {

                    const splatGlobalIndex = node.data.indexes[i];
                    const splatSceneIndex = splatTree.splatMesh.getSceneIndexForSplat(splatGlobalIndex);
                    const splatScene = splatTree.splatMesh.getScene(splatSceneIndex);
                    if (!splatScene.visible) continue;

                    splatTree.splatMesh.getSplatColor(splatGlobalIndex, tempColor);
                    splatTree.splatMesh.getSplatCenter(splatGlobalIndex, tempCenter);
                    splatTree.splatMesh.getSplatScaleAndRotation(splatGlobalIndex, tempScale, tempRotation);

                    if (tempScale.x <= scaleEpsilon || tempScale.y <= scaleEpsilon ||
                        splatTree.splatMesh.splatRenderMode === SplatRenderMode.ThreeD && tempScale.z <= scaleEpsilon) {
                        continue;
                    }

                    if (!this.raycastAgainstTrueSplatEllipsoid) {
                        let radius = (tempScale.x + tempScale.y);
                        let componentCount = 2;
                        if (splatTree.splatMesh.splatRenderMode === SplatRenderMode.ThreeD) {
                            radius += tempScale.z;
                            componentCount = 3;
                        }
                        radius = radius / componentCount;
                        if (ray.intersectSphere(tempCenter, radius, tempHit)) {
                            const hitClone = tempHit.clone();
                            hitClone.splatIndex = splatGlobalIndex;
                            outHits.push(hitClone);
                        }
                    } else {
                        scaleMatrix.makeScale(tempScale.x, tempScale.y, tempScale.z);
                        rotationMatrix.makeRotationFromQuaternion(tempRotation);
                        const uniformScale = Math.log10(tempColor.w) * 2.0;
                        uniformScaleMatrix.makeScale(uniformScale, uniformScale, uniformScale);
                        fromSphereSpace.copy(uniformScaleMatrix).multiply(rotationMatrix).multiply(scaleMatrix);
                        toSphereSpace.copy(fromSphereSpace).invert();
                        tempRay.origin.copy(ray.origin).sub(tempCenter).applyMatrix4(toSphereSpace);
                        tempRay.direction.copy(ray.origin).add(ray.direction).sub(tempCenter);
                        tempRay.direction.applyMatrix4(toSphereSpace).sub(tempRay.origin).normalize();
                        if (tempRay.intersectSphere(origin, 1.0, tempHit)) {
                            const hitClone = tempHit.clone();
                            hitClone.splatIndex = splatGlobalIndex;
                            hitClone.origin.applyMatrix4(fromSphereSpace).add(tempCenter);
                            outHits.push(hitClone);
                        }
                    }
                }
             }
            if (node.children && node.children.length > 0) {
                for (let child of node.children) {
                    this.castRayAtSplatTreeNode(ray, splatTree, child, outHits);
                }
            }
            return outHits;
        };

    }();
}
