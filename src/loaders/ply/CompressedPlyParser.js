import { PlyCodecBase } from './PlyCodecBase.js';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';
import * as THREE from 'three';

export class CompressedPlyParser {

  static parseToUncompressedSplatArray(plyBuffer) {
    const { plyElements, vertexElement } = PlyCodecBase.readPly(plyBuffer);

    const chunks = plyElements.find((e) => e.name === 'chunk');
    const vertices = vertexElement;

    // allocate uncompressed data
    const splatArray = new UncompressedSplatArray();

    const getChunkProp = (name) => {
      return chunks.properties.find((p) => p.name === name && p.storage)
        ?.storage;
    };

    const minX = getChunkProp('min_x');
    const minY = getChunkProp('min_y');
    const minZ = getChunkProp('min_z');
    const maxX = getChunkProp('max_x');
    const maxY = getChunkProp('max_y');
    const maxZ = getChunkProp('max_z');
    const minScaleX = getChunkProp('min_scale_x');
    const minScaleY = getChunkProp('min_scale_y');
    const minScaleZ = getChunkProp('min_scale_z');
    const maxScaleX = getChunkProp('max_scale_x');
    const maxScaleY = getChunkProp('max_scale_y');
    const maxScaleZ = getChunkProp('max_scale_z');

    const position = PlyCodecBase.getProp(vertices, 'packed_position');
    const rotation = PlyCodecBase.getProp(vertices, 'packed_rotation');
    const scale = PlyCodecBase.getProp(vertices, 'packed_scale');
    const color = PlyCodecBase.getProp(vertices, 'packed_color');

    const unpackUnorm = (value, bits) => {
      const t = (1 << bits) - 1;
      return (value & t) / t;
    };

    const unpack111011 = (result, value) => {
      result.x = unpackUnorm(value >>> 21, 11);
      result.y = unpackUnorm(value >>> 11, 10);
      result.z = unpackUnorm(value, 11);
    };

    const unpack8888 = (result, value) => {
      result.x = unpackUnorm(value >>> 24, 8);
      result.y = unpackUnorm(value >>> 16, 8);
      result.z = unpackUnorm(value >>> 8, 8);
      result.w = unpackUnorm(value, 8);
    };

    // unpack quaternion with 2,10,10,10 format (largest element, 3x10bit element)
    const unpackRot = (result, value) => {
      const norm = 1.0 / (Math.sqrt(2) * 0.5);
      const a = (unpackUnorm(value >>> 20, 10) - 0.5) * norm;
      const b = (unpackUnorm(value >>> 10, 10) - 0.5) * norm;
      const c = (unpackUnorm(value, 10) - 0.5) * norm;
      const m = Math.sqrt(1.0 - (a * a + b * b + c * c));

      switch (value >>> 30) {
        case 0:
          result.set(m, a, b, c);
          break;
        case 1:
          result.set(a, m, b, c);
          break;
        case 2:
          result.set(a, b, m, c);
          break;
        case 3:
          result.set(a, b, c, m);
          break;
      }
    };

    const lerp = (a, b, t) => a * (1 - t) + b * t;

    const p = new THREE.Vector3();
    const r = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Vector4();

    const OFFSET = UncompressedSplatArray.OFFSET;

    for (let i = 0; i < vertices.count; ++i) {

      const ci = Math.floor(i / 256);

      unpack111011(p, position[i]);
      unpackRot(r, rotation[i]);
      unpack111011(s, scale[i]);
      unpack8888(c, color[i]);

      splatArray.addDefaultSplat();
      const newSplat = splatArray.getSplat(splatArray.splatCount - 1);

      newSplat[OFFSET.X] = lerp(minX[ci], maxX[ci], p.x);
      newSplat[OFFSET.Y] = lerp(minY[ci], maxY[ci], p.y);
      newSplat[OFFSET.Z] = lerp(minZ[ci], maxZ[ci], p.z);

      newSplat[OFFSET.ROTATION0] = r.x;
      newSplat[OFFSET.ROTATION1] = r.y;
      newSplat[OFFSET.ROTATION2] = r.z;
      newSplat[OFFSET.ROTATION3] = r.w;

      newSplat[OFFSET.SCALE0] = Math.exp(lerp(minScaleX[ci], maxScaleX[ci], s.x));
      newSplat[OFFSET.SCALE1] = Math.exp(lerp(minScaleY[ci], maxScaleY[ci], s.y));
      newSplat[OFFSET.SCALE2] = Math.exp(lerp(minScaleZ[ci], maxScaleZ[ci], s.z));

      newSplat[OFFSET.FDC0] = Math.floor(c.x * 255);
      newSplat[OFFSET.FDC1] = Math.floor(c.y * 255);
      newSplat[OFFSET.FDC2] = Math.floor(c.z * 255);
      newSplat[OFFSET.OPACITY] = Math.floor(c.w * 255);
    }

    const mat = new THREE.Matrix4();
    mat.identity();

    return splatArray;
  }

}
