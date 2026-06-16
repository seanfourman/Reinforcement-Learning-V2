import * as THREE from 'three';
import { cellToWorld } from './layout.js';

// 3D for the interactive mechanics the agents learn around:
//   * teleporter mirrors — a glowing rune portal; step on one, warp to its twin
//   * lever            — a wall-style pull lever; pulling it toggles the trap
//   * snare trap       — floor spikes that rise + glow red when the lever arms it
//
// createMechanics(scene, world) reads the static world JSON to build everything,
// then update(frame, t) animates shimmer and reflects the live trapArmed state.

const FLOOR_Y = 0.16;

export function createMechanics(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const mirrors = [];
  const levers = [];
  const traps = [];
  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };

  const place = (obj, cell, y = 0) => {
    const { x, z } = cellToWorld(cell[0], cell[1]);
    obj.position.set(x, y, z);
  };

  // ----------------------------------------------------------- teleporters
  const MIRROR_TINT = [0x57e6c8, 0xc58bff]; // each pair gets its own hue
  (world.mirrors || []).forEach(([a, b], pi) => {
    const tint = MIRROR_TINT[pi % MIRROR_TINT.length];
    for (const cell of [a, b]) mirrors.push(buildMirror(cell, tint));
  });

  function buildMirror(cell, tint) {
    const g = new THREE.Group();
    const ringMat = track(new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.9 }));
    const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.36, 0.07, 12, 28)), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = FLOOR_Y + 0.06;
    ring.castShadow = true;
    g.add(ring);
    const discMat = track(new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const disc = new THREE.Mesh(track(new THREE.CircleGeometry(0.33, 28)), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = FLOOR_Y + 0.08;
    g.add(disc);
    // a thin column of light so the portal reads from across the map
    const beamMat = track(new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.12, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const beam = new THREE.Mesh(track(new THREE.CylinderGeometry(0.26, 0.3, 2.2, 16, 1, true)), beamMat);
    beam.position.y = FLOOR_Y + 1.2;
    g.add(beam);
    // a couple of slow-spinning shards above the pad
    const shardMat = track(new THREE.MeshStandardMaterial({
      color: tint, emissive: tint, emissiveIntensity: 0.9, roughness: 0.2, flatShading: true,
    }));
    const shards = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.09, 0)), shardMat);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.22, FLOOR_Y + 0.55, Math.sin(a) * 0.22);
      shards.add(s);
    }
    g.add(shards);
    const light = new THREE.PointLight(tint, 1.0, 4, 2);
    light.position.set(0, FLOOR_Y + 0.6, 0);
    g.add(light);
    place(g, cell);
    group.add(g);
    return { disc, beam, shards, light, discMat, beamMat };
  }

  // ----------------------------------------------------------------- levers
  for (const cell of world.levers || []) levers.push(buildLever(cell));

  function buildLever(cell) {
    const g = new THREE.Group();
    const stone = track(new THREE.MeshStandardMaterial({ color: 0x8d7a5c, roughness: 0.95, flatShading: true }));
    const iron = track(new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.6, metalness: 0.4 }));
    const base = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.5, 0.28)), stone);
    base.position.y = FLOOR_Y + 0.25;
    base.castShadow = base.receiveShadow = true;
    g.add(base);
    // pivot holds the arm so we can swing it when the trap arms/disarms
    const pivot = new THREE.Group();
    pivot.position.set(0, FLOOR_Y + 0.5, 0.1);
    const arm = new THREE.Mesh(track(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8)), iron);
    arm.position.y = 0.18;
    arm.castShadow = true;
    pivot.add(arm);
    const knob = new THREE.Mesh(track(new THREE.SphereGeometry(0.07, 14, 10)),
      track(new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0x7a1c10, emissiveIntensity: 0.7, roughness: 0.3 })));
    knob.position.y = 0.4;
    pivot.add(knob);
    g.add(pivot);
    place(g, cell);
    group.add(g);
    return { pivot, knob };
  }

  // ------------------------------------------------------------------ traps
  for (const cell of world.traps || []) traps.push(buildTrap(cell));

  function buildTrap(cell) {
    const g = new THREE.Group();
    const frameMat = track(new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.8, metalness: 0.3 }));
    const frame = new THREE.Mesh(track(new THREE.TorusGeometry(0.36, 0.05, 8, 4)), frameMat);
    frame.rotation.x = Math.PI / 2;
    frame.position.y = FLOOR_Y + 0.03;
    frame.rotation.z = Math.PI / 4;
    g.add(frame);
    const glowMat = track(new THREE.MeshBasicMaterial({
      color: 0xff3a2a, transparent: true, opacity: 0.0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const glow = new THREE.Mesh(track(new THREE.CircleGeometry(0.34, 20)), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = FLOOR_Y + 0.04;
    g.add(glow);
    const spikeMat = track(new THREE.MeshStandardMaterial({
      color: 0xb6b2aa, roughness: 0.4, metalness: 0.5, emissive: 0x551008, emissiveIntensity: 0,
    }));
    const spikes = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(track(new THREE.ConeGeometry(0.06, 0.3, 6)), spikeMat);
      const a = (i / 5) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
      spikes.add(sp);
    }
    spikes.position.y = FLOOR_Y - 0.2; // retracted by default
    g.add(spikes);
    place(g, cell);
    group.add(g);
    return { glow, glowMat, spikes, spikeMat };
  }

  // --------------------------------------------------------------- ladders
  for (const [a, b] of world.ladders || []) buildLadder(a, b);

  function buildLadder(a, b) {
    const g = new THREE.Group();
    const wood = track(new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.85, flatShading: true }));
    const plankMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.8 }));
    const A = cellToWorld(a[0], a[1]);
    const B = cellToWorld(b[0], b[1]);
    const mid = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
    const horizontal = a[0] === b[0]; // climb crosses along x (cols) or z (rows)
    const TOP = 1.35; // catwalk height (just above the maze walls, WALL_H≈1.05)

    // one ladder leaning on each side of the wall
    const makeLadder = (from) => {
      const lg = new THREE.Group();
      for (const rx of [-0.12, 0.12]) {
        const rail = new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.03, TOP + 0.2, 6)), wood);
        rail.position.set(rx, (TOP + 0.2) / 2, 0);
        rail.castShadow = true;
        lg.add(rail);
      }
      for (let i = 0; i < 5; i++) {
        const rung = new THREE.Mesh(track(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 6)), wood);
        rung.rotation.z = Math.PI / 2;
        rung.position.y = 0.18 + i * 0.26;
        lg.add(rung);
      }
      // face the ladder toward the wall it leans on
      const ang = Math.atan2(mid.x - from.x, mid.z - from.z);
      lg.rotation.y = ang;
      lg.position.set(from.x, FLOOR_Y, from.z);
      lg.rotation.x = -0.12;
      return lg;
    };
    g.add(makeLadder(A), makeLadder(B));

    // a plank catwalk spanning over the wall between the two ladders
    const len = horizontal ? Math.abs(B.x - A.x) + 0.5 : Math.abs(B.z - A.z) + 0.5;
    const plank = new THREE.Mesh(
      track(new THREE.BoxGeometry(horizontal ? len : 0.5, 0.1, horizontal ? 0.5 : len)), plankMat);
    plank.position.set(mid.x, FLOOR_Y + TOP, mid.z);
    plank.castShadow = plank.receiveShadow = true;
    g.add(plank);
    for (const railOff of [-0.28, 0.28]) {
      const r = new THREE.Mesh(
        track(new THREE.BoxGeometry(horizontal ? len : 0.06, 0.18, horizontal ? 0.06 : len)), wood);
      r.position.set(mid.x + (horizontal ? 0 : railOff), FLOOR_Y + TOP + 0.14, mid.z + (horizontal ? railOff : 0));
      g.add(r);
    }
    group.add(g);
  }

  // -------------------------------------------------------------- animation
  function update(frame, t) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 2.2);
    for (const m of mirrors) {
      m.shards.rotation.y = t * 0.8;
      m.discMat.opacity = 0.4 + 0.2 * pulse;
      m.light.intensity = 0.8 + 0.5 * pulse;
    }
    const armed = !!(frame && frame.trapArmed);
    for (const lv of levers) {
      // ease the lever toward its pose (down = armed)
      const goal = armed ? 0.7 : -0.7;
      lv.pivot.rotation.z += (goal - lv.pivot.rotation.z) * 0.2;
      lv.knob.material.emissiveIntensity = armed ? 1.0 : 0.4;
    }
    for (const tr of traps) {
      const goalY = armed ? FLOOR_Y + 0.0 : FLOOR_Y - 0.2;
      tr.spikes.position.y += (goalY - tr.spikes.position.y) * 0.2;
      tr.spikeMat.emissiveIntensity += ((armed ? 0.8 : 0) - tr.spikeMat.emissiveIntensity) * 0.2;
      tr.glowMat.opacity += ((armed ? 0.35 + 0.25 * pulse : 0) - tr.glowMat.opacity) * 0.2;
    }
  }

  function dispose() {
    scene.remove(group);
    for (const d of disposables) d.dispose?.();
  }

  return { group, update, dispose };
}
