import * as THREE from 'three';
import { SplatBuffer } from '../../SplatBuffer';
import { GLTFParser } from './GLTFParser.js';
import { delayedExecute } from '../../../Util.js';

function finalize(splatData, minimumAlpha = 1) {
  return SplatBuffer.generateFromUncompressedSplatArrays(
    [splatData],
    minimumAlpha,
    0,
    new THREE.Vector3(),
  );
}

function getBaseUrl(url) {
  return url.substring(0, url.lastIndexOf('/') + 1);
}

function getFilePaths(gltf, gltfUrl) {
  const baseUrl = getBaseUrl(gltfUrl);

  try {
    const attributes = gltf.meshes[0].primitives[0].attributes;
    const extensions =
      gltf.meshes[0].primitives[0].extensions
        .OPF_mesh_primitive_custom_attributes.attributes;

    const attributeMapping = {
      POSITION: attributes.POSITION,
      opacity: extensions.opacity,
      scale: extensions.scale,
      rotation: extensions.rotation,
      // 0th order
      sh_band_0: extensions.sh_band_0,
      // 1st order
      sh_band_1_0: extensions.sh_band_1_triplet_0,
      sh_band_1_1: extensions.sh_band_1_triplet_1,
      sh_band_1_2: extensions.sh_band_1_triplet_2,
      // 2nd order
      sh_band_2_0: extensions.sh_band_2_triplet_0,
      sh_band_2_1: extensions.sh_band_2_triplet_1,
      sh_band_2_2: extensions.sh_band_2_triplet_2,
      sh_band_2_3: extensions.sh_band_2_triplet_3,
      sh_band_2_4: extensions.sh_band_2_triplet_4,
    };

    return Object.fromEntries(
      Object.entries(attributeMapping).map(([key, index]) => {
        const bufferIndex =
          gltf.bufferViews[gltf.accessors[index].bufferView].buffer;
        return [key, baseUrl + gltf.buffers[bufferIndex].uri];
      }),
    );
  } catch (error) {
    console.error('Error processing GLTF structure:', error);
    return {};
  }
}

export class GLTFLoader {
  /**
   *
   * @param {import('../../../Viewer.js').Viewer} viewer
   */
  constructor(viewer) {
    this.viewer = viewer;
  }
  async loadFromURL(url = 'http://localhost:8081/gaussian/gltf/pcl.gltf') {
    try {
      const gltf = await this.fetchGLTF(url);
      const filePaths = getFilePaths(gltf, url);
      const splatBuffers = await this.fetchBuffers(filePaths, [
        'POSITION',
        'opacity',
        'scale',
        'rotation',
        'sh_band_0',
      ]);
      const shBuffers = await this.fetchBuffers(filePaths, [
        'sh_band_1_0',
        'sh_band_1_1',
        'sh_band_1_2',
        'sh_band_2_0',
        'sh_band_2_1',
        'sh_band_2_2',
        'sh_band_2_3',
        'sh_band_2_4',
        // TODO: higher order bands
      ]);
      const splatCount = this.getSplatCountFromGLTF(gltf);

      return this.loadFromBufferData(splatCount, splatBuffers, shBuffers);
    } catch (error) {
      console.error('Error loading GLTF from URL:', error);
      return null;
    }
  }

  fetch(url) {
    return this.viewer.fetch(url);
  }

  async fetchGLTF(url) {
    try {
      const response = await this.fetch(url);
      return await response.json();
    } catch (error) {
      console.error('Error fetching GLTF:', error);
      return null;
    }
  }

  async fetchBuffers(filePaths, bufferNames) {
    // const componentTypeMap = {
    //     5120: Int8Array,
    //     5121: Uint8Array,
    //     5122: Int16Array,
    //     5123: Uint16Array,
    //     5125: Uint32Array,
    //     5126: Float32Array
    // };

    try {
      const bufferPromises = bufferNames.map(async (name) => {
        const response = await this.fetch(filePaths[name]);
        const buffer = await response.arrayBuffer();

        // TODO: check component type rather than assuming float32
        return { [name]: new Float32Array(buffer) };
      });

      const bufferData = await Promise.all(bufferPromises);
      return Object.assign({}, ...bufferData);
    } catch (error) {
      console.error('Error fetching buffers:', error);
      return {};
    }
  }

  getSplatCountFromGLTF(gltf) {
    try {
      return gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION]
        .count;
    } catch (error) {
      console.error('Error determining splat count:', error);
      return 0;
    }
  }

  async loadFromBufferData(splatCount, splatBuffers, shBuffers = []) {
    return delayedExecute(() =>
      new GLTFParser().parseToUncompressedSplatArray(
        splatCount,
        splatBuffers,
        shBuffers,
      ),
    ).then(finalize);
  }
}
