
export class UncompressedSplatArray {

    static OFFSET = {
        X: 0,
        Y: 1,
        Z: 2,
        SCALE0: 3,
        SCALE1: 4,
        SCALE2: 5,
        ROTATION0: 6,
        ROTATION1: 7,
        ROTATION2: 8,
        ROTATION3: 9,
        FDC0: 10,
        FDC1: 11,
        FDC2: 12,
        OPACITY: 13
    };

    constructor() {
        this.splats = [];
        this.splatCount = 0;
    }

    static createSplat() {
        return [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
    }

    addSplat(splat) {
        this.splats.push(splat);
        this.splatCount++;
    }

    getSplat(index) {
        return this.splats[index];
    }

    addDefaultSplat() {
        const newSplat = UncompressedSplatArray.createSplat();
        this.addSplat(newSplat);
        return newSplat;
    }

    addSplatFromComonents(x, y, z, scale0, scale1, scale2, rot0, rot1, rot2, rot3, r, g, b, opacity) {
        const newSplat = [x, y, z, scale0, scale1, scale2, rot0, rot1, rot2, rot3, r, g, b, opacity];
        this.addSplat(newSplat);
        return newSplat;
    }

    addSplatFromArray(src, srcIndex) {
        const srcSplat = src.splats[srcIndex];
        this.addSplatFromComonents(srcSplat[0], srcSplat[1], srcSplat[2], srcSplat[3], srcSplat[4], srcSplat[5],
                                   srcSplat[6], srcSplat[7], srcSplat[8], srcSplat[9],
                                   srcSplat[10], srcSplat[11], srcSplat[12], srcSplat[13]);
    }
}
