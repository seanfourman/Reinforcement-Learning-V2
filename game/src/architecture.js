import * as THREE from 'three';
import { TILE } from './layout.js';

// Castle interior architecture: the STRUCTURAL walls (room enclosures, the central
// keep wall, the door wall) rendered as smooth PLASTERED wall runs with a stone
// skirting + cornice — not the old grid of identical stone cubes. Isolated
// structural cells (the hall pillars) become round stone columns.
//
// Furniture cells and door cells are NOT drawn here (furniture.js / doors.js do
// those); we're handed the set of furniture cells so we can skip them.

const BASE_Y = 0.16;
const WALL_H = 1.25;
const NON_STRUCT = new Set([
  TILE.FLOOR, TILE.ESCAPE, TILE.RED_KEY, TILE.BLUE_KEY, TILE.GOLD, TILE.GOLD_TRAP,
  TILE.RED_DOOR, TILE.BLUE_DOOR, TILE.RED_SPAWN, TILE.BLUE_SPAWN,
  TILE.PAD1, TILE.PAD2, TILE.ALT_A, TILE.ALT_C,
]);

export function buildArchitecture(world) {
  const group = new THREE.Group();
  const rows = world.rows;
  const size = rows.length;
  const furnSet = new Set((world.furniture || []).map((f) => `${f.cell[0]},${f.cell[1]}`));

  const isStruct = (r, c) =>
    r >= 0 && c >= 0 && r < size && c < size &&
    !NON_STRUCT.has(rows[r][c]) && !furnSet.has(`${r},${c}`);

  // materials: warm plaster body, darker stone skirting + cornice
  const plaster = new THREE.MeshStandardMaterial({ color: 0xe7dcc3, roughness: 0.96 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xb6a890, roughness: 0.92 });
  const colStone = new THREE.MeshStandardMaterial({ color: 0xcabfa6, roughness: 0.9 });
  const disposables = [plaster, stone, colStone];
  const geos = [];
  const geo = (g) => { geos.push(g); return g; };

  const addBox = (w, h, d, x, y, z, m) => {
    const b = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    group.add(b);
    return b;
  };

  // --- classify cells: columns (isolated) vs wall cells ----------------------
  const wallCells = [];
  const colCells = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isStruct(r, c)) continue;
      const connected = isStruct(r - 1, c) || isStruct(r + 1, c) || isStruct(r, c - 1) || isStruct(r, c + 1);
      (connected ? wallCells : colCells).push([r, c]);
    }
  }

  // --- merge wall cells into greedy horizontal runs (long boxes, no cube seams)
  const used = new Set();
  const key = (r, c) => `${r},${c}`;
  const wallSet = new Set(wallCells.map(([r, c]) => key(r, c)));
  for (const [r, c] of wallCells) {
    if (used.has(key(r, c))) continue;
    let len = 1;
    while (wallSet.has(key(r, c + len)) && !used.has(key(r, c + len))) len++;
    // if it's a lone cell, try extending vertically instead (for 1-wide pillars of wall)
    let vert = 1;
    if (len === 1) {
      while (wallSet.has(key(r + vert, c)) && !used.has(key(r + vert, c))) vert++;
    }
    if (len >= vert) {
      for (let i = 0; i < len; i++) used.add(key(r, c + i));
      const cx = c + len / 2, cz = r + 0.5;
      addBox(len * 0.98, WALL_H, 0.98, cx, BASE_Y + WALL_H / 2, cz, plaster);
      addBox(len * 0.98 + 0.06, 0.22, 1.04, cx, BASE_Y + 0.11, cz, stone);     // skirting
      addBox(len * 0.98 + 0.04, 0.1, 1.06, cx, BASE_Y + WALL_H, cz, stone);    // cornice
    } else {
      for (let i = 0; i < vert; i++) used.add(key(r + i, c));
      const cx = c + 0.5, cz = r + vert / 2;
      addBox(0.98, WALL_H, vert * 0.98, cx, BASE_Y + WALL_H / 2, cz, plaster);
      addBox(1.04, 0.22, vert * 0.98 + 0.06, cx, BASE_Y + 0.11, cz, stone);
      addBox(1.06, 0.1, vert * 0.98 + 0.04, cx, BASE_Y + WALL_H, cz, stone);
    }
  }

  // --- stone columns for isolated structural cells (hall pillars) -------------
  const shaftGeo = geo(new THREE.CylinderGeometry(0.32, 0.36, WALL_H + 0.4, 14));
  const baseGeo = geo(new THREE.BoxGeometry(0.8, 0.22, 0.8));
  const capGeo = geo(new THREE.BoxGeometry(0.82, 0.18, 0.82));
  for (const [r, c] of colCells) {
    const x = c + 0.5, z = r + 0.5;
    const base = new THREE.Mesh(baseGeo, stone); base.position.set(x, BASE_Y + 0.11, z);
    const shaft = new THREE.Mesh(shaftGeo, colStone); shaft.position.set(x, BASE_Y + (WALL_H + 0.4) / 2, z);
    const cap = new THREE.Mesh(capGeo, stone); cap.position.set(x, BASE_Y + WALL_H + 0.3, z);
    for (const m of [base, shaft, cap]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  }

  group.userData.dispose = () => { for (const g of geos) g.dispose(); for (const m of disposables) m.dispose(); };
  return group;
}
