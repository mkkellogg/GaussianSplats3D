import { PlyParserCodecBase } from "./PlyParserCoDecBase";
import { SplatCompressor } from "./SplatCompressor";
import * as THREE from "three";

export class PlyParserDecompress extends PlyParserCodecBase {
  constructor() {
    super();
  }

  decompress(compressionLevel, minimumAlpha, blockSize, bucketSize) {
    const chunks = this.plyElements.find((e) => e.name === "chunk");
    const vertices = this.vertexElement;

    // allocate uncompressed data
    const data = SplatCompressor.createEmptyUncompressedSplatArray();

    this.members.forEach((name) => {
      data[name] = new Float32Array(vertices.count);
    });

    const getChunkProp = (name) => {
      return chunks.properties.find((p) => p.name === name && p.storage)
        ?.storage;
    };

    const min_x = getChunkProp("min_x");
    const min_y = getChunkProp("min_y");
    const min_z = getChunkProp("min_z");
    const max_x = getChunkProp("max_x");
    const max_y = getChunkProp("max_y");
    const max_z = getChunkProp("max_z");
    const min_scale_x = getChunkProp("min_scale_x");
    const min_scale_y = getChunkProp("min_scale_y");
    const min_scale_z = getChunkProp("min_scale_z");
    const max_scale_x = getChunkProp("max_scale_x");
    const max_scale_y = getChunkProp("max_scale_y");
    const max_scale_z = getChunkProp("max_scale_z");

    const position = this.getProp("packed_position");
    const rotation = this.getProp("packed_rotation");
    const scale = this.getProp("packed_scale");
    const color = this.getProp("packed_color");

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

    for (let i = 0; i < vertices.count; ++i) {

      const ci = Math.floor(i / 256);

      unpack111011(p, position[i]);
      unpackRot(r, rotation[i]);
      unpack111011(s, scale[i]);
      unpack8888(c, color[i]);

      data.x[i] = lerp(min_x[ci], max_x[ci], p.x);
      data.y[i] = lerp(min_y[ci], max_y[ci], p.y);
      data.z[i] = lerp(min_z[ci], max_z[ci], p.z);

      data.rot_0[i] = r.x;
      data.rot_1[i] = r.y;
      data.rot_2[i] = r.z;
      data.rot_3[i] = r.w;

      data.scale_0[i] = lerp(min_scale_x[ci], max_scale_x[ci], s.x);
      data.scale_1[i] = lerp(min_scale_y[ci], max_scale_y[ci], s.y);
      data.scale_2[i] = lerp(min_scale_z[ci], max_scale_z[ci], s.z);

      const SH_C0 = 0.28209479177387814;
      data.f_dc_0[i] = (c.x - 0.5) / SH_C0;
      data.f_dc_1[i] = (c.y - 0.5) / SH_C0;
      data.f_dc_2[i] = (c.z - 0.5) / SH_C0;
      data.opacity[i] = -Math.log(1 / c.w - 1);
    }

    const splatData = {
      f_dc_0: data.f_dc_0,
      f_dc_1: data.f_dc_1,
      f_dc_2: data.f_dc_2,
      opacity: data.opacity,
      rot_0: data.rot_0,
      rot_1: data.rot_1,
      rot_2: data.rot_2,
      rot_3: data.rot_3,
      scale_0: data.scale_0,
      scale_1: data.scale_1,
      scale_2: data.scale_2,
      x: data.x,
      y: data.y,
      z: data.z,
      numSplats: vertices.count,
    };

    const mat = new THREE.Matrix4();
    mat.identity();

    this.splatData = splatData;
    return;
  }

  convertPlyWithThreeJS = (data, vertices, modelMatArray) => {
    const deletedOpacity = 0; // Assuming deletedOpacity is defined elsewhere
    const opacity = data.opacity;
    let numSplats = 0;
    for (let i = 0; i < vertices.count; ++i) {
      numSplats += opacity[i] !== deletedOpacity ? 1 : 0;
    }

    const internalProps = ['selection', 'opacityOrig'];
    const props = Object.keys(data).filter(p => !internalProps.includes(p) && p !== 'numSplats');
    const headerStr = `ply\nformat binary_little_endian 1.0\nelement vertex ${numSplats}\n` +
      props.map(p => `property float ${p}`).join('\n') + `\nend_header\n`;
    const header = new TextEncoder().encode(headerStr);
    const result = new Uint8Array(header.length + numSplats * props.length * 4);
    result.set(header);

    const dataView = new DataView(result.buffer);
    let offset = header.length;

    for (let i = 0; i < vertices.count; ++i) {
      if (opacity[i] !== deletedOpacity) {
        props.forEach(prop => {
          dataView.setFloat32(offset, data[prop][i], true);
          offset += 4;
        });
      }
    }

    const modelMatrix = new THREE.Matrix4();
    modelMatrix.fromArray(modelMatArray);

    const inverseModelMatrix = new THREE.Matrix4().copy(modelMatrix).invert();
    const scale = new THREE.Vector3();
    scale.setFromMatrixScale(modelMatrix);

    const vec3 = new THREE.Vector3();
    const quat = new THREE.Quaternion().setFromRotationMatrix(modelMatrix);

    for (let i = 0; i < numSplats; ++i) {
      const baseOffset = header.length + i * props.length * 4;

      vec3.x = dataView.getFloat32(baseOffset + props.indexOf('x') * 4, true);
      vec3.y = dataView.getFloat32(baseOffset + props.indexOf('y') * 4, true);
      vec3.z = dataView.getFloat32(baseOffset + props.indexOf('z') * 4, true);

      vec3.applyMatrix4(inverseModelMatrix);

      dataView.setFloat32(baseOffset + props.indexOf('x') * 4, vec3.x, true);
      dataView.setFloat32(baseOffset + props.indexOf('y') * 4, vec3.y, true);
      dataView.setFloat32(baseOffset + props.indexOf('z') * 4, vec3.z, true);
    }

    return result;
  };


}

