
export class UncompressedSplatArray {

    constructor() {
        this.splats = [];
        this.splatCount = 0;
    }

    addSplat(splat) {
        this.splats.push(splat);
        this.splatCount++;
    }

    addDefaultSplat() {
        const newSplat = {
            'x': 0,
            'y': 0,
            'z': 0,
            'scale_0': 1,
            'scale_1': 1,
            'scale_2': 1,
            'rot_0': 1,
            'rot_1': 0,
            'rot_2': 0,
            'rot_3': 0,
            'f_dc_0': 0,
            'f_dc_1': 0,
            'f_dc_2': 0,
            'opacity': 0
        };
        this.addSplat(newSplat);
        return newSplat;
    }

    addSplatFromComonents(x, y, z, scale0, scale1, scale2, rot0, rot1, rot2, rot3, r, g, b, opacity) {
        const newSplat = {
            'x': x,
            'y': y,
            'z': z,
            'scale_0': scale0,
            'scale_1': scale1,
            'scale_2': scale2,
            'rot_0': rot0,
            'rot_1': rot1,
            'rot_2': rot2,
            'rot_3': rot3,
            'f_dc_0': r,
            'f_dc_1': g,
            'f_dc_2': b,
            'opacity': opacity
        };
        this.addSplat(newSplat);
        return newSplat;
    }

    addSplatFromArray(src, srcIndex) {
        const srcSplat = src.splats[srcIndex];
        this.addSplatFromComonents(srcSplat.x, srcSplat.y, srcSplat.z, srcSplat.scale_0, srcSplat.scale_1, srcSplat.scale_2,
                                   srcSplat.rot_0, srcSplat.rot_1, srcSplat.rot_2, srcSplat.rot_3,
                                   srcSplat.f_dc_0, srcSplat.f_dc_1, srcSplat.f_dc_2, srcSplat.opacity);
    }
}
