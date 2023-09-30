import * as THREE from 'three';
import { OctreeNode } from './OctreeNode.js';
import { SplatBuffer } from '../SplatBuffer.js';

export class Octree {

    constructor(maxDepth, maxPositionsPerNode) {
        this.maxDepth = maxDepth;
        this.maxPositionsPerNode = maxPositionsPerNode;
        this.sceneDimensions = new THREE.Vector3();
        this.sceneMin = new THREE.Vector3();
        this.sceneMax = new THREE.Vector3();
        this.rootNode = null;
    }

    processScene(splatBuffer) {
        const vertexCount = splatBuffer.getVertexCount();

        const position = new THREE.Vector3();
        for (let i = 0; i < vertexCount; i++) {
            splatBuffer.getPosition(i, position);
            if (i === 0 || position.x < this.sceneMin.x) this.sceneMin.x = position.x;
            if (i === 0 || position.x > this.sceneMax.x) this.sceneMax.x = position.x;
            if (i === 0 || position.y < this.sceneMin.y) this.sceneMin.y = position.y;
            if (i === 0 || position.y > this.sceneMax.y) this.sceneMax.y = position.y;
            if (i === 0 || position.z < this.sceneMin.z) this.sceneMin.z = position.z;
            if (i === 0 || position.z > this.sceneMax.z) this.sceneMax.z = position.z;
        }

        this.sceneDimensions.copy(this.sceneMin).sub(this.sceneMin);

        this.rootNode = new OctreeNode(this.sceneMin, this.sceneMax, 0);
        this.rootNode.data = {
            'splatBuffer': splatBuffer
        }
        this.processNode(this.rootNode);
    }

    processNode(node) {
        const splatBuffer = node.data.splatBuffer;
        const vertexCount = splatBuffer.getVertexCount();

        if (vertexCount < this.maxPositionsPerNode) return;

        if (node.depth > this.maxDepth) return;

        const nodeDimensions = new THREE.Vector3().copy(node.max).sub(node.min);
        const halfDimensions = new THREE.Vector3().copy(nodeDimensions).multiplyScalar(0.5);

        const nodeCenter = new THREE.Vector3().copy(node.min).add(halfDimensions)

        const childrenBounds = [
            // top section, clockwise from upper-left (looking from above, +Y)
            new THREE.Box3(new THREE.Vector3(nodeCenter.x - halfDimensions.x, nodeCenter.y, nodeCenter.z - halfDimensions.z),
                           new THREE.Vector3(nodeCenter.x, nodeCenter.y + halfDimensions.y, nodeCenter.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x, nodeCenter.y, nodeCenter.z - halfDimensions.z),
                           new THREE.Vector3(nodeCenter.x + halfDimensions.x, nodeCenter.y + halfDimensions.y, nodeCenter.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x, nodeCenter.y, nodeCenter.z),
                           new THREE.Vector3(nodeCenter.x + halfDimensions.x, nodeCenter.y + halfDimensions.y, nodeCenter.z + halfDimensions.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x - halfDimensions.x, nodeCenter.y, nodeCenter.z ),
                           new THREE.Vector3(nodeCenter.x, nodeCenter.y + halfDimensions.y, nodeCenter.z + halfDimensions.z)),
            // bottom section, clockwise from lower-left (looking from above, +Y)
            new THREE.Box3(new THREE.Vector3(nodeCenter.x - halfDimensions.x, nodeCenter.y - halfDimensions.y, nodeCenter.z - halfDimensions.z),
                           new THREE.Vector3(nodeCenter.x, nodeCenter.y, nodeCenter.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x, nodeCenter.y - halfDimensions.y, nodeCenter.z - halfDimensions.z),
                           new THREE.Vector3(nodeCenter.x + halfDimensions.x, nodeCenter.y, nodeCenter.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x, nodeCenter.y - halfDimensions.y, nodeCenter.z),
                           new THREE.Vector3(nodeCenter.x + halfDimensions.x, nodeCenter.y, nodeCenter.z + halfDimensions.z)),
            new THREE.Box3(new THREE.Vector3(nodeCenter.x - halfDimensions.x, nodeCenter.y - halfDimensions.y, nodeCenter.z),
                           new THREE.Vector3(nodeCenter.x, nodeCenter.y, nodeCenter.z + halfDimensions.z)),
        ];

        const vertexCounts = [];
        const indexes = [];
        for (let i = 0; i < childrenBounds.length; i++) {
            vertexCounts[i] = 0;
            indexes[i] = [];
        }

        const position = new THREE.Vector3();
        for (let i = 0; i < vertexCount; i++) {
            splatBuffer.getPosition(i, position);
            for (let j = 0; j < childrenBounds.length; j++) {
                if (childrenBounds[j].containsPoint(position)) {
                    vertexCounts[j]++;
                    indexes[j].push(i);
                }
            }
        }

        for (let i = 0; i < childrenBounds.length; i++) {
            const vertexCount = vertexCounts[i];
            const childSplatBuffer = new SplatBuffer(vertexCount);
            const indexesForChild = indexes[i];
            for (let j = 0; j < indexesForChild.length; j++) {
                childSplatBuffer.copyVertexFromSplatBuffer(splatBuffer, indexesForChild[j], j);
            }
            const childNode = new OctreeNode(childrenBounds[i].min, childrenBounds[i].max, node.depth + 1);
            childNode.data = {
                'splatBuffer': childSplatBuffer
            };
            node.children.push(childNode);
        }

        node.data = {};
        for (let child of node.children) {
            this.processNode(child);
        }
    }


    countLeaves() {

        const countLeavesFromNode = (node) => {
            if (node.children.length === 0) return 1;
            let count = 0;
            for (let child of node.children) {
                count += countLeavesFromNode(child);
            }
            return count;
        };

        return countLeavesFromNode(this.rootNode);
    }

    countLeavesWithVertices() {

        const countLeavesWithVerticesFromNode = (node) => {
            if (node.children.length === 0) {
                if (node.data.splatBuffer && node.data.splatBuffer.getVertexCount() > 0) return 1;
                else return 0;
            }
            let count = 0;
            for (let child of node.children) {
                count += countLeavesWithVerticesFromNode(child);
            }
            return count;
        };

        return countLeavesWithVerticesFromNode(this.rootNode);
    }

    visitLeaves(visitFunc) {

        const visitLeavesFromNode = (node, visitFunc) => {
            if (node.children.length === 0) visitFunc(node);
            let count = 0;
            for (let child of node.children) {
                count += visitLeavesFromNode(child, visitFunc);
            }
        };

        return visitLeavesFromNode(this.rootNode, visitFunc);
    }
}
