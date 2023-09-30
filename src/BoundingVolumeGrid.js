import * as THREE from 'three';
import { Chunk } from './Chunk.js';

export class BoundingVolumeGrid {

    constructor(chunkSize = 3) {
        this.chunkSize = chunkSize;
        this.chunks = [];
        this.sceneDimensions = new THREE.Vector3();
        this.chunkDimensions = new THREE.Vector3(this.chunkSize , this.chunkSize, this.chunkSize );
        this.chunkCounts = new THREE.Vector3();
        this.min = new THREE.Vector3();
        this.max = new THREE.Vector3();
    }

    getChunkIndex(chunkX, chunkY, chunkZ) {
        return chunkX * (this.chunkCounts.y * this.chunkCounts.z) + chunkY * this.chunkCounts.z + chunkZ;
    }

    getContainingChunkIndex(position) {
        const px = position.x - this.min.x;
        const py = position.y - this.min.y;
        const pz = position.z - this.min.z;
        const chunkX = Math.max(Math.floor(px / this.chunkDimensions.x), 0);
        const chunkY = Math.max(Math.floor(py / this.chunkDimensions.y), 0);
        const chunkZ = Math.max(Math.floor(pz / this.chunkDimensions.z), 0);
        return this.getChunkIndex(chunkX, chunkY, chunkZ);
    }

    getContainingChunk(position) {
        return this.chunks[this.getContainingChunkIndex(position)];
    }

    processScene(splatBuffer) {
        const vertexCount = splatBuffer.getVertexCount();

        const position = new THREE.Vector3();
        for (let i = 0; i < vertexCount; i++) {
            splatBuffer.getPosition(i, position);
            if (i === 0 || position.x < this.min.x) this.min.x = position.x;
            if (i === 0 || position.x > this.max.x) this.max.x = position.x;
            if (i === 0 || position.y < this.min.y) this.min.y = position.y;
            if (i === 0 || position.y > this.max.y) this.max.y = position.y;
            if (i === 0 || position.z < this.min.z) this.min.z = position.z;
            if (i === 0 || position.z > this.max.z) this.max.z = position.z;
        }

        this.sceneDimensions.copy(this.max).sub(this.min);
        this.chunkCounts.x = Math.ceil(this.sceneDimensions.x / this.chunkDimensions.x);
        this.chunkCounts.y = Math.ceil(this.sceneDimensions.y / this.chunkDimensions.y);
        this.chunkCounts.z = Math.ceil(this.sceneDimensions.z / this.chunkDimensions.z);

        const chunkMin = new THREE.Vector3();
        const chunkMax = new THREE.Vector3();
        for (let x = 0; x < this.chunkCounts.x; x++) {
            for (let y = 0; y < this.chunkCounts.y; y++) {
                for (let z = 0; z < this.chunkCounts.z; z++) {
                    chunkMin.set(x * this.chunkDimensions.x, y * this.chunkDimensions.y, z * this.chunkDimensions.z);
                    chunkMax.copy(chunkMin).add(this.chunkDimensions);
                    const chunkIndex = this.getChunkIndex(x, y, z);
                    this.chunks[chunkIndex] = new Chunk(chunkMin, chunkMax);
                }
            }
        }

        console.log("BVH -> Chunk count: " + this.chunks.length);
        const positionIndexes = [];
        for (let i = 0; i < this.chunks.length; i++) {
            positionIndexes[i] = [];
        }
        for (let i = 0; i < vertexCount; i++) {
            splatBuffer.getPosition(i, position);
            const chunkIndex = this.getContainingChunkIndex(position);
            positionIndexes[chunkIndex].push(i);
        }
    }
}

