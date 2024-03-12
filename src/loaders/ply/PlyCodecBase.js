export class PlyCodecBase {

  vertexElement = {
    properties: [],
  };

  deletedOpacity = -1000;

  static getProp(vertexElement, name) {
    return vertexElement.properties.find(
      (property) => property.name === name && property.storage
    )?.storage;
  }

  static readPly(plyBuffer, propertyFilter = null) {

    const magicBytes = new Uint8Array([112, 108, 121, 10]); // ply\n
    const endHeaderBytes = new Uint8Array([
      10, 101, 110, 100, 95, 104, 101, 97, 100, 101, 114, 10,
    ]); // \nend_header\n

    const dataTypeMap = new Map([
      ['char', Int8Array],
      ['uchar', Uint8Array],
      ['short', Int16Array],
      ['ushort', Uint16Array],
      ['int', Int32Array],
      ['uint', Uint32Array],
      ['float', Float32Array],
      ['double', Float64Array],
    ]);

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

    // Start processing the ArrayBuffer directly
    let buf = new Uint8Array(plyBuffer);
    let endHeaderIndex;

    // Check magic bytes (assuming magicBytes is defined)
    if (buf.length >= magicBytes.length && !startsWith(buf, magicBytes)) {
      throw new Error('Invalid PLY header');
    }

    // Find the end-of-header marker (assuming endHeaderBytes is defined)
    endHeaderIndex = find(buf, endHeaderBytes);
    if (endHeaderIndex === -1) {
      throw new Error('End of PLY header not found');
    }

    // Decode buffer header text
    const headerText = new TextDecoder('ascii').decode(
      buf.slice(0, endHeaderIndex)
    );

    // Process header (this logic remains unchanged)
    const headerLines = headerText
      .split('\n')
      .filter((line) => !line.startsWith('comment '));
    const elements = [];
    for (let i = 1; i < headerLines.length; ++i) {
      const words = headerLines[i].split(' ');

      switch (words[0]) {
        case 'format':
          if (words[1] !== 'binary_little_endian') {
            throw new Error('Unsupported ply format');
          }
          break;
        case 'element':
          elements.push({
            name: words[1],
            count: parseInt(words[2], 10),
            properties: [],
          });
          break;
        case 'property': {
          if (!dataTypeMap.has(words[1])) {
            throw new Error(
              `Unrecognized property data type '${words[1]}' in ply header`
            );
          }
          const element = elements[elements.length - 1];
          const StorageType = dataTypeMap.get(words[1]);
          const storage = (!propertyFilter || propertyFilter(words[2])) ? new StorageType(element.count) : null;
          element.properties.push({
            type: words[1],
            name: words[2],
            storage: storage,
            byteSize: StorageType.BYTES_PER_ELEMENT,
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
    let dataView = new DataView(buf.buffer);

    for (let i = 0; i < elements.length; ++i) {
      const element = elements[i];

      for (let e = 0; e < element.count; ++e) {
        for (let j = 0; j < element.properties.length; ++j) {
          const property = element.properties[j];

          if (property.storage) {
            switch (property.type) {
              case 'char':
                property.storage[e] = dataView.getInt8(readIndex);
                break;
              case 'uchar':
                property.storage[e] = dataView.getUint8(readIndex);
                break;
              case 'short':
                property.storage[e] = dataView.getInt16(readIndex, true);
                break;
              case 'ushort':
                property.storage[e] = dataView.getUint16(readIndex, true);
                break;
              case 'int':
                property.storage[e] = dataView.getInt32(readIndex, true);
                break;
              case 'uint':
                property.storage[e] = dataView.getUint32(readIndex, true);
                break;
              case 'float':
                property.storage[e] = dataView.getFloat32(readIndex, true);
                break;
              case 'double':
                property.storage[e] = dataView.getFloat64(readIndex, true);
                break;
            }
          }

          readIndex += property.byteSize;
        }
      }
    }

    return {
      'plyElements': elements,
      'vertexElement': elements.find((element) => element.name === 'vertex')
    };
  }

}
