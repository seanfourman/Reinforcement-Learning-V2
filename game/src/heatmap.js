import * as THREE from 'three';
import { GRID } from './config.js';
import { cellToWorld, getCell, getOffset } from './layout.js';

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

  // ---- CONTINUOUS-arena value field: an n x n colour grid sampled from the DQN
  // over the arena (raw world x,z, the space the agents move in). Fed by /api/field.
  const AMAX = 40 * 40;
  const amesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }), AMAX);
  amesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  amesh.renderOrder = 3;
  amesh.visible = false;
  amesh.frustumCulled = false;
  scene.add(amesh);

  function setArenaField(field) {
    const n = field.n, A = field.arena, val = field.value;
    const lo = field.vmin, span = (field.vmax - field.vmin) || 1;
    const cell = (A / n) * 0.98;
    let i = 0;
    for (let j = 0; j < n && i < AMAX; j++) {
      for (let k = 0; k < n && i < AMAX; k++) {
        const v = val[j][k];
        if (v == null) {
          dummy.scale.setScalar(0);
        } else {
          dummy.position.set((k + 0.5) / n * A, 0.2, (j + 0.5) / n * A);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.set(cell, cell, 1);
          amesh.setColorAt(i, ramp((v - lo) / span));
        }
        dummy.updateMatrix();
        amesh.setMatrixAt(i, dummy.matrix);
        i++;
      }
    }
    amesh.count = i;
    amesh.instanceMatrix.needsUpdate = true;
    if (amesh.instanceColor) amesh.instanceColor.needsUpdate = true;
  }

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
          dummy.scale.setScalar(getCell());
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

  // peach views the board from the FAR (flipped) side, so the number/arrow texture
  // reads upside-down there; setFlip lets the overlays draw glyphs upright.
  let flip = false;
  function setFlip(f) { flip = !!f; }

  // sit the overlay plane exactly on the board: scale with the cell size AND apply
  // the per-round board slide (getOffset), which the fixed centre used to ignore -
  // that offset is why peach's numbers landed off the tiles.
  function placePlane() {
    const [ox, oz] = getOffset();
    numPlane.scale.setScalar(getCell());
    numPlane.position.set(GRID / 2 + ox, 0.2, GRID / 2 + oz);
  }

  // the TRUE greedy action over the 4 move directions (N,S,W,E)
  function bestAction(q) {
    let bi = 0, bv = q[0];
    for (let i = 1; i < q.length; i++) if (q[i] > bv) { bv = q[i]; bi = i; }
    return bi;
  }

  // draw one number at (x,y). On a flipped board the whole texture is seen
  // upside-down, so spin the GLYPH 180 about its anchor - it keeps its N/S/W/E
  // slot (greedy stays toward the goal) but reads upright.
  function putText(txt, x, y) {
    if (flip) {
      cctx.save();
      cctx.translate(x, y);
      cctx.rotate(Math.PI);
      cctx.strokeText(txt, 0, 0);
      cctx.fillText(txt, 0, 0);
      cctx.restore();
    } else {
      cctx.strokeText(txt, x, y);
      cctx.fillText(txt, x, y);
    }
  }

  function setNumbers(grid, bestGrid) {
    placePlane(); // scale + board slide so the numbers sit on the tiles
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
        // prefer the server's MASKED best (matches the policy arrows + the agent);
        // fall back to a raw argmax only if it wasn't provided (older cache)
        const brow = bestGrid && bestGrid[r];
        const best = (brow && brow[c] != null) ? brow[c] : bestAction(q);
        for (let d = 0; d < 4; d++) {
          const x = cx + off[d][0], y = cy + off[d][1];
          cctx.font = `${d === best ? '800 ' : '600 '}${f}px system-ui,Arial,sans-serif`;
          cctx.lineWidth = Math.max(2, f * 0.2);
          cctx.strokeStyle = 'rgba(12,14,18,0.55)';     // dark edge: crisp, never blooms
          cctx.fillStyle = d === best ? '#123fb0' : '#2a2d34';
          putText(q[d].toFixed(1), x, y);
        }
      }
    }
    tex.needsUpdate = true;
  }

  // ---- greedy-policy ARROWS (per-cell argmax action) on the same canvas plane ----
  // grid[r][c] = 0=N,1=S,2=W,3=E, or null. Fed by /api/values?mode=policy.
  const PDIR = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // N,S,W,E in canvas (x right, y down)
  function setPolicy(grid) {
    placePlane(); // scale + board slide (arrows self-orient under the flip, so no glyph spin)
    cctx.clearRect(0, 0, CW, CH);
    const H = grid.length, W = grid[0] ? grid[0].length : 0;
    const tw = CW / W, th = CH / H;
    const L = Math.min(tw, th) * 0.30;
    cctx.lineCap = 'round';
    cctx.lineJoin = 'round';
    cctx.fillStyle = '#123fb0';
    cctx.strokeStyle = '#123fb0';
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const a = grid[r] && grid[r][c];
        if (a === null || a === undefined) continue;
        const cx = (c + 0.5) * tw, cy = (r + 0.5) * th;
        const [dx, dy] = PDIR[a];
        const ex = cx + dx * L, ey = cy + dy * L;
        cctx.lineWidth = Math.max(4, L * 0.26);
        cctx.beginPath();
        cctx.moveTo(cx - dx * L, cy - dy * L);
        cctx.lineTo(ex, ey);
        cctx.stroke();
        const hw = L * 0.55, px = -dy, py = dx; // perpendicular for the head
        cctx.beginPath();
        cctx.moveTo(ex, ey);
        cctx.lineTo(ex - dx * hw + px * hw * 0.6, ey - dy * hw + py * hw * 0.6);
        cctx.lineTo(ex - dx * hw - px * hw * 0.6, ey - dy * hw - py * hw * 0.6);
        cctx.closePath();
        cctx.fill();
      }
    }
    tex.needsUpdate = true;
  }

  return {
    setGrid,
    setNumbers,
    setPolicy,
    setFlip,
    setArenaField,
    showColors() { mesh.visible = true; numPlane.visible = false; amesh.visible = false; },
    showNumbers() { numPlane.visible = true; mesh.visible = false; amesh.visible = false; },
    showArena() { amesh.visible = true; mesh.visible = false; numPlane.visible = false; },
    hide() { mesh.visible = false; numPlane.visible = false; amesh.visible = false; },
    get visible() { return mesh.visible || numPlane.visible || amesh.visible; },
  };
}
