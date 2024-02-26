
import * as THREE from 'three';

const normalize = (x, min, max) => {
  return (max - min < 0.00001) ? 0 : (x - min) / (max - min);
};
const calcMinMax = (data, indices) => {
  let min;
  let max;
  if (indices) {
    min = max = data[indices[0]];
    for (let i = 1; i < indices.length; ++i) {
      const v = data[indices[i]];
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  } else {
    min = max = data[0];
    for (let i = 1; i < data.length; ++i) {
      const v = data[i];
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  return { min, max };
};

export class Chunk {
  static members = [
    'x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'rot_0', 'rot_1', 'rot_2', 'rot_3'
  ];
  size;
  data = {};
  // compressed data
  position;
  rotation;
  scale;
  color;

  constructor(elements, size = 256) {
    this.size = size;
    Chunk.members.forEach((m) => {
      this.data[m] = new Float32Array(size);
    });
    this.position = new Uint32Array(size);
    this.rotation = new Uint32Array(size);
    this.scale = new Uint32Array(size);
    this.color = new Uint32Array(size);
    this.vertexElement = elements;
  }

  set(splatData, indices) {
    Chunk.members.forEach(name => {
      const prop = splatData[name];
      indices.forEach((idx, i) => {
        this.data[name][i] = prop[idx];
      });
    });
  }

  transform(mat) {
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(mat));
    const scale = new THREE.Vector3().setFromMatrixScale(new THREE.Matrix4().fromArray(mat));
    const position = new THREE.Vector3();
    const q = new THREE.Quaternion();

    Object.keys(this.data).forEach(key => {
      for (let i = 0; i < this.size; ++i) {
        if (['x', 'y', 'z'].includes(key)) {
          position.set(this.data.x[i], this.data.y[i], this.data.z[i]);
          position.applyMatrix4(new THREE.Matrix4().fromArray(mat));
          this.data.x[i] = position.x;
          this.data.y[i] = position.y;
          this.data.z[i] = position.z;
        } else if (['rot_0', 'rot_1', 'rot_2', 'rot_3'].includes(key)) {
          q.set(this.data.rot_1[i], this.data.rot_2[i], this.data.rot_3[i], this.data.rot_0[i]);
          q.multiply(quat);
          this.data.rot_0[i] = q.w;
          this.data.rot_1[i] = q.x;
          this.data.rot_2[i] = q.y;
          this.data.rot_3[i] = q.z;
        } else if (['scale_0', 'scale_1', 'scale_2'].includes(key)) {
          this.data.scale_0[i] *= scale.x;
          this.data.scale_1[i] *= scale.y;
          this.data.scale_2[i] *= scale.z;
        }
      }
    });
  }

  pack() {
    const data = this.data;

    const x = data.x;
    const y = data.y;
    const z = data.z;
    const scale_0 = data.scale_0;
    const scale_1 = data.scale_1;
    const scale_2 = data.scale_2;
    const rot_0 = data.rot_0;
    const rot_1 = data.rot_1;
    const rot_2 = data.rot_2;
    const rot_3 = data.rot_3;
    const f_dc_0 = data.f_dc_0;
    const f_dc_1 = data.f_dc_1;
    const f_dc_2 = data.f_dc_2;
    const opacity = data.opacity;

    const px = calcMinMax(x);
    const py = calcMinMax(y);
    const pz = calcMinMax(z);

    const sx = calcMinMax(scale_0);
    const sy = calcMinMax(scale_1);
    const sz = calcMinMax(scale_2);

    const packUnorm = (value, bits) => {
      const t = (1 << bits) - 1;
      return Math.max(0, Math.min(t, Math.floor(value * t + 0.5)));
    };

    const pack111011 = (x, y, z) => {
      return packUnorm(x, 11) << 21 |
        packUnorm(y, 10) << 11 |
        packUnorm(z, 11);
    };

    const pack8888 = (x, y, z, w) => {
      return packUnorm(x, 8) << 24 |
        packUnorm(y, 8) << 16 |
        packUnorm(z, 8) << 8 |
        packUnorm(w, 8);
    };

    // pack quaternion into 2,10,10,10
    const packRot = (x, y, z, w) => {
      // Create a new Quaternion object with Three.js
      let q = new THREE.Quaternion(x, y, z, w);

      // Normalize the quaternion using Three.js method
      q.normalize();
      const a = [q.x, q.y, q.z, q.w];
      const largest = a.reduce((curr, v, i) => Math.abs(v) > Math.abs(a[curr]) ? i : curr, 0);

      if (a[largest] < 0) {
        a[0] = -a[0];
        a[1] = -a[1];
        a[2] = -a[2];
        a[3] = -a[3];
      }

      const norm = Math.sqrt(2) * 0.5;
      let result = largest;
      for (let i = 0; i < 4; ++i) {
        if (i !== largest) {
          result = (result << 10) | packUnorm(a[i] * norm + 0.5, 10);
        }
      }

      return result;
    };

    const packColor = (r, g, b, a) => {
      const SH_C0 = 0.28209479177387814;
      return pack8888(
        r * SH_C0 + 0.5,
        g * SH_C0 + 0.5,
        b * SH_C0 + 0.5,
        1 / (1 + Math.exp(-a))
      );
    };

    // pack
    for (let i = 0; i < this.size; ++i) {
      this.position[i] = pack111011(
        normalize(x[i], px.min, px.max),
        normalize(y[i], py.min, py.max),
        normalize(z[i], pz.min, pz.max)
      );

      this.rotation[i] = packRot(rot_0[i], rot_1[i], rot_2[i], rot_3[i]);

      this.scale[i] = pack111011(
        normalize(scale_0[i], sx.min, sx.max),
        normalize(scale_1[i], sy.min, sy.max),
        normalize(scale_2[i], sz.min, sz.max)
      );

      this.color[i] = packColor(f_dc_0[i], f_dc_1[i], f_dc_2[i], opacity[i]);
    }

    return { px, py, pz, sx, sy, sz };
  }
}
