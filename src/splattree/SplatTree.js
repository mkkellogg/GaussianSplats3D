import * as THREE from 'three';
import { SplatTreeNode } from './SplatTreeNode.js';

export class SplatTree {

    constructor(maxDepth, maxPositionsPerNode) {
        this.maxDepth = maxDepth;
        this.maxPositionsPerNode = maxPositionsPerNode;
        this.splatBuffer = null;
        this.sceneDimensions = new THREE.Vector3();
        this.sceneMin = new THREE.Vector3();
        this.sceneMax = new THREE.Vector3();
        this.rootNode = null;
        this.addedIndexes = {};
        this.nodesWithIndexes = [];
    }

    processSplatBuffer(splatBuffer, filterFunc = () => true) {
        this.splatBuffer = splatBuffer;
        this.addedIndexes = {};
        this.nodesWithIndexes = [];
        const splatCount = splatBuffer.getSplatCount();

        const position = new THREE.Vector3();
        for (let i = 0; i < splatCount; i++) {
            if (filterFunc(i)) {
                splatBuffer.getPosition(i, position);
                if (i === 0 || position.x < this.sceneMin.x) this.sceneMin.x = position.x;
                if (i === 0 || position.x > this.sceneMax.x) this.sceneMax.x = position.x;
                if (i === 0 || position.y < this.sceneMin.y) this.sceneMin.y = position.y;
                if (i === 0 || position.y > this.sceneMax.y) this.sceneMax.y = position.y;
                if (i === 0 || position.z < this.sceneMin.z) this.sceneMin.z = position.z;
                if (i === 0 || position.z > this.sceneMax.z) this.sceneMax.z = position.z;
            }
        }

        this.sceneDimensions.copy(this.sceneMin).sub(this.sceneMin);

        const indexes = [];
        for (let i = 0; i < splatCount; i ++) {
            if (filterFunc(i)) {
                indexes.push(i);
            }
        }
        this.rootNode = new SplatTreeNode(this.sceneMin, this.sceneMax, 0);
        this.rootNode.data = {
            'indexes': indexes
        };
        this.processNode(this.rootNode, splatBuffer);
    }

    processNode(node, splatBuffer) {
        const splatCount = node.data.indexes.length;

        if (splatCount < this.maxPositionsPerNode || node.depth > this.maxDepth) {
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

        const position = new THREE.Vector3();
        for (let i = 0; i < splatCount; i++) {
            const splatIndex = node.data.indexes[i];
            splatBuffer.getPosition(splatIndex, position);
            for (let j = 0; j < childrenBounds.length; j++) {
                if (childrenBounds[j].containsPoint(position)) {
                    splatCounts[j]++;
                    baseIndexes[j].push(splatIndex);
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
            this.processNode(child, splatBuffer);
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
