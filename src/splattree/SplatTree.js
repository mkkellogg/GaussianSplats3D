import * as THREE from 'three';
import { SplatTreeNode } from './SplatTreeNode.js';

export class SplatTree {

    constructor(maxDepth, maxCentersPerNode) {
        this.maxDepth = maxDepth;
        this.maxCentersPerNode = maxCentersPerNode;
        this.splatMesh = [];
        this.sceneDimensions = new THREE.Vector3();
        this.sceneMin = new THREE.Vector3();
        this.sceneMax = new THREE.Vector3();
        this.rootNode = null;
        this.addedIndexes = {};
        this.nodesWithIndexes = [];
        this.globalIndexToLocalIndexMap = {};
        this.globalIndexToSplatBufferMap = {};
    }

    getSplatBufferForSplat(globalIndex) {
        return this.splatMesh.splatBuffers[this.globalIndexToSplatBufferMap[globalIndex]];
    }

    getTransformForSplat(globalIndex) {
        return this.splatMesh.splatTransforms[this.globalIndexToSplatBufferMap[globalIndex]];
    }

    getSplatLocalIndex(globalIndex) {
        return this.globalIndexToLocalIndexMap[globalIndex];
    }

    processSplatMesh(splatMesh, filterFunc = () => true) {
        this.splatMesh = splatMesh;

        this.sceneMin = new THREE.Vector3();
        this.sceneMax = new THREE.Vector3();
        this.addedIndexes = {};
        this.nodesWithIndexes = [];
        this.globalIndexToLocalIndexMap = {};
        this.globalIndexToSplatBufferMap = {};

        let totalSplatCount = 0;
        for (let s = 0; s < this.splatMesh.splatBuffers.length; s++) {
            const splatBuffer = this.splatMesh.splatBuffers[s];
            const splatCount = splatBuffer.getSplatCount();
            const center = new THREE.Vector3();
            const transform = this.splatMesh.splatTransforms[s];
            for (let i = 0; i < splatCount; i++) {
                if (filterFunc(splatBuffer, i)) {
                    splatBuffer.getCenter(i, center, transform);
                    if (i === 0 || center.x < this.sceneMin.x) this.sceneMin.x = center.x;
                    if (i === 0 || center.x > this.sceneMax.x) this.sceneMax.x = center.x;
                    if (i === 0 || center.y < this.sceneMin.y) this.sceneMin.y = center.y;
                    if (i === 0 || center.y > this.sceneMax.y) this.sceneMax.y = center.y;
                    if (i === 0 || center.z < this.sceneMin.z) this.sceneMin.z = center.z;
                    if (i === 0 || center.z > this.sceneMax.z) this.sceneMax.z = center.z;
                }
                this.globalIndexToLocalIndexMap[totalSplatCount] = i;
                this.globalIndexToSplatBufferMap[totalSplatCount] = s;
                totalSplatCount++;
            }
        }

        this.sceneDimensions.copy(this.sceneMin).sub(this.sceneMin);

        const indexes = [];
        for (let i = 0; i < totalSplatCount; i ++) {
            const splatLocalIndex = this.globalIndexToLocalIndexMap[i];
            const splatBuffer = this.splatMesh.splatBuffers[this.globalIndexToSplatBufferMap[i]];
            if (filterFunc(splatBuffer, splatLocalIndex)) {
                indexes.push(i);
            }
        }
        this.rootNode = new SplatTreeNode(this.sceneMin, this.sceneMax, 0);
        this.rootNode.data = {
            'indexes': indexes
        };
        this.processNode(this.rootNode, splatMesh);
    }

