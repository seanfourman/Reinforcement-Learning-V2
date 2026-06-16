import * as THREE from 'three';
import { cellToWorld } from './layout.js';

// Wooden arched doors. Two kinds:
//   * EXIT doors (the 'D'/'d' tiles, in the row-12 wall) — key-locked: they swing
//     open once their owner holds that colored key (frame.redKey / blueKey).
//   * ROOM doors (world.roomDoors, in the bedroom side walls) — open on CONTACT:
//     they swing open whenever an agent is on/next to them, so you just walk in.
//
// The arch is modelled in the XY plane facing +Z (fits a horizontal E-W wall);
// doors set in a vertical N-S wall are rotated 90°.

const FLOOR_Y = 0.16;
const DOOR_W = 1.0;
const DOOR_H = 1.15;

export function createDoors(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const geos = [];
  const G = (g) => { geos.push(g); return g; };
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xc3b298, roughness: 0.95 });
  const oakMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.85 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x33302b, roughness: 0.55, metalness: 0.45 });
  const mats = [stoneMat, oakMat, ironMat];

  function archShape() {
    const s = new THREE.Shape();
    const hw = DOOR_W / 2 + 0.16;
    s.moveTo(-hw, 0);
    s.lineTo(-hw, DOOR_H);
    s.absarc(0, DOOR_H, hw, Math.PI, 0, true);
    s.lineTo(hw, 0);
    s.lineTo(hw - 0.16, 0);
    s.lineTo(hw - 0.16, DOOR_H);
    s.absarc(0, DOOR_H, DOOR_W / 2, 0, Math.PI, false);
    s.lineTo(-hw + 0.16, 0);
    s.closePath();
    return s;
  }
  const archGeo = G(new THREE.ExtrudeGeometry(archShape(), { depth: 0.7, bevelEnabled: false }));
  const leafGeo = G(new THREE.BoxGeometry(DOOR_W / 2, DOOR_H * 1.0 + 0.2, 0.09));
  const bandGeo = G(new THREE.BoxGeometry(DOOR_W / 2, 0.07, 0.12));

  function buildDoor(cell, rotY) {
    const d = new THREE.Group();
    const { x, z } = cellToWorld(cell[0], cell[1]);
    d.position.set(x, FLOOR_Y, z);
    d.rotation.y = rotY;
    const frame = new THREE.Mesh(archGeo, stoneMat);
    frame.position.z = -0.35;
    frame.castShadow = frame.receiveShadow = true;
    d.add(frame);
    const hinges = [];
    for (const sgn of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(sgn * (DOOR_W / 2), 0, 0);
      const leaf = new THREE.Mesh(leafGeo, oakMat);
      leaf.position.set(-sgn * (DOOR_W / 4), (DOOR_H + 0.2) / 2, 0);
      leaf.castShadow = true;
      hinge.add(leaf);
      for (const by of [0.32, 0.86]) {
        const band = new THREE.Mesh(bandGeo, ironMat);
        band.position.set(-sgn * (DOOR_W / 4), by, 0);
        hinge.add(band);
      }
      d.add(hinge);
      hinges.push({ hinge, sgn });
    }
    group.add(d);
    return { hinges, open: 0 };
  }

  // orient each door from the wall it sits in: a horizontal wall (solid left &
  // right) -> faces N/S (rotY 0); a vertical wall (solid up & down) -> rotY 90°.
  const rows = world.rows;
  const isWall = (r, c) => rows[r] && (rows[r][c] === '#');
  const rotFor = (cell) => {
    const [r, c] = cell;
    if (isWall(r - 1, c) && isWall(r + 1, c)) return Math.PI / 2; // vertical wall
    return 0;                                                     // horizontal wall
  };

  const exit = [];
  if (world.redDoor) exit.push({ ...buildDoor(world.redDoor, rotFor(world.redDoor)), side: 'red' });
  if (world.blueDoor) exit.push({ ...buildDoor(world.blueDoor, rotFor(world.blueDoor)), side: 'blue' });

  const roomDoors = (world.roomDoors || []).map((cell) => ({
    ...buildDoor(cell, rotFor(cell)), world: cellToWorld(cell[0], cell[1]),
  }));

  function swing(dr, wantOpen) {
    dr.open += ((wantOpen ? 1 : 0) - dr.open) * 0.18;
    for (const h of dr.hinges) h.hinge.rotation.y = h.sgn * dr.open * (Math.PI * 0.6);
  }

  function update(frame) {
    if (!frame) return;
    for (const dr of exit) {
      swing(dr, (dr.side === 'red' && frame.redKey) || (dr.side === 'blue' && frame.blueKey));
    }
    // room doors open when an agent is on/adjacent
    const ag = [cellToWorld(frame.red[0], frame.red[1]), cellToWorld(frame.blue[0], frame.blue[1])];
    for (const dr of roomDoors) {
      const near = ag.some((p) => Math.hypot(p.x - dr.world.x, p.z - dr.world.z) <= 1.4);
      swing(dr, near);
    }
  }

  function dispose() {
    scene.remove(group);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  }

  return { group, update, dispose };
}
