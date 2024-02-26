import { Chunk } from "./Chunk";
import { SplatCompressor } from "./SplatCompressor";
import * as THREE from "three";

export class PlyParserCodecBase {
  splatData = {};
  plyElements = [];
  vertexElement = {
    properties: [],
  };
  deletedOpacity = -1000;

  members = [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
    "scale_0",
    "scale_1",
    "scale_2",
  ];
  constructor() { }

  plyElements(plyElements) {
    this.plyElements = plyElements;
  }

  getProp(name) {
    return this.vertexElement.properties.find(
      (property) => property.name === name && property.storage
    )?.storage;
  }

  async readPly(arrayBuffer, propertyFilter = null) {
    const magicBytes = new Uint8Array([112, 108, 121, 10]); // ply\n
    const endHeaderBytes = new Uint8Array([
      10, 101, 110, 100, 95, 104, 101, 97, 100, 101, 114, 10,
    ]); // \nend_header\n
    const dataTypeMap = new Map([
      ["char", Int8Array],
      ["uchar", Uint8Array],
      ["short", Int16Array],
      ["ushort", Uint16Array],
      ["int", Int32Array],
      ["uint", Uint32Array],
      ["float", Float32Array],
      ["double", Float64Array],
    ]);
    const concat = (a, b) => {
      const c = new Uint8Array(a.byteLength + b.byteLength);
      c.set(a);
      c.set(b, a.byteLength);
      return c;
    };

    /**
     * Searches for the first occurrence of a sequence within a buffer.
     * @example
     * find(new Uint8Array([1, 2, 3, 4]), new Uint8Array([3, 4])); // 2
     * @param {Uint8Array} buf - The buffer in which to search.
     * @param {Uint8Array} search - The sequence to search for.
     * @returns {number} The index of the first occurrence of the search sequence in the buffer, or -1 if not found.
     */
    const find = (buf, search) => {
      const endIndex = buf.length - search.length;
      let i, j;
      for (i = 0; i <= endIndex; ++i) {
        for (j = 0; j < search.length; ++j) {
          if (buf[i + j] !== search[j]) {
            break;
          }
        }
        if (j === search.length) {
          return i;
        }
      }
      return -1;
    };

    /**
     * Checks if array 'a' starts with the same elements as array 'b'.
     * @example
     * startsWith(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2])); // true
     * @param {Uint8Array} a - The array to check against.
     * @param {Uint8Array} b - The array of elements to look for at the start of 'a'.
     * @returns {boolean} - True if 'a' starts with all elements of 'b', otherwise false.
     */
    const startsWith = (a, b) => {
      if (a.length < b.length) {
        return false;
      }

      for (let i = 0; i < b.length; ++i) {
        if (a[i] !== b[i]) {
          return false;
        }
      }

      return true;
    };

    // Start processing the ArrayBuffer directly
    let buf = new Uint8Array(arrayBuffer);
    let endHeaderIndex;

    // Check magic bytes (assuming magicBytes is defined)
    if (buf.length >= magicBytes.length && !startsWith(buf, magicBytes)) {
      throw new Error("Invalid PLY header");
    }

    // Find the end-of-header marker (assuming endHeaderBytes is defined)
    endHeaderIndex = find(buf, endHeaderBytes);
    if (endHeaderIndex === -1) {
      throw new Error("End of PLY header not found");
    }

    // Decode buffer header text
    const headerText = new TextDecoder("ascii").decode(
      buf.slice(0, endHeaderIndex)
    );

    // Process header (this logic remains unchanged)
    const headerLines = headerText
      .split("\n")
      .filter((line) => !line.startsWith("comment "));
    const elements = [];
    for (let i = 1; i < headerLines.length; ++i) {
      const words = headerLines[i].split(" ");

      switch (words[0]) {
        case "format":
          if (words[1] !== "binary_little_endian") {
            throw new Error("Unsupported ply format");
          }
          break;
        case "element":
          elements.push({
            name: words[1],
            count: parseInt(words[2], 10),
            properties: [],
          });
          break;
        case "property": {
          if (!dataTypeMap.has(words[1])) {
            throw new Error(
              `Unrecognized property data type '${words[1]}' in ply header`
            );
          }
          const element = elements[elements.length - 1];
          const storageType = dataTypeMap.get(words[1]);
          const storage =
            !propertyFilter || propertyFilter(words[2])
              ? new storageType(element.count)
              : null;
          element.properties.push({
            type: words[1],
            name: words[2],
            storage: storage,
            byteSize: storageType.BYTES_PER_ELEMENT,
          });
          break;
        }
        default:
          throw new Error(
            `Unrecognized header value '${words[0]}' in ply header`
          );
      }
    }

    // read data
    let readIndex = endHeaderIndex + endHeaderBytes.length;
    let remaining = buf.length - readIndex;
    let dataView = new DataView(buf.buffer);

    for (let i = 0; i < elements.length; ++i) {
      const element = elements[i];

      for (let e = 0; e < element.count; ++e) {
        for (let j = 0; j < element.properties.length; ++j) {
          const property = element.properties[j];

          // if we've run out of data, load the next chunk
          while (remaining < property.byteSize) {
            const { value, done } = await reader.read();

            if (done) {
              throw new Error("Stream finished before end of data");
            }

            // create buffer with left-over data from previous chunk and the new data
            const tmp = new Uint8Array(remaining + value.byteLength);
            tmp.set(buf.slice(readIndex));
            tmp.set(value, remaining);

            buf = tmp;
            dataView = new DataView(buf.buffer);
            readIndex = 0;
            remaining = buf.length;
          }

          if (property.storage) {
            switch (property.type) {
              case "char":
                property.storage[e] = dataView.getInt8(readIndex);
                break;
              case "uchar":
                property.storage[e] = dataView.getUint8(readIndex);
                break;
              case "short":
                property.storage[e] = dataView.getInt16(readIndex, true);
                break;
              case "ushort":
                property.storage[e] = dataView.getUint16(readIndex, true);
                break;
              case "int":
                property.storage[e] = dataView.getInt32(readIndex, true);
                break;
              case "uint":
                property.storage[e] = dataView.getUint32(readIndex, true);
                break;
              case "float":
                property.storage[e] = dataView.getFloat32(readIndex, true);
                break;
              case "double":
                property.storage[e] = dataView.getFloat64(readIndex, true);
                break;
            }
          }

          readIndex += property.byteSize;
          remaining -= property.byteSize;
        }
      }
    }
    this.plyElements = elements;
    this.vertexElement = elements.find((element) => element.name === "vertex");
  }

