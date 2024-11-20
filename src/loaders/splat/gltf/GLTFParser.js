import { clamp } from '../../../Util';
import { UncompressedSplatArray } from '../../UncompressedSplatArray';
import * as THREE from 'three';

export class GLTFParser {
  constructor() {}

  decodeSplatData(splatCount, splatBuffers, shBuffers) {
    // cool to determine the spherical harmonics degree based on the length of shBuffers?
    const shDegree =
      shBuffers.length === 3 ? 1 : shBuffers.length === 8 ? 2 : 0;

    const splatArray = new UncompressedSplatArray(shDegree);

    for (let row = 0; row < splatCount; row++) {
      const newSplat = GLTFParser.parseToUncompressedSplat(
        splatBuffers,
        row,
        shBuffers,
        shDegree,
      );
      splatArray.addSplat(newSplat);
    }
    return splatArray;
  }

  static parseToUncompressedSplat = (function() {
    const tempRotation = new THREE.Quaternion();

    const OFFSET = UncompressedSplatArray.OFFSET;

    const SH_C0 = 0.28209479177387814;

    return function(splatBuffers, row, shBuffers, shDegree) {
      const newSplat = UncompressedSplatArray.createSplat(0);

      // center
      const positions = splatBuffers.POSITION;

      const x = positions[row * 3];
      const y = positions[row * 3 + 1];
      const z = positions[row * 3 + 2];

      newSplat[OFFSET.X] = x;
      newSplat[OFFSET.Y] = y;
      newSplat[OFFSET.Z] = z;

      // scale
      const scales = splatBuffers.scale;

      const sx = Math.exp(scales[row * 3]);
      const sy = Math.exp(scales[row * 3 + 1]);
      const sz = Math.exp(scales[row * 3 + 2]);

      newSplat[OFFSET.SCALE0] = sx;
      newSplat[OFFSET.SCALE1] = sy;
      newSplat[OFFSET.SCALE2] = sz;

      // rotation
      const rotations = splatBuffers.rotation;
      const rx = rotations[row * 4];
      const ry = rotations[row * 4 + 1];
      const rz = rotations[row * 4 + 2];
      const rw = rotations[row * 4 + 3];

      tempRotation.set(rx, ry, rz, rw);
      tempRotation.normalize();

      newSplat[OFFSET.ROTATION0] = tempRotation.x;
      newSplat[OFFSET.ROTATION1] = tempRotation.y;
      newSplat[OFFSET.ROTATION2] = tempRotation.z;
      newSplat[OFFSET.ROTATION3] = tempRotation.w;

      // opacity
      const opacities = splatBuffers.opacity;
      const sh0 = splatBuffers.sh_band_0;

      const opacity = (1 / (1 + Math.exp(-opacities[row]))) * 255;
      newSplat[OFFSET.OPACITY] = clamp(Math.floor(opacity), 0, 255);

      // base color aka. sh degree 0
      const dcx = sh0[row * 3];
      const dcy = sh0[row * 3 + 1];
      const dcz = sh0[row * 3 + 2];

      newSplat[OFFSET.FDC0] = (0.5 + SH_C0 * dcx) * 255;
      newSplat[OFFSET.FDC1] = (0.5 + SH_C0 * dcy) * 255;
      newSplat[OFFSET.FDC2] = (0.5 + SH_C0 * dcz) * 255;

      newSplat[OFFSET.FDC0] = clamp(Math.floor(newSplat[OFFSET.FDC0]), 0, 255);
      newSplat[OFFSET.FDC1] = clamp(Math.floor(newSplat[OFFSET.FDC1]), 0, 255);
      newSplat[OFFSET.FDC2] = clamp(Math.floor(newSplat[OFFSET.FDC2]), 0, 255);

      // first order sh bands
      if (shDegree >= 1) {
        for (let i = 0; i < 9; i++) {
          newSplat[OFFSET[`FRC${i}`]] = shBuffers[row * 3 + i];
        }
        // second order sh bands
        if (shDegree >= 2) {
          for (let i = 9; i < 24; i++) {
            newSplat[OFFSET[`FRC${i}`]] = shBuffers[row * 3 + i];
          }
        }
      }

      return newSplat;
    };
  })();

  parseToUncompressedSplatArray(splatCount, splatBuffers, shBuffers) {
    return this.decodeSplatData(splatCount, splatBuffers, shBuffers);
  }
}
