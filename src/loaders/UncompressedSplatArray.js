import { getSphericalHarmonicsComponentCountForDegree } from '../Util.js';

const BASE_COMPONENT_COUNT = 14;

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
        OPACITY: 13,
        FRC0: 14,
        FRC1: 15,
        FRC2: 16,
        FRC3: 17,
        FRC4: 18,
        FRC5: 19,
        FRC6: 20,
        FRC7: 21,
        FRC8: 22,
        FRC9: 23,
        FRC10: 24,
        FRC11: 25,
        FRC12: 26,
        FRC13: 27,
        FRC14: 28,
        FRC15: 29,
        FRC16: 30,
        FRC17: 31,
        FRC18: 32,
        FRC19: 33,
        FRC20: 34,
        FRC21: 35,
        FRC22: 36,
        FRC23: 37
    };

    constructor(sphericalHarmonicsDegree = 0) {
        this.sphericalHarmonicsDegree = sphericalHarmonicsDegree;
        this.sphericalHarmonicsCount = getSphericalHarmonicsComponentCountForDegree(this.sphericalHarmonicsDegree);
        this.componentCount = this.sphericalHarmonicsCount + BASE_COMPONENT_COUNT;
        this.defaultSphericalHarmonics = new Array(this.sphericalHarmonicsCount).fill(0);
        this.splats = [];
        this.splatCount = 0;
    }

    static createSplat(sphericalHarmonicsDegree = 0) {
        const baseSplat = [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
        let shEntries = getSphericalHarmonicsComponentCountForDegree(sphericalHarmonicsDegree);
        for (let i = 0; i < shEntries; i++) baseSplat.push(0);
        return baseSplat;
    }

    addSplat(splat) {
        this.splats.push(splat);
        this.splatCount++;
    }

    getSplat(index) {
        return this.splats[index];
    }

    addDefaultSplat() {
        const newSplat = UncompressedSplatArray.createSplat(this.sphericalHarmonicsDegree);
        this.addSplat(newSplat);
        return newSplat;
    }

    addSplatFromComonents(x, y, z, scale0, scale1, scale2, rot0, rot1, rot2, rot3, r, g, b, opacity, ...rest) {
        const newSplat = [x, y, z, scale0, scale1, scale2, rot0, rot1, rot2, rot3, r, g, b, opacity, ...this.defaultSphericalHarmonics];
        for (let i = 0; i < rest.length && i < this.sphericalHarmonicsCount; i++) {
            newSplat[i] = rest[i];
        }
        this.addSplat(newSplat);
        return newSplat;
    }

    addSplatFromArray(src, srcIndex) {
        const srcSplat = src.splats[srcIndex];
        const newSplat = UncompressedSplatArray.createSplat(this.sphericalHarmonicsDegree);
        for (let i = 0; i < this.componentCount && i < srcSplat.length; i++) {
            newSplat[i] = srcSplat[i];
        }
        this.addSplat(newSplat);
    }
}
