

export class SplatBuffer {

    // XYZ - Position (Float32)
    // XYZ - Scale (Float32)
    // RGBA - colors (uint8)
    // IJKL - quaternion/rot (uint8)
    static ROW_SIZE = 32;

    constructor(bufferData, rowSize = SplatBuffer.ROW_SIZE) {
        this.bufferData = bufferData;
        this.rowSize = rowSize;
    }

    getBufferData() {
        return this.bufferData;
    }

    getRowSize() {
        return this.rowSize;
    }

    getVertexCount() {
        return this.bufferData.byteLength / this.rowSize;
    }
}
