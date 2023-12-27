import * as THREE from 'three';
import { SplatTreeNode } from './SplatTreeNode.js';

class SplatSubTree {

    constructor(maxDepth, maxCentersPerNode) {
        this.maxDepth = maxDepth;
        this.maxCentersPerNode = maxCentersPerNode;
        this.sceneDimensions = new THREE.Vector3();
        this.sceneMin = new THREE.Vector3();
        this.sceneMax = new THREE.Vector3();
        this.splatMesh = null;
        this.rootNode = null;
        this.addedIndexes = {};
        this.nodesWithIndexes = [];
    }

}

/**
 * SplatTree: Octree tailored to splat data from a SplatMesh instance
 */
export class SplatTree {

    constructor(maxDepth, maxCentersPerNode) {
        this.maxDepth = maxDepth;
        this.maxCentersPerNode = maxCentersPerNode;
        this.splatMesh = null;
        this.subTrees = [];
    }

    processSplatMesh(splatMesh, filterFunc = () => true) {
        this.splatMesh = splatMesh;
        this.subTrees = [];
        const center = new THREE.Vector3();

        const buildSubTree = function(splatOffset, splatCount, maxDepth, maxCentersPerNode) {
            const subTree = new SplatSubTree(maxDepth, maxCentersPerNode);
            let validSplatCount = 0;
            const indexes = [];
            for (let i = 0; i < splatCount; i++) {
                const globalSplatIndex = i + splatOffset;
                if (filterFunc(globalSplatIndex)) {
                    splatMesh.getSplatCenter(globalSplatIndex, center);
                    if (validSplatCount === 0 || center.x < subTree.sceneMin.x) subTree.sceneMin.x = center.x;
                    if (validSplatCount === 0 || center.x > subTree.sceneMax.x) subTree.sceneMax.x = center.x;
                    if (validSplatCount === 0 || center.y < subTree.sceneMin.y) subTree.sceneMin.y = center.y;
                    if (validSplatCount === 0 || center.y > subTree.sceneMax.y) subTree.sceneMax.y = center.y;
                    if (validSplatCount === 0 || center.z < subTree.sceneMin.z) subTree.sceneMin.z = center.z;
                    if (validSplatCount === 0 || center.z > subTree.sceneMax.z) subTree.sceneMax.z = center.z;
                    validSplatCount++;
                    indexes.push(globalSplatIndex);
                }
            }

            subTree.sceneDimensions.copy(subTree.sceneMax).sub(subTree.sceneMin);

            subTree.rootNode = new SplatTreeNode(subTree.sceneMin, subTree.sceneMax, 0);
            subTree.rootNode.data = {
                'indexes': indexes
            };

            return subTree;
        };

        if (splatMesh.dynamicMode) {
            let splatOffset = 0;
            for (let s = 0; s < splatMesh.scenes.length; s++) {
                const scene = splatMesh.getScene(s);
                const splatCount = scene.splatBuffer.getSplatCount();
                const subTree = buildSubTree(splatOffset, splatCount, this.maxDepth, this.maxCentersPerNode);
                this.subTrees[s] = subTree;
                SplatTree.processNode(subTree, subTree.rootNode, splatMesh);
                splatOffset += splatCount;
            }
        } else {
            const subTree = buildSubTree(0, splatMesh.getSplatCount(), this.maxDepth, this.maxCentersPerNode);
            this.subTrees[0] = subTree;
            SplatTree.processNode(subTree, subTree.rootNode, splatMesh);
        }
    }

    static processNode(tree, node, splatMesh) {
        const splatCount = node.data.indexes.length;

        if (splatCount < tree.maxCentersPerNode || node.depth > tree.maxDepth) {
            const newIndexes = [];
            for (let i = 0; i < node.data.indexes.length; i++) {
                if (!tree.addedIndexes[node.data.indexes[i]]) {
                    newIndexes.push(node.data.indexes[i]);
                    tree.addedIndexes[node.data.indexes[i]] = true;
                }
            }
            node.data.indexes = newIndexes;
            tree.nodesWithIndexes.push(node);
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
            splatMesh.getSplatCenter(splatGlobalIndex, center);
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
            SplatTree.processNode(tree, child, splatMesh);
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

        for (let subTree of this.subTrees) {
            visitLeavesFromNode(subTree.rootNode, visitFunc);
        }
    }

}
