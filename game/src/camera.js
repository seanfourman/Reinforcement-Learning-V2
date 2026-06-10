import * as THREE from 'three';
import { CAMERA, GRID } from './config.js';

// Fixed-angle camera rig like the reference: high pitch, axis-aligned.
// Only the look-at target pans (clamped a little past the grid) and the
// distance zooms. Everything is smoothed so it feels buttery.

export function createCameraRig(camera, dom) {
  const target = new THREE.Vector3(GRID / 2, 0, GRID / 2 + 1);
  const goal = target.clone();
  let dist = CAMERA.startDist;
  let distGoal = dist;

  // Clamp the *visible* ground footprint, not just the look-at point: the
  // edge of the screen may reach at most panMargin units past the outer
  // walls, no matter the zoom level or window shape.
  const halfFov = THREE.MathUtils.degToRad(CAMERA.fov / 2);
  const B0 = -1 - CAMERA.panMargin; // outer walls sit at -1 and GRID+1
  const B1 = GRID + 1 + CAMERA.panMargin;
  const clampGoal = () => {
    distGoal = THREE.MathUtils.clamp(distGoal, CAMERA.minDist, CAMERA.maxDist);
    const p = CAMERA.pitch;
    const h = distGoal * Math.sin(p);
    const halfW = distGoal * Math.tan(halfFov) * camera.aspect;
    const farZ = h / Math.tan(p - halfFov) - h / Math.tan(p); // ground seen above the target
    const nearZ = h / Math.tan(p) - h / Math.tan(p + halfFov); // ground seen below it
    const c = GRID / 2;
    // sides: footprint clamp, but never tighter than ±minSidePan of drift
    const loX = Math.min(B0 + halfW, c - CAMERA.minSidePan);
    const hiX = Math.max(B1 - halfW, c + CAMERA.minSidePan);
    // top gets a little extra reach; bottom stays exact
    const loZ = Math.min(B0 + farZ - CAMERA.topReach, c - CAMERA.minSidePan);
    const hiZ = Math.max(B1 - nearZ, c + CAMERA.minSidePan);
    goal.x = THREE.MathUtils.clamp(goal.x, loX, hiX);
    goal.z = THREE.MathUtils.clamp(goal.z, loZ, hiZ);
  };

  // --- mouse drag pan -------------------------------------------------------
  let dragging = false;
  let lastX = 0, lastY = 0;
  dom.addEventListener('pointerdown', (e) => {
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    }
  });
  dom.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const f = (dist * 1.35) / dom.clientHeight;
    goal.x -= (e.clientX - lastX) * f;
    goal.z -= ((e.clientY - lastY) * f) / Math.sin(CAMERA.pitch);
    lastX = e.clientX;
    lastY = e.clientY;
    clampGoal();
  });
  dom.addEventListener('pointerup', () => (dragging = false));
  dom.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- wheel zoom -----------------------------------------------------------
  dom.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      distGoal *= Math.pow(1.0014, e.deltaY);
      clampGoal();
    },
    { passive: false }
  );

  // --- keyboard pan -----------------------------------------------------------
  const keys = new Set();
  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  function update(dt) {
    const speed = dist * 0.65 * dt;
    if (keys.has('KeyW') || keys.has('ArrowUp')) goal.z -= speed;
    if (keys.has('KeyS') || keys.has('ArrowDown')) goal.z += speed;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) goal.x -= speed;
    if (keys.has('KeyD') || keys.has('ArrowRight')) goal.x += speed;
    clampGoal();

    const k = 1 - Math.exp(-dt * 9);
    target.lerp(goal, k);
    dist += (distGoal - dist) * k;

    camera.position.set(
      target.x,
      target.y + Math.sin(CAMERA.pitch) * dist,
      target.z + Math.cos(CAMERA.pitch) * dist
    );
    camera.lookAt(target);
  }

  return { update, target };
}
