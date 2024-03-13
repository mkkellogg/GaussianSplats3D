import { PlyCodecBase } from './PlyCodecBase.js';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';
import { clamp } from '../../Util.js';
import * as THREE from 'three';

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

const lerp = (a, b, t) => {
  return a * (1 - t) + b * t;
};

const getElementPropStorage = (element, name) => {
  return element.properties.find((p) => p.name === name && p.storage)
    ?.storage;
};

export class CompressedPlyParser {

  static readVertexDataToUncompressedSplatBufferSection(chunkElement, vertexElement, vertexDataBuffer, veretxReadOffset,
                                                        fromIndex, toIndex, outBuffer, outOffset, propertyFilter = null) {

    PlyCodecBase.readElementData(vertexElement, vertexDataBuffer, veretxReadOffset, fromIndex, toIndex, propertyFilter);

    const minX = getElementPropStorage(chunkElement, 'min_x');
    const minY = getElementPropStorage(chunkElement, 'min_y');
    const minZ = getElementPropStorage(chunkElement, 'min_z');
    const maxX = getElementPropStorage(chunkElement, 'max_x');
    const maxY = getElementPropStorage(chunkElement, 'max_y');
    const maxZ = getElementPropStorage(chunkElement, 'max_z');
    const minScaleX = getElementPropStorage(chunkElement, 'min_scale_x');
    const minScaleY = getElementPropStorage(chunkElement, 'min_scale_y');
    const minScaleZ = getElementPropStorage(chunkElement, 'min_scale_z');
    const maxScaleX = getElementPropStorage(chunkElement, 'max_scale_x');
    const maxScaleY = getElementPropStorage(chunkElement, 'max_scale_y');
    const maxScaleZ = getElementPropStorage(chunkElement, 'max_scale_z');

    const position = getElementPropStorage(vertexElement, 'packed_position');
    const rotation = getElementPropStorage(vertexElement, 'packed_rotation');
    const scale = getElementPropStorage(vertexElement, 'packed_scale');
    const color = getElementPropStorage(vertexElement, 'packed_color');


    const p = new THREE.Vector3();
    const r = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Vector4();

    const outBytesPerCenter = SplatBuffer.CompressionLevels[0].BytesPerCenter;
    const outBytesPerScale = SplatBuffer.CompressionLevels[0].BytesPerScale;
    const outBytesPerRotation = SplatBuffer.CompressionLevels[0].BytesPerRotation;
    const outBytesPerSplat = SplatBuffer.CompressionLevels[0].BytesPerSplat;

    for (let i = fromindex; i <= toIndex; ++i) {

      const ci = Math.floor(i / 256);

      unpack111011(p, position[i]);
      unpackRot(r, rotation[i]);
      unpack111011(s, scale[i]);
      unpack8888(c, color[i]);

      const outBase = (i - fromIndex) * outBytesPerSplat + outOffset;
      const outCenter = new Float32Array(outBuffer, outBase, 3);
      const outScale = new Float32Array(outBuffer, outBase + outBytesPerCenter, 3);
      const outRotation = new Float32Array(outBuffer, outBase + outBytesPerCenter + outBytesPerScale, 4);
      const outColor = new Uint8Array(outBuffer, outBase + outBytesPerCenter + outBytesPerScale + outBytesPerRotation, 4);

      outCenter[0] = lerp(minX[ci], maxX[ci], p.x);
      outCenter[1] = lerp(minY[ci], maxY[ci], p.y);
      outCenter[2] = lerp(minZ[ci], maxZ[ci], p.z);

      outScale[0] = Math.exp(lerp(minScaleX[ci], maxScaleX[ci], s.x));
      outScale[1] = Math.exp(lerp(minScaleY[ci], maxScaleY[ci], s.y));
      outScale[2] = Math.exp(lerp(minScaleZ[ci], maxScaleZ[ci], s.z));

      outRotation[0] = r.x;
      outRotation[1] = r.y;
      outRotation[2] = r.z;
      outRotation[3] = r.w;

      outColor[0] = clamp(Math.floor(c.x * 255), 0, 255);
      outColor[1] = clamp(Math.floor(c.y * 255), 0, 255);
      outColor[2] = clamp(Math.floor(c.z * 255), 0, 255);
      outColor[3] = clamp(Math.floor(c.w * 255), 0, 255);
    }
  }

  static parseToUncompressedSplatArray(plyBuffer) {
    const { chunkElement, vertexElement } = PlyCodecBase.readPly(plyBuffer);

    // allocate uncompressed data
    const splatArray = new UncompressedSplatArray();

    const minX = getElementPropStorage(chunkElement, 'min_x');
    const minY = getElementPropStorage(chunkElement, 'min_y');
    const minZ = getElementPropStorage(chunkElement, 'min_z');
    const maxX = getElementPropStorage(chunkElement, 'max_x');
    const maxY = getElementPropStorage(chunkElement, 'max_y');
    const maxZ = getElementPropStorage(chunkElement, 'max_z');
    const minScaleX = getElementPropStorage(chunkElement, 'min_scale_x');
    const minScaleY = getElementPropStorage(chunkElement, 'min_scale_y');
    const minScaleZ = getElementPropStorage(chunkElement, 'min_scale_z');
    const maxScaleX = getElementPropStorage(chunkElement, 'max_scale_x');
    const maxScaleY = getElementPropStorage(chunkElement, 'max_scale_y');
    const maxScaleZ = getElementPropStorage(chunkElement, 'max_scale_z');

    const position = getElementPropStorage(vertexElement, 'packed_position');
    const rotation = getElementPropStorage(vertexElement, 'packed_rotation');
    const scale = getElementPropStorage(vertexElement, 'packed_scale');
    const color = getElementPropStorage(vertexElement, 'packed_color');

    const p = new THREE.Vector3();
    const r = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Vector4();

    const OFFSET = UncompressedSplatArray.OFFSET;

    for (let i = 0; i < vertexElement.count; ++i) {

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

      newSplat[OFFSET.FDC0] = clamp(Math.floor(c.x * 255), 0, 255);
      newSplat[OFFSET.FDC1] = clamp(Math.floor(c.y * 255), 0, 255);
      newSplat[OFFSET.FDC2] = clamp(Math.floor(c.z * 255), 0, 255);
      newSplat[OFFSET.OPACITY] = clamp(Math.floor(c.w * 255), 0, 255);
    }

    const mat = new THREE.Matrix4();
    mat.identity();

    return splatArray;
  }

}