    processNode(node, splatMesh) {
        const splatCount = node.data.indexes.length;

        if (splatCount < this.maxCentersPerNode || node.depth > this.maxDepth) {
            const newIndexes = [];
            for (let i = 0; i < node.data.indexes.length; i++) {
                if (!this.addedIndexes[node.data.indexes[i]]) {
                    newIndexes.push(node.data.indexes[i]);
                    this.addedIndexes[node.data.indexes[i]] = true;
                }
            }
            node.data.indexes = newIndexes;
            this.nodesWithIndexes.push(node);
            return;
        }

        const nodeDimensions = new THREE.Vector3().copy(node.max).sub(node.min);
        const halfDimensions = new THREE.Vector3().copy(nodeDimensions).multiplyScalar(0.5);

        const nodeCenter = new THREE.Vector3().copy(node.min).add(halfDimensions);

        const childrenBounds = [
            // top section, clockwise from upper-left (looking from above, +Y)
            new THREE.Box3(new THREE.Vector3(nodeCenter.x - halfDimensions.x, nodeCenter.y, nodeCenter.z - halfDimensions.z),
                           new THREE.Vector3(nodeCenter.x, nodeCenter.y + halfDimensions.y, nodeCenter.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x, nodeCenter.y, nodeCenter.z - halfDimensions.z),
                           new THREE.Vector3(nodeCenter.x + halfDimensions.x, nodeCenter.y + halfDimensions.y, nodeCenter.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x, nodeCenter.y, nodeCenter.z),
                           new THREE.Vector3(nodeCenter.x + halfDimensions.x,
                                             nodeCenter.y + halfDimensions.y, nodeCenter.z + halfDimensions.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x - halfDimensions.x, nodeCenter.y, nodeCenter.z ),
                           new THREE.Vector3(nodeCenter.x, nodeCenter.y + halfDimensions.y, nodeCenter.z + halfDimensions.z)),

            // bottom section, clockwise from lower-left (looking from above, +Y)
            new THREE.Box3(new THREE.Vector3(nodeCenter.x - halfDimensions.x,
                                             nodeCenter.y - halfDimensions.y, nodeCenter.z - halfDimensions.z),
                           new THREE.Vector3(nodeCenter.x, nodeCenter.y, nodeCenter.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x, nodeCenter.y - halfDimensions.y, nodeCenter.z - halfDimensions.z),
                           new THREE.Vector3(nodeCenter.x + halfDimensions.x, nodeCenter.y, nodeCenter.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x, nodeCenter.y - halfDimensions.y, nodeCenter.z),
                           new THREE.Vector3(nodeCenter.x + halfDimensions.x, nodeCenter.y, nodeCenter.z + halfDimensions.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x - halfDimensions.x, nodeCenter.y - halfDimensions.y, nodeCenter.z),
                           new THREE.Vector3(nodeCenter.x, nodeCenter.y, nodeCenter.z + halfDimensions.z)),
        ];

        const splatCounts = [];
        const baseIndexes = [];
        for (let i = 0; i < childrenBounds.length; i++) {
            splatCounts[i] = 0;
            baseIndexes[i] = [];
        }

        const center = new THREE.Vector3();
        for (let i = 0; i < splatCount; i++) {
            const splatGlobalIndex = node.data.indexes[i];
            const splatLocalIndex = this.globalIndexToLocalIndexMap[splatGlobalIndex];
            const splatBuffer = this.getSplatBufferForSplat(splatGlobalIndex);
            const transform = this.getTransformForSplat(splatGlobalIndex);
            splatBuffer.getCenter(splatLocalIndex, center, transform);
            for (let j = 0; j < childrenBounds.length; j++) {
                if (childrenBounds[j].containsPoint(center)) {
                    splatCounts[j]++;
                    baseIndexes[j].push(splatGlobalIndex);
                }
            }
        }

        for (let i = 0; i < childrenBounds.length; i++) {
            const childNode = new SplatTreeNode(childrenBounds[i].min, childrenBounds[i].max, node.depth + 1);
            childNode.data = {
                'indexes': baseIndexes[i]
            };
            node.children.push(childNode);
        }

        node.data = {};
        for (let child of node.children) {
            this.processNode(child, splatMesh);
        }
    }


    countLeaves() {

        let leafCount = 0;
        this.visitLeaves(() => {
            leafCount++;
        });

        return leafCount;
    }

    visitLeaves(visitFunc) {

        const visitLeavesFromNode = (node, visitFunc) => {
            if (node.children.length === 0) visitFunc(node);
            for (let child of node.children) {
                visitLeavesFromNode(child, visitFunc);
            }
        };

        return visitLeavesFromNode(this.rootNode, visitFunc);
    }

}
