import * as THREE from 'three';
import { GRID } from './config.js';
import { cellToWorld } from './layout.js';

// Two ground overlays for a model's learning:
//   * Visits  - a colour heatmap (BLUE = least stepped on, RED = most), one quad per tile.
//   * Value   - the per-action Q-values RENDERED AS NUMBERS on each tile (N/S/W/E), drawn
//               onto a single canvas texture mapped over the grid.
// Only one is visible at a time. Fed by /api/values (mode=visits | mode=q).

const N = GRID * GRID;
const dummy = new THREE.Object3D();

// simple BLUE (low) -> RED (high) ramp for the visits heatmap
const STOPS = [
  [0.16, 0.42, 0.92],
  [0.86, 0.21, 0.18],
];
const col = new THREE.Color();
function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  const a = STOPS[0], b = STOPS[1];
  return col.setRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

export function createHeatmap(scene) {
  // ---- colour overlay (Visits) ----
  const geo = new THREE.PlaneGeometry(0.92, 0.92);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.renderOrder = 3;
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  function setGrid(values) {
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
          dummy.scale.setScalar(0);
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

  // ---- numbers overlay (Value): a canvas texture mapped over the whole grid ----
  // canvas (px,py) -> world: x = col (west->east), z = row (north->south). cellToWorld
  // confirms north = small z, so on the canvas north is up and west is left.
  const CW = 2048, CH = 2048;
  const cvs = document.createElement('canvas');
  cvs.width = CW; cvs.height = CH;
  const cctx = cvs.getContext('2d');
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const numMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const numPlane = new THREE.Mesh(new THREE.PlaneGeometry(GRID, GRID), numMat);
  numPlane.rotation.x = -Math.PI / 2;
  numPlane.position.set(GRID / 2, 0.2, GRID / 2);
  numPlane.renderOrder = 4;
  numPlane.visible = false;
  scene.add(numPlane);

  function bestDir(q) {
    let bi = 0, bv = q[0];
    for (let i = 1; i < 4; i++) if (q[i] > bv) { bv = q[i]; bi = i; }
    return bi;
  }

  function setNumbers(grid) {
    cctx.clearRect(0, 0, CW, CH);
    const H = grid.length, W = grid[0] ? grid[0].length : 0;
    const tw = CW / W, th = CH / H;
    const f = Math.round(th * 0.2);
    cctx.textAlign = 'center';
    cctx.textBaseline = 'middle';
    cctx.lineJoin = 'round';
    // dirs: 0=N (top), 1=S (bottom), 2=W (left), 3=E (right). DARK only (no bright
    // fills/halos) so the scene's bloom pass leaves it alone; a thin dark outline
    // keeps it crisp on the light floor without glowing.
    const off = [[0, -th * 0.30], [0, th * 0.30], [-tw * 0.31, 0], [tw * 0.31, 0]];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const q = grid[r] && grid[r][c];
        if (!q) continue;
        const cx = (c + 0.5) * tw, cy = (r + 0.5) * th;
        const best = bestDir(q);
        for (let d = 0; d < 4; d++) {
          const x = cx + off[d][0], y = cy + off[d][1];
          cctx.font = `${d === best ? '800 ' : '600 '}${f}px system-ui,Arial,sans-serif`;
          cctx.lineWidth = Math.max(2, f * 0.2);
          cctx.strokeStyle = 'rgba(12,14,18,0.55)';     // dark edge: crisp, never blooms
          cctx.strokeText(q[d].toFixed(1), x, y);
          cctx.fillStyle = d === best ? '#123fb0' : '#2a2d34';
          cctx.fillText(q[d].toFixed(1), x, y);
        }
      }
    }
    tex.needsUpdate = true;
  }

  return {
    setGrid,
    setNumbers,
    showColors() { mesh.visible = true; numPlane.visible = false; },
    showNumbers() { numPlane.visible = true; mesh.visible = false; },
    hide() { mesh.visible = false; numPlane.visible = false; },
    get visible() { return mesh.visible || numPlane.visible; },
  };
}
