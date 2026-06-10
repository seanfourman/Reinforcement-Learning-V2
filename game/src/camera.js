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

  const lo = -CAMERA.panMargin;
  const hi = GRID + CAMERA.panMargin;
  const clampGoal = () => {
    goal.x = THREE.MathUtils.clamp(goal.x, lo, hi);
    goal.z = THREE.MathUtils.clamp(goal.z, lo, hi);
    distGoal = THREE.MathUtils.clamp(distGoal, CAMERA.minDist, CAMERA.maxDist);
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
