import { UncompressedSplatArray } from '../UncompressedSplatArray.js';
import { SplatBuffer } from '../SplatBuffer.js';
import { clamp } from '../../Util.js';
import * as THREE from 'three';

const HeaderMagicBytes = new Uint8Array([112, 108, 121, 10]);
const HeaderEndTokenBytes = new Uint8Array([10, 101, 110, 100, 95, 104, 101, 97, 100, 101, 114, 10]);
const HeaderEndToken = 'end_header';

const DataTypeMap = new Map([
  ['char', Int8Array],
  ['uchar', Uint8Array],
  ['short', Int16Array],
  ['ushort', Uint16Array],
  ['int', Int32Array],
  ['uint', Uint32Array],
  ['float', Float32Array],
  ['double', Float64Array],
]);

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

  static decodeHeaderText(headerText) {

    let element;
    let chunkElement;
    let vertexElement;

    const headerLines = headerText.split('\n').filter((line) => !line.startsWith('comment '));

    let bytesPerSplat = 0;
    let done = false;
    for (let i = 1; i < headerLines.length; ++i) {
      const words = headerLines[i].split(' ');

      switch (words[0]) {
        case 'format':
          if (words[1] !== 'binary_little_endian') {
            throw new Error('Unsupported ply format');
          }
          break;
        case 'element':
          element = {
            name: words[1],
            count: parseInt(words[2], 10),
            properties: [],
            storageSizeBytes: 0
          };
          if (element.name === 'chunk') chunkElement = element;
          else if (element.name === 'vertex') vertexElement = element;
          break;
        case 'property': {
          if (!DataTypeMap.has(words[1])) {
            throw new Error(
              `Unrecognized property data type '${words[1]}' in ply header`
            );
          }
          const StorageType = DataTypeMap.get(words[1]);
          const storageSizeByes = StorageType.BYTES_PER_ELEMENT * element.count;
          if (element.name === 'vertex') bytesPerSplat += StorageType.BYTES_PER_ELEMENT;
          element.properties.push({
            type: words[1],
            name: words[2],
            storage: null,
            byteSize: StorageType.BYTES_PER_ELEMENT,
            storageSizeByes: storageSizeByes
          });
          element.storageSizeBytes += storageSizeByes;
          break;
        }
        case HeaderEndToken:
          done = true;
        break;
        default:
          throw new Error(
            `Unrecognized header value '${words[0]}' in ply header`
          );
      }
      if (done) break;
    }

    return {
      'chunkElement': chunkElement,
      'vertexElement': vertexElement,
      'bytesPerSplat': bytesPerSplat,
      'headerSizeBytes': headerText.indexOf(HeaderEndToken) + HeaderEndToken.length + 1,
    };
  }

  static decodeHeader(plyBuffer) {

    /**
     * Searches for the first occurrence of a sequence within a buffer.
     * @example
     * find(new Uint8Array([1, 2, 3, 4]), new Uint8Array([3, 4])); // 2
     * @param {Uint8Array} buf - The buffer in which to search.
     * @param {Uint8Array} search - The sequence to search for.
     * @return {number} The index of the first occurrence of the search sequence in the buffer, or -1 if not found.
     */
    const find = (buf, search) => {
      const endIndex = buf.length - search.length;
      let i;
      let j;
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
     * @return {boolean} - True if 'a' starts with all elements of 'b', otherwise false.
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

    let buf = new Uint8Array(plyBuffer);
    let endHeaderTokenOffset;

    if (buf.length >= HeaderMagicBytes.length && !startsWith(buf, HeaderMagicBytes)) {
      throw new Error('Invalid PLY header');
    }

    endHeaderTokenOffset = find(buf, HeaderEndTokenBytes);
    if (endHeaderTokenOffset === -1) {
      throw new Error('End of PLY header not found');
    }

    const headerText = new TextDecoder('ascii').decode(
      buf.slice(0, endHeaderTokenOffset)
    );

    const {chunkElement, vertexElement, bytesPerSplat} = CompressedPlyParser.decodeHeaderText(headerText);

    return {
      'headerSizeBytes': endHeaderTokenOffset + HeaderEndTokenBytes.length,
      'bytesPerSplat': bytesPerSplat,
      'chunkElement': chunkElement,
      'vertexElement': vertexElement
    };
  }

  static readElementData(element, readBuffer, readOffset, fromIndex, toIndex, propertyFilter = null) {

    let dataView = readBuffer instanceof DataView ? readBuffer : new DataView(readBuffer);

    fromIndex = fromIndex || 0;
    toIndex = toIndex || element.count - 1;
    for (let e = fromIndex; e <= toIndex; ++e) {
      for (let j = 0; j < element.properties.length; ++j) {
        const property = element.properties[j];

        const StorageType = DataTypeMap.get(property.type);
        const requiredStorageSizeBytes = StorageType.BYTES_PER_ELEMENT * element.count;
        if ((!property.storage || property.storage.byteLength < requiredStorageSizeBytes) &&
            (!propertyFilter || propertyFilter(property.name))) {
          property.storage = new StorageType(element.count);
        }

        if (property.storage) {
          switch (property.type) {
            case 'char':
              property.storage[e] = dataView.getInt8(readOffset);
              break;
            case 'uchar':
              property.storage[e] = dataView.getUint8(readOffset);
              break;
            case 'short':
              property.storage[e] = dataView.getInt16(readOffset, true);
              break;
            case 'ushort':
              property.storage[e] = dataView.getUint16(readOffset, true);
              break;
            case 'int':
              property.storage[e] = dataView.getInt32(readOffset, true);
              break;
            case 'uint':
              property.storage[e] = dataView.getUint32(readOffset, true);
              break;
            case 'float':
              property.storage[e] = dataView.getFloat32(readOffset, true);
              break;
            case 'double':
              property.storage[e] = dataView.getFloat64(readOffset, true);
              break;
          }
        }

        readOffset += property.byteSize;
      }
    }

    return readOffset;
  }

  static readPly(plyBuffer, propertyFilter = null) {

    const header = CompressedPlyParser.decodeHeader(plyBuffer);

    let readIndex = CompressedPlyParser.readElementData(header.chunkElement, plyBuffer, header.headerSizeBytes, null, null, propertyFilter);
    CompressedPlyParser.readElementData(header.vertexElement, plyBuffer, readIndex, null, null, propertyFilter);

    return {
      'chunkElement': header.chunkElement,
      'vertexElement': header.vertexElement
    };
  }

  static getElementStorageArrays(chunkElement, vertexElement) {
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
    return {
      positionExtremes: {
        minX, maxX,
        minY, maxY,
        minZ, maxZ
      },
      scaleExtremes: {
        minScaleX, maxScaleX, minScaleY,
        maxScaleY, minScaleZ, maxScaleZ
      },
      position,
      rotation,
      scale,
      color
    };
  }

  static decompressSplat = function() {

    const p = new THREE.Vector3();
    const r = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Vector4();

    const OFFSET = UncompressedSplatArray.OFFSET;

    return function(index, chunkSplatIndexOffset, positionArray, positionExtremes, scaleArray, scaleExtremes,
                    rotationArray, colorArray, outSplat) {
      outSplat = outSplat || UncompressedSplatArray.createSplat();

      const chunkIndex = Math.floor((chunkSplatIndexOffset + index) / 256);

      unpack111011(p, positionArray[index]);
      unpackRot(r, rotationArray[index]);
      unpack111011(s, scaleArray[index]);
      unpack8888(c, colorArray[index]);

      outSplat[OFFSET.X] = lerp(positionExtremes.minX[chunkIndex], positionExtremes.maxX[chunkIndex], p.x);
      outSplat[OFFSET.Y] = lerp(positionExtremes.minY[chunkIndex], positionExtremes.maxY[chunkIndex], p.y);
      outSplat[OFFSET.Z] = lerp(positionExtremes.minZ[chunkIndex], positionExtremes.maxZ[chunkIndex], p.z);

      outSplat[OFFSET.ROTATION0] = r.x;
      outSplat[OFFSET.ROTATION1] = r.y;
      outSplat[OFFSET.ROTATION2] = r.z;
      outSplat[OFFSET.ROTATION3] = r.w;

      outSplat[OFFSET.SCALE0] = Math.exp(lerp(scaleExtremes.minScaleX[chunkIndex], scaleExtremes.maxScaleX[chunkIndex], s.x));
      outSplat[OFFSET.SCALE1] = Math.exp(lerp(scaleExtremes.minScaleY[chunkIndex], scaleExtremes.maxScaleY[chunkIndex], s.y));
      outSplat[OFFSET.SCALE2] = Math.exp(lerp(scaleExtremes.minScaleZ[chunkIndex], scaleExtremes.maxScaleZ[chunkIndex], s.z));

      outSplat[OFFSET.FDC0] = clamp(Math.floor(c.x * 255), 0, 255);
      outSplat[OFFSET.FDC1] = clamp(Math.floor(c.y * 255), 0, 255);
      outSplat[OFFSET.FDC2] = clamp(Math.floor(c.z * 255), 0, 255);
      outSplat[OFFSET.OPACITY] = clamp(Math.floor(c.w * 255), 0, 255);

      return outSplat;
    };

  }();

  static parseToUncompressedSplatBufferSection(chunkElement, vertexElement, fromIndex, toIndex, chunkSplatIndexOffset,
                                               vertexDataBuffer, veretxReadOffset, outBuffer, outOffset, propertyFilter = null) {

    CompressedPlyParser.readElementData(vertexElement, vertexDataBuffer, veretxReadOffset, fromIndex, toIndex, propertyFilter);

    const outBytesPerCenter = SplatBuffer.CompressionLevels[0].BytesPerCenter;
    const outBytesPerScale = SplatBuffer.CompressionLevels[0].BytesPerScale;
    const outBytesPerRotation = SplatBuffer.CompressionLevels[0].BytesPerRotation;
    const outBytesPerSplat = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[0].BytesPerSplat;

    const { positionExtremes, scaleExtremes, position, rotation, scale, color } =
      CompressedPlyParser.getElementStorageArrays(chunkElement, vertexElement);

    const OFFSET = UncompressedSplatArray.OFFSET;
    const tempSplat = UncompressedSplatArray.createSplat();

    for (let i = fromIndex; i <= toIndex; ++i) {

      CompressedPlyParser.decompressSplat(i, chunkSplatIndexOffset, position, positionExtremes,
                                          scale, scaleExtremes, rotation, color, tempSplat);

      const outBase = i * outBytesPerSplat + outOffset;
      const outCenter = new Float32Array(outBuffer, outBase, 3);
      const outScale = new Float32Array(outBuffer, outBase + outBytesPerCenter, 3);
      const outRotation = new Float32Array(outBuffer, outBase + outBytesPerCenter + outBytesPerScale, 4);
      const outColor = new Uint8Array(outBuffer, outBase + outBytesPerCenter + outBytesPerScale + outBytesPerRotation, 4);

      outCenter[0] = tempSplat[OFFSET.X];
      outCenter[1] = tempSplat[OFFSET.Y];
      outCenter[2] = tempSplat[OFFSET.Z];

      outScale[0] = tempSplat[OFFSET.SCALE0];
      outScale[1] = tempSplat[OFFSET.SCALE1];
      outScale[2] = tempSplat[OFFSET.SCALE2];

      outRotation[0] = tempSplat[OFFSET.ROTATION0];
      outRotation[1] = tempSplat[OFFSET.ROTATION1];
      outRotation[2] = tempSplat[OFFSET.ROTATION2];
      outRotation[3] = tempSplat[OFFSET.ROTATION3];

      outColor[0] = tempSplat[OFFSET.FDC0];
      outColor[1] = tempSplat[OFFSET.FDC1];
      outColor[2] = tempSplat[OFFSET.FDC2];
      outColor[3] = tempSplat[OFFSET.OPACITY];
    }
  }

  static parseToUncompressedSplatArray(plyBuffer) {
    const { chunkElement, vertexElement } = CompressedPlyParser.readPly(plyBuffer);

    const splatArray = new UncompressedSplatArray();

    const { positionExtremes, scaleExtremes, position, rotation, scale, color } =
      CompressedPlyParser.getElementStorageArrays(chunkElement, vertexElement);

    for (let i = 0; i < vertexElement.count; ++i) {

      splatArray.addDefaultSplat();
      const newSplat = splatArray.getSplat(splatArray.splatCount - 1);

      CompressedPlyParser.decompressSplat(i, 0, position, positionExtremes, scale, scaleExtremes, rotation, color, newSplat);
    }

    const mat = new THREE.Matrix4();
    mat.identity();

    return splatArray;
  }

}
