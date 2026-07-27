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

  // ---- POLICY ARROWS (3D): ONE crisp arrow design used for BOTH the floor policy AND
  // the raised ghost (through-wall) policy, so they look identical. Flat extruded arrows
  // laid on the ground; floor arrows sit low, ghost arrows float above the walls (only
  // while an agent is phasing). Both point in true WORLD directions (self-correct under
  // the camera flip, matching the agent's actual moves).
  const PMAX = 520;
  const TEAM = { red: 0xe23a2c, blue: 0x2f6bff };    // arrow colour follows the viewed policy
  // a slim, small arrow (thinner shaft + head than before)
  const _aShape = new THREE.Shape();
  _aShape.moveTo(-0.24, -0.045); _aShape.lineTo(0.05, -0.045); _aShape.lineTo(0.05, -0.12);
  _aShape.lineTo(0.30, 0);       _aShape.lineTo(0.05, 0.12);   _aShape.lineTo(0.05, 0.045);
  _aShape.lineTo(-0.24, 0.045);  _aShape.closePath();
  const arrowGeo = new THREE.ExtrudeGeometry(_aShape, { depth: 0.05, bevelEnabled: false });
  arrowGeo.rotateX(-Math.PI / 2);                    // lay flat, arrow pointing +X (world)
  // OPAQUE + depthTest ON: the arrows are real world objects, so a wall IN FRONT hides
  // the floor ones (they read as on-the-ground entities), not a flat sheet over the scene.
  const arrowMat = new THREE.MeshBasicMaterial({ color: TEAM.blue });
  const YAW = [Math.PI / 2, -Math.PI / 2, Math.PI, 0]; // N,S,W,E -> yaw so +X points that way
  const adummy = new THREE.Object3D();
  const mkArrows = () => {
    const m = new THREE.InstancedMesh(arrowGeo, arrowMat, PMAX);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.visible = false; m.count = 0;
    scene.add(m);
    return m;
  };
  const farrows = mkArrows();   // floor policy (on the ground, occluded by walls)
  const garrows = mkArrows();   // ghost policy raised above the walls (only while phasing)
  function _setTeam(agent) { if (TEAM[agent] != null) arrowMat.color.setHex(TEAM[agent]); }
  function _placeArrows(mesh, cells, y) {
    const s = 0.82 * getCell();  // a bit smaller
    let i = 0;
    for (const cell of cells || []) {
      if (i >= PMAX) break;
      const [r, c, act] = cell;
      const w = cellToWorld(r, c);
      adummy.position.set(w.x, y, w.z);
      adummy.rotation.set(0, YAW[act] || 0, 0);
      adummy.scale.setScalar(s);
      adummy.updateMatrix();
      mesh.setMatrixAt(i++, adummy.matrix);
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = i > 0;
    return i;
  }
  function setGhostArrows(list, agent) { _setTeam(agent); _placeArrows(garrows, list, 1.12); }

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

  const TEAM_CSS = { red: '#e23a2c', blue: '#2f6bff' }; // greedy number colour, per agent
  function setNumbers(grid, bestGrid, agent) {
    placePlane(); // scale + board slide so the numbers sit on the tiles
    const teamFill = TEAM_CSS[agent] || '#123fb0'; // the GREEDY action's number, agent-coloured
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
          cctx.fillStyle = d === best ? teamFill : '#2a2d34';
          putText(q[d].toFixed(1), x, y);
        }
      }
    }
    tex.needsUpdate = true;
  }

  // ---- greedy-policy ARROWS (per-cell argmax action) on the same canvas plane ----
  // grid[r][c] = 0=N,1=S,2=W,3=E, or null. Fed by /api/values?mode=policy.
  const PDIR = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // N,S,W,E in canvas (x right, y down)
  function setPolicy(grid, agent) {
    _setTeam(agent);
    // floor policy as the SAME 3D arrows as the ghost/wall arrows, laid low on the ground
    const cells = [];
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const a = row[c];
        if (a !== null && a !== undefined) cells.push([r, c, a]);
      }
    }
    _placeArrows(farrows, cells, 0.1);
  }

  return {
    setGrid,
    setNumbers,
    setPolicy,
    setFlip,
    setArenaField,
    setGhostArrows,
    showColors() { mesh.visible = true; numPlane.visible = false; amesh.visible = false; farrows.visible = false; setGhostArrows([]); },
    showNumbers() { numPlane.visible = true; mesh.visible = false; amesh.visible = false; farrows.visible = false; setGhostArrows([]); },
    showPolicy() { farrows.visible = farrows.count > 0; numPlane.visible = false; mesh.visible = false; amesh.visible = false; },
    showArena() { amesh.visible = true; mesh.visible = false; numPlane.visible = false; farrows.visible = false; setGhostArrows([]); },
    hide() { mesh.visible = false; numPlane.visible = false; amesh.visible = false; farrows.visible = false; setGhostArrows([]); },
    get visible() { return mesh.visible || numPlane.visible || amesh.visible || farrows.visible; },
  };
}
