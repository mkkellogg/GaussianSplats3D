
export class UncompressedSplatArray {

    constructor() {
        this.splatCount = 0;
        this.scale_0 = [];
        this.scale_1 = [];
        this.scale_2 = [];
        this.rot_0 = [];
        this.rot_1 = [];
        this.rot_2 = [];
        this.rot_3 = [];
        this.x = [];
        this.y = [];
        this.z = [];
        this.f_dc_0 = [];
        this.f_dc_1 = [];
        this.f_dc_2 = [];
        this.opacity = [];
    }

    addSplat(x, y, z, scale0, scale1, scale2, rot0, rot1, rot2, rot3, r, g, b, opacity) {
        this.x.push(x);
        this.y.push(y);
        this.z.push(z);
        this.scale_0.push(scale0);
        this.scale_1.push(scale1);
        this.scale_2.push(scale2);
        this.rot_0.push(rot0);
        this.rot_1.push(rot1);
        this.rot_2.push(rot2);
        this.rot_3.push(rot3);
        this.f_dc_0.push(r);
        this.f_dc_1.push(g);
        this.f_dc_2.push(b);
        this.opacity.push(opacity);
        this.splatCount++;
    }

    addSplatFromArray(src, srcIndex) {
        this.x.push(src.x[srcIndex]);
        this.y.push(src.y[srcIndex]);
        this.z.push(src.z[srcIndex]);
        this.scale_0.push(src.scale_0[srcIndex]);
        this.scale_1.push(src.scale_1[srcIndex]);
        this.scale_2.push(src.scale_2[srcIndex]);
        this.rot_0.push(src.rot_0[srcIndex]);
        this.rot_1.push(src.rot_1[srcIndex]);
        this.rot_2.push(src.rot_2[srcIndex]);
        this.rot_3.push(src.rot_3[srcIndex]);
        this.f_dc_0.push(src.f_dc_0[srcIndex]);
        this.f_dc_1.push(src.f_dc_1[srcIndex]);
        this.f_dc_2.push(src.f_dc_2[srcIndex]);
        this.opacity.push(src.opacity[srcIndex]);
        this.splatCount++;
    }

    copySplat(src, srcIndex, dest, destIndex) {
        dest.scale_0[destIndex] = src.scale_0[srcIndex];
        dest.scale_1[destIndex] = src.scale_1[srcIndex];
        dest.scale_2[destIndex] = src.scale_2[srcIndex];
        dest.rot_0[destIndex] = src.rot_0[srcIndex];
        dest.rot_1[destIndex] = src.rot_1[srcIndex];
        dest.rot_2[destIndex] = src.rot_2[srcIndex];
        dest.rot_3[destIndex] = src.rot_3[srcIndex];
        dest.x[destIndex] = src.x[srcIndex];
        dest.y[destIndex] = src.y[srcIndex];
        dest.z[destIndex] = src.z[srcIndex];
        dest.f_dc_0[destIndex] = src.f_dc_0[srcIndex];
        dest.f_dc_1[destIndex] = src.f_dc_1[srcIndex];
        dest.f_dc_2[destIndex] = src.f_dc_2[srcIndex];
        dest.opacity[destIndex] = src.opacity[srcIndex];
    }
}
