import * as THREE from 'three';
import { GRID } from './config.js';
import { cellToWorld } from './layout.js';

// Value-function heatmap overlay: one translucent quad per tile, tinted by the
// agent's learned V(s) = max_a Q for that tile in the current situation. This is
// literally "what has this model learned about standing here". Fed by
// /api/values; click a tile to inspect per-action Q (the panel shows it).

const N = GRID * GRID;
const dummy = new THREE.Object3D();

// low -> high value ramp (indigo -> teal -> green -> amber -> red)
const STOPS = [
  [0.20, 0.10, 0.45],
  [0.10, 0.55, 0.65],
  [0.30, 0.80, 0.35],
  [0.95, 0.80, 0.25],
  [0.95, 0.25, 0.25],
];
const col = new THREE.Color();
function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  const f = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(f));
  const k = f - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return col.setRGB(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
}

export function createHeatmap(scene) {
  const geo = new THREE.PlaneGeometry(0.92, 0.92);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.renderOrder = 3;
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  function setGrid(values) {
    // values: H x W array, null on walls / unvisited tiles
    let lo = Infinity, hi = -Infinity;
    for (const row of values) for (const v of row) {
      if (v === null || v === undefined) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;
    let i = 0;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const v = (values[r] && values[r][c]);
        if (v === null || v === undefined) {
          dummy.scale.setScalar(0); // hide walls / unlearned cells
        } else {
          const { x, z } = cellToWorld(r, c);
          dummy.position.set(x, 0.19, z);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.setScalar(1);
          mesh.setColorAt(i, ramp((v - lo) / span));
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    setGrid,
    show() { mesh.visible = true; },
    hide() { mesh.visible = false; },
    get visible() { return mesh.visible; },
  };
}
