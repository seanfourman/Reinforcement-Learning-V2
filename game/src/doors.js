import * as THREE from 'three';
import { cellToWorld } from './layout.js';

// Wooden arched doors. Two kinds:
//   * EXIT doors (the 'D'/'d' tiles, in the row-12 wall) - key-locked: they swing
//     open once their owner holds that colored key (frame.redKey / blueKey).
//   * ROOM doors (world.roomDoors, in the bedroom side walls) - open on CONTACT:
//     they swing open whenever an agent is on/next to them, so you just walk in.
//
// The arch is modelled in the XY plane facing +Z (fits a horizontal E-W wall);
// doors set in a vertical N-S wall are rotated 90°.

const FLOOR_Y = 0.16;
const DOOR_W = 1.0;
const DOOR_H = 1.15;
// Each key-locked exit door wears its key's colour, so it's obvious which key
// opens which: red key -> red door, blue key -> blue door.
const SIDE_TINT = { red: 0xff4036, blue: 0x439bff };

export function createDoors(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const geos = [];
  const mats = [];
  const G = (g) => { geos.push(g); return g; };
  const M = (m) => { mats.push(m); return m; };
  const stoneMat = M(new THREE.MeshStandardMaterial({ color: 0xc3b298, roughness: 0.95 }));
  const oakMat = M(new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.85 }));
  const ironMat = M(new THREE.MeshStandardMaterial({ color: 0x33302b, roughness: 0.55, metalness: 0.45 }));

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

  // Coloured aura for the key-locked doors: a floor ring + arch halo + a thin
  // light column + a slowly spinning keystone gem + a tinted point light. It
  // pulses gently while locked and flares bright as the door swings open.
  function buildGlow(parent, tint) {
    const ringMat = M(new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const ring = new THREE.Mesh(G(new THREE.RingGeometry(0.6, 0.96, 36)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.03, 0.34);          // nudged to the approach (south) side
    parent.add(ring);

    const haloMat = M(new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const halo = new THREE.Mesh(archGeo, haloMat);
    halo.scale.set(1.14, 1.08, 1);
    halo.position.set(0, 0, -0.42);
    parent.add(halo);

    const beamMat = M(new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const beam = new THREE.Mesh(G(new THREE.CylinderGeometry(0.52, 0.64, 2.4, 18, 1, true)), beamMat);
    beam.position.set(0, 1.3, 0);
    parent.add(beam);

    const gemMat = M(new THREE.MeshStandardMaterial({
      color: tint, emissive: tint, emissiveIntensity: 1.0, roughness: 0.2, metalness: 0.1,
    }));
    const gem = new THREE.Mesh(G(new THREE.OctahedronGeometry(0.12, 0)), gemMat);
    gem.position.set(0, 1.2, 0.02);            // keystone of the arch
    gem.rotation.x = 0.35;
    parent.add(gem);

    const light = new THREE.PointLight(tint, 0.8, 5.5, 2);
    light.position.set(0, 1.0, 0.3);
    parent.add(light);
    return { ringMat, haloMat, beamMat, gemMat, gem, light };
  }

  function buildDoor(cell, rotY, tint = null) {
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
    const glow = tint !== null ? buildGlow(d, tint) : null;
    return { hinges, open: 0, glow };
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
  if (world.redDoor) exit.push({ ...buildDoor(world.redDoor, rotFor(world.redDoor), SIDE_TINT.red), side: 'red' });
  if (world.blueDoor) exit.push({ ...buildDoor(world.blueDoor, rotFor(world.blueDoor), SIDE_TINT.blue), side: 'blue' });

  const roomDoors = (world.roomDoors || []).map((cell) => ({
    ...buildDoor(cell, rotFor(cell)), world: cellToWorld(cell[0], cell[1]),
  }));

  function swing(dr, wantOpen) {
    dr.open += ((wantOpen ? 1 : 0) - dr.open) * 0.18;
    for (const h of dr.hinges) h.hinge.rotation.y = h.sgn * dr.open * (Math.PI * 0.6);
  }

  function update(frame, t = 0) {
    if (!frame) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.0);
    for (const dr of exit) {
      const held = (dr.side === 'red' && frame.redKey) || (dr.side === 'blue' && frame.blueKey);
      swing(dr, held);
      if (dr.glow) {
        // dim, slow pulse while locked; flares to full as the door opens
        const lvl = (0.32 + 0.22 * pulse) + dr.open * 0.7;
        const g = dr.glow;
        g.light.intensity = 0.5 + lvl * 3.4;
        g.ringMat.opacity = 0.16 + lvl * 0.5;
        g.haloMat.opacity = 0.1 + lvl * 0.34;
        g.beamMat.opacity = 0.035 + lvl * 0.16;
        g.gemMat.emissiveIntensity = 0.6 + lvl * 1.6;
        g.gem.rotation.y += 0.05;
      }
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