  isCompressed() {
    return (
      this.plyElements.some((e) => e.name === "chunk") &&
      [
        "packed_position",
        "packed_rotation",
        "packed_scale",
        "packed_color",
      ].every((name) => this.getProp(name))
    );
  }

  convertFileToSplatData() {
    const chunk = this.plyElements[0];
    const res = this.members.reduce((acc, name) => {
      acc[name] = this.getProp(name);
      return acc;
    }, {});
    res.count = chunk.count;
    this.splatData = res;
  }

  convertSplat(splatData, modelMat) {
    const x = splatData.x;
    const y = splatData.y;
    const z = splatData.z;
    const opacity = splatData.opacity;
    const rot_0 = splatData.rot_0;
    const rot_1 = splatData.rot_1;
    const rot_2 = splatData.rot_2;
    const rot_3 = splatData.rot_3;
    const f_dc_0 = splatData.f_dc_0;
    const f_dc_1 = splatData.f_dc_1;
    const f_dc_2 = splatData.f_dc_2;
    const scale_0 = splatData.scale_0;
    const scale_1 = splatData.scale_1;
    const scale_2 = splatData.scale_2;

    let numSplats = 0;
    for (let i = 0; i < splatData.numSplats; ++i) {
      numSplats += opacity[i] !== this.deletedOpacity ? 1 : 0;
    }

    const result = new Uint8Array(numSplats * 32);
    const dataView = new DataView(result.buffer);

    const mat = new THREE.Matrix4();
    mat.invert();
    mat.copy(modelMat).invert();

    const quat = new THREE.Quaternion();
    quat.setFromRotationMatrix(mat);

    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mat.decompose(v, quat, scale);

    const clamp = (x) => Math.max(0, Math.min(255, x));
    let idx = 0;

    for (let i = 0; i < splatData.numSplats; ++i) {
      if (opacity[i] === this.deletedOpacity) continue;

      const off = idx++ * 32;

      v.set(x[i], y[i], z[i]);
      v.applyMatrix4(mat);
      dataView.setFloat32(off + 0, v.x, true);
      dataView.setFloat32(off + 4, v.y, true);
      dataView.setFloat32(off + 8, v.z, true);

      dataView.setFloat32(off + 12, Math.exp(scale_0[i]) * scale.x, true);
      dataView.setFloat32(off + 16, Math.exp(scale_1[i]) * scale.x, true);
      dataView.setFloat32(off + 20, Math.exp(scale_2[i]) * scale.x, true);

      const SH_C0 = 0.28209479177387814;
      dataView.setUint8(off + 24, clamp((0.5 + SH_C0 * f_dc_0[i]) * 255));
      dataView.setUint8(off + 25, clamp((0.5 + SH_C0 * f_dc_1[i]) * 255));
      dataView.setUint8(off + 26, clamp((0.5 + SH_C0 * f_dc_2[i]) * 255));
      dataView.setUint8(off + 27, clamp((1 / (1 + Math.exp(-opacity[i]))) * 255));

      q.set(rot_1[i], rot_2[i], rot_3[i], rot_0[i]).normalize();
      q.multiplyQuaternions(quat, q);
      dataView.setUint8(off + 28, clamp(q.w * 128 + 128));
      dataView.setUint8(off + 29, clamp(q.x * 128 + 128));
      dataView.setUint8(off + 30, clamp(q.y * 128 + 128));
      dataView.setUint8(off + 31, clamp(q.z * 128 + 128));
    }

    return result;
  };
}

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

    const splatArray = {
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
    const ply = this.convertSplat(splatArray, mat);

    return ply;
  }
}

