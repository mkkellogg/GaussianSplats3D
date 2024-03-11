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

  calcMinMax(data, indices) {
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
}

