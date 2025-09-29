// src/controlsvr.js

import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const PINCH_START_DIST = 0.035; // slightly higher for stability
const PINCH_END_DIST   = 0.035;

const ROTATE_Y_SENS    = 3.0;   // yaw sensitivity
const ROTATE_X_SENS    = 3.0;   // pitch sensitivity
const SCALE_SENS       = 2.0;   // scale sensitivity

const EXIT_MARGIN_Y    = 0.15;  // ~15cm above head to exit
const DEADZONE_M       = 0.03;  // 3cm per-axis deadzone

export function setupVRHandControls({ renderer, camera, scene, onApplyTransform, onExitVR }) {
  if (!renderer?.xr) return { onFrame() {}, dispose() {} };

  const xr = renderer.xr;
  const factory = new XRHandModelFactory();

  const hands = [null, null];
  const infos = [null, null];
  let inSession = false;

  function makeHand(i) {
    let hand;
    try { hand = xr.getHand(i); } catch { return null; }
    if (!hand) return null;

    try {
      const model = factory.createHandModel(hand, 'mesh');
      hand.add(model);
    } catch {}

    if (scene && hand.parent !== scene) scene.add(hand);

    const info = {
      isPinching: false,
      pinchStartRef: new THREE.Vector3(),
      pinchStartHeadZ: 0, // head-local Z at pinch start

      // baseline model transform at pinch start
      startYaw: 0,
      startPitch: 0,
      startScale: 1,

      wrist: null,
      thumbTip: null,
      indexTip: null
    };

    hand.addEventListener('connected', () => {
      const j = hand.joints || {};
      info.wrist    = j['wrist'] || null;
      info.thumbTip = j['thumb-tip'] || null;
      info.indexTip = j['index-finger-tip'] || null;
    });

    hands[i] = hand;
    infos[i] = info;
    return hand;
  } // end makeHand

  function removeHand(i) {
    const hand = hands[i];
    if (hand && hand.parent) {
      try { hand.parent.remove(hand); } catch {}
    }
    hands[i] = null;
    infos[i] = null;
  }

  function onSessionStart() {
    inSession = true;
    makeHand(0);
    makeHand(1);
    for (const info of infos) if (info) info.isPinching = false;
  }

  function onSessionEnd() {
    inSession = false;
    for (let i = 0; i < 2; i++) removeHand(i);
  }

  xr.addEventListener('sessionstart', onSessionStart);
  xr.addEventListener('sessionend', onSessionEnd);

  // Re-usable math
  const headPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function onFrame(frame, targetGroup) {
    if (!inSession || !frame) return;
    if (!targetGroup) return; // must pass the model's group from caller

    camera.getWorldPosition(headPos);
    const rightIndex = getRightHandIndex(hands, camera);

    for (let i = 0; i < 2; i++) {
      const hand = hands[i];
      const info = infos[i];
      if (!hand || !info) continue;

      // Ensure joints available, try lazy fallback
      if (!info.wrist || !info.thumbTip || !info.indexTip) {
        const j = hand.joints || {};
        info.wrist    = info.wrist    || j['wrist'] || null;
        info.thumbTip = info.thumbTip || j['thumb-tip'] || null;
        info.indexTip = info.indexTip || j['index-finger-tip'] || null;
        if (!info.wrist || !info.thumbTip || !info.indexTip) continue;
      }

      // Exit gesture: raise any wrist above head
      const wristPos = getWorldPos(info.wrist);
      if (wristPos && wristPos.y > headPos.y + EXIT_MARGIN_Y) {
        try {
          const s = xr.getSession();
          if (s) s.end();
          else if (onExitVR) onExitVR();
        } catch {
          if (onExitVR) onExitVR();
        }
        continue; // do not process further gestures for this hand this frame
      }

      // Only right hand manipulates (keeps accidental double-control down)
      if (i !== rightIndex) {
        info.isPinching = false;
        continue;
      }

      const tPos = getWorldPos(info.thumbTip);
      const iPos = getWorldPos(info.indexTip);
      if (!tPos || !iPos) continue;

      const pinchDist = tPos.distanceTo(iPos);

      // Pinch start: store stable baselines
      if (!info.isPinching && pinchDist < PINCH_START_DIST) {
        info.isPinching = true;

        // Store pinch start in head-local
        const startMid = tmp.copy(tPos).add(iPos).multiplyScalar(0.5);
        info.pinchStartRef.copy(startMid);
        info.pinchStartHeadZ = worldToHeadLocal(camera, startMid).z;

        // Store model baseline yaw/pitch/scale (from targetGroup)
        const e = new THREE.Euler().setFromQuaternion(targetGroup.quaternion, 'YXZ');
        info.startYaw   = e.y;
        info.startPitch = e.x;
        info.startScale = targetGroup.scale.x || 1;
      }

      // During pinch: compute deltas and apply
      if (info.isPinching) {
        const mid = tmp.copy(tPos).add(iPos).multiplyScalar(0.5);

        const headStart = worldToHeadLocal(camera, info.pinchStartRef);
        const headNow   = worldToHeadLocal(camera, mid);

        // Raw deltas (head-local)
        let dx = headNow.x - headStart.x; // +right
        let dy = headNow.y - headStart.y; // +up
        let dz = headNow.z - info.pinchStartHeadZ; // +back (negative when moving forward)

        // Apply 3cm deadzone per axis with re-centering beyond the deadzone
        dx = applyDeadzone(dx, DEADZONE_M);
        dy = applyDeadzone(dy, DEADZONE_M);
        dz = applyDeadzone(dz, DEADZONE_M);

        // Flip all gesture axes as you had previously
        dx = -dx; // invert left-right -> yaw direction
        dy = -dy; // invert up-down -> pitch direction
        dz = -dz; // invert forward/back -> scale response

        // Map drag to absolute yaw/pitch deltas
        let yawAbs   = info.startYaw   + (-dx * ROTATE_Y_SENS);
        let pitchAbs = info.startPitch + ( dy * ROTATE_X_SENS);

        // Clamp pitch to avoid flipping over top/bottom
        const MIN_PITCH = -Math.PI/2 + 0.01;
        const MAX_PITCH =  Math.PI/2 - 0.01;
        const pitchClamped = THREE.MathUtils.clamp(pitchAbs, MIN_PITCH, MAX_PITCH);

        // Compute scale as before
        const scaleAbs = THREE.MathUtils.clamp(
          info.startScale * Math.exp(-dz * SCALE_SENS),
          0.05, 10.0
        );

        // Send absolute yaw/pitch/scale to caller; caller will construct orbit quaternion
        if (onApplyTransform) onApplyTransform(yawAbs, pitchClamped, scaleAbs);

        // End pinch if released
        if (pinchDist > PINCH_END_DIST) {
          info.isPinching = false;
        }
      }
    }
  } // end onFrame

  function dispose() {
    xr.removeEventListener('sessionstart', onSessionStart);
    xr.removeEventListener('sessionend', onSessionEnd);
    onSessionEnd();
  }

  return { onFrame, dispose };

  // Helpers

  function getWorldPos(obj) {
    try { const v = new THREE.Vector3(); obj.getWorldPosition(v); return v; } catch { return null; }
  }

  function worldToHeadLocal(camera, worldVec) {
    const inv = new THREE.Matrix4().copy(camera.matrixWorld).invert();
    return worldVec.clone().applyMatrix4(inv);
  }

  function getRightHandIndex(hands, camera) {
    const head = new THREE.Vector3(); camera.getWorldPosition(head);
    let best = 1, bestX = -Infinity;
    for (let i = 0; i < 2; i++) {
      const wrist = hands[i]?.joints?.['wrist']; if (!wrist) continue;
      const p = getWorldPos(wrist); if (!p) continue;
      const relX = p.x - head.x;
      if (relX > bestX) { bestX = relX; best = i; }
    }
    return best;
  }
}

// Deadzone helper: zero inside [-dz,+dz]; re-center outside so motion begins after the threshold.
function applyDeadzone(value, dz) {
  if (Math.abs(value) <= dz) return 0;
  return value > 0 ? value - dz : value + dz;
}