export class PlyParserCompress extends PlyParserCodecBase {
  constructor() {
    super();
  }
  compress() {
    const splatData = this.splatData;
    const modelMat = Float32Array.from([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
    const encodeMorton3 = (x, y, z) => {
      const Part1By2 = (x) => {
        x &= 0x000003ff;
        x = (x ^ (x << 16)) & 0xff0000ff;
        x = (x ^ (x << 8)) & 0x0300f00f;
        x = (x ^ (x << 4)) & 0x030c30c3;
        x = (x ^ (x << 2)) & 0x09249249;
        return x;
      };

      return (Part1By2(z) << 2) + (Part1By2(y) << 1) + Part1By2(x);
    };
    const sortSplats = (indices) => {
      const x = this.getProp('x');
      const y = this.getProp('y');
      const z = this.getProp('z');

      const bx = calcMinMax(x, indices);
      const by = calcMinMax(y, indices);
      const bz = calcMinMax(z, indices);

      // generate morton codes
      const morton = indices.map((i) => {
        const ix = Math.floor(1024 * (x[i] - bx.min) / (bx.max - bx.min));
        const iy = Math.floor(1024 * (y[i] - by.min) / (by.max - by.min));
        const iz = Math.floor(1024 * (z[i] - bz.min) / (bz.max - bz.min));
        return encodeMorton3(ix, iy, iz);
      });

      // order splats by morton code
      indices.sort((a, b) => morton[a] - morton[b]);
    };

    // generate index list of surviving splats
    const opacity = this.getProp('opacity');
    const indices = [];
    for (let i = 0; i < splatData.count; ++i) {
      if (opacity[i] !== this.deletedOpacity) {
        indices.push(i);
      }
    }

    if (indices.length === 0) {
      console.error('nothing to export');
      return;
    }

    const numSplats = indices.length;
    const numChunks = Math.ceil(numSplats / 256);

    const chunkProps = ['min_x', 'min_y', 'min_z', 'max_x', 'max_y', 'max_z', 'min_scale_x', 'min_scale_y', 'min_scale_z', 'max_scale_x', 'max_scale_y', 'max_scale_z'];
    const vertexProps = ['packed_position', 'packed_rotation', 'packed_scale', 'packed_color'];
    const headerText = [
      [
        `ply`,
        `format binary_little_endian 1.0`,
        `comment generated by super-splat`,
        `element chunk ${numChunks}`
      ],
      chunkProps.map(p => `property float ${p}`),
      [
        `element vertex ${numSplats}`
      ],
      vertexProps.map(p => `property uint ${p}`),
      [
        `end_header\n`
      ]
    ].flat().join('\n');

    const header = (new TextEncoder()).encode(headerText);
    const result = new Uint8Array(header.byteLength + numChunks * chunkProps.length * 4 + numSplats * vertexProps.length * 4);
    const dataView = new DataView(result.buffer);

    result.set(header);

    const chunkOffset = header.byteLength;
    const vertexOffset = chunkOffset + numChunks * 12 * 4;

    const chunk = new Chunk(this.plyElements[0]);

    // sort splats into some kind of order
    sortSplats(indices);

    for (let i = 0; i < numChunks; ++i) {
      chunk.set(splatData, indices.slice(i * 256, (i + 1) * 256));
      chunk.transform(modelMat);

      const result = chunk.pack();

      // write chunk data
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 0, result.px.min, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 4, result.py.min, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 8, result.pz.min, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 12, result.px.max, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 16, result.py.max, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 20, result.pz.max, true);

      dataView.setFloat32(chunkOffset + i * 12 * 4 + 24, result.sx.min, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 28, result.sy.min, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 32, result.sz.min, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 36, result.sx.max, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 40, result.sy.max, true);
      dataView.setFloat32(chunkOffset + i * 12 * 4 + 44, result.sz.max, true);

      // write splat data
      let offset = vertexOffset + i * 256 * 4 * 4;
      const chunkSplats = Math.min(numSplats, (i + 1) * 256) - i * 256;
      for (let j = 0; j < chunkSplats; ++j) {
        dataView.setUint32(offset + j * 4 * 4 + 0, chunk.position[j], true);
        dataView.setUint32(offset + j * 4 * 4 + 4, chunk.rotation[j], true);
        dataView.setUint32(offset + j * 4 * 4 + 8, chunk.scale[j], true);
        dataView.setUint32(offset + j * 4 * 4 + 12, chunk.color[j], true);
      }
    }

    return result;
  };
}


