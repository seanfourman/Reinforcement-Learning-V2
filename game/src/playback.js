import * as THREE from 'three';
import { cellToWorld } from './layout.js';
import { updateWalker } from './characters.js';

// Animates a recorded game (trajectory.json) in the 3D scene: drives the two
// characters cell-to-cell with smooth interpolation + walk cycles, floats the
// three keys, hands the gold key to whoever holds it, and shows who won.
//
// The board itself is stripped to bare tiles - no walls, gates, pads or
// pedestal - so the only things on it are the King, the Princess and the keys.
//
// trajectory frames are discrete sim ticks; we interpolate between consecutive
// ticks over STEP_DUR seconds so motion reads as continuous walking.

const STEP_DUR = 0.4;   // seconds per sim tick
const END_HOLD = 2.5;   // pause on the final frame before looping

function keyMesh(color, _emissive, gemColor) {
  // a chunky ornate key: ornate bow (ring + 4 lobes + a faceted gem), thick
  // shaft, and proper bit teeth. Solid polished metal - NO self-illumination
  // (it just catches the scene light), so it doesn't shine weirdly.
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.8 });
  const gemMat = new THREE.MeshStandardMaterial({ color: gemColor ?? color, roughness: 0.2, metalness: 0.5 });

  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 16, 32), metal);
  bow.position.y = 0.34;
  g.add(bow);
  // four little lobes around the bow (clover look)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), metal);
    lobe.position.set(Math.cos(a) * 0.2, 0.34 + Math.sin(a) * 0.2, 0);
    g.add(lobe);
  }
  // glowing gem in the centre of the bow
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), gemMat);
  gem.position.y = 0.34;
  g.add(gem);

  // thick shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.46, 16), metal);
  shaft.position.y = -0.02;
  g.add(shaft);
  // collar where shaft meets bow
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 12, 24), metal);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.18;
  g.add(collar);
  // the bit (teeth) at the bottom
  for (const [ty, tw] of [[-0.18, 0.14], [-0.25, 0.1]]) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.05, 0.06), metal);
    tooth.position.set(tw / 2 + 0.02, ty, 0);
    g.add(tooth);
  }

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, mat: metal, gem: gemMat };
}

export function createPlayback(scene, trajectory, layout, walkers) {
  const frames = trajectory.frames;
  const group = new THREE.Group();
  scene.add(group);

  // --- characters: red agent = King, blue agent = Princess -----------------
  const king = walkers.red;
  const princess = walkers.blue;
  king.group.scale.setScalar(1.2);   // scaled up so they read as the stars
  princess.group.scale.setScalar(1.2);
  group.add(king.group, princess.group);

  // --- the three keys (the only props left on the board) -------------------
  const FLOAT_Y = 0.62;
  const redKey = keyMesh(0xff4d6a, 0x8a1020, 0xff9aa8);
  const blueKey = keyMesh(0x5b8dff, 0x10318a, 0xb9d2ff);
  const goldKey = keyMesh(0xf2c84b, 0x8a6410, 0xfff0a0);
  for (const k of [redKey, blueKey, goldKey]) group.add(k.group);

  const place = (obj, cell, y) => {
    const { x, z } = cellToWorld(cell.r, cell.c);
    obj.position.set(x, y, z);
  };
  // cross rounds (the hedge maze) carry no key tiles - skip the initial placement
  if (layout.redKey) place(redKey.group, layout.redKey, FLOAT_Y);
  if (layout.blueKey) place(blueKey.group, layout.blueKey, FLOAT_Y);

  // a warm torch-glow at the escape gate - neutral, never tinted by who wins
  const escapeCell = layout.escape[0];
  const escGlow = new THREE.PointLight(0xffcf8a, 1.2, 6, 2);
  const eW = cellToWorld(escapeCell.r, escapeCell.c);
  escGlow.position.set(eW.x + 0.5, 1.4, eW.z);
  group.add(escGlow);

  // --- winner banner (DOM overlay) -----------------------------------------
  const banner = document.createElement('div');
  banner.style.cssText =
    'position:fixed;top:8%;left:50%;transform:translateX(-50%);padding:14px 30px;' +
    'border-radius:14px;font:600 30px "Segoe UI",system-ui,sans-serif;color:#fff;' +
    'background:rgba(20,18,34,0.72);box-shadow:0 6px 30px rgba(0,0,0,0.4);' +
    'opacity:0;transition:opacity .5s;pointer-events:none;backdrop-filter:blur(4px);';
  document.body.appendChild(banner);

  // ------------------------------------------------------------------ helpers
  let t = 0;
  const heading = { red: Math.PI, blue: Math.PI };
  const vTmp = new THREE.Vector3();

  function cellWorld(arr) { // arr = [row, col]
    const { x, z } = cellToWorld(arr[0], arr[1]);
    return { x, z };
  }

  function lerpPos(a, b, k) {
    const A = cellWorld(a), B = cellWorld(b);
    return { x: A.x + (B.x - A.x) * k, z: A.z + (B.z - A.z) * k };
  }

  function faceToward(walker, key, dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
      const target = Math.atan2(dx, dz);
      // shortest-arc ease
      let d = target - heading[key];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading[key] += d * 0.35;
    }
    walker.group.rotation.y = heading[key];
  }

  function reset() {
    t = 0;
    heading.red = Math.PI;
    heading.blue = Math.PI;
    banner.style.opacity = '0';
  }

  function update(dt, elapsed) {
    const last = frames.length - 1;
    const total = last * STEP_DUR;
    t += dt;
    if (t > total + END_HOLD) reset();

    const ft = Math.min(t / STEP_DUR, last);
    const i = Math.min(Math.floor(ft), last);
    const j = Math.min(i + 1, last);
    const k = ft - i;
    const f = frames[i];
    const fn = frames[j];

    // --- move + animate each character ---------------------------------------
    for (const [key, walker] of [['red', king], ['blue', princess]]) {
      const p = lerpPos(f[key], fn[key], k);
      const dx = cellWorld(fn[key]).x - cellWorld(f[key]).x;
      const dz = cellWorld(fn[key]).z - cellWorld(f[key]).z;
      const moving = i < last && (Math.abs(dx) + Math.abs(dz) > 1e-4);
      walker.group.position.x = p.x;
      walker.group.position.z = p.z;
      faceToward(walker, key, dx, dz);
      updateWalker(walker, dt, moving);
    }

    // --- keys + gold: race rounds only (a "cross" frame carries `fell`) -------
    const cross = f.fell !== undefined;
    redKey.group.visible = !cross && !f.redKey;
    blueKey.group.visible = !cross && !f.blueKey;
    const spin = elapsed * 1.5;
    const bob = Math.sin(elapsed * 2) * 0.05;
    if (cross) {
      goldKey.group.visible = false;
    } else {
      for (const k2 of [redKey, blueKey]) {
        k2.group.rotation.y = spin;
        k2.group.position.y = FLOAT_Y + bob;
      }
      const holder = f.gold.holder;
      goldKey.group.visible = !!(holder || f.gold.pos);
      if (holder) {
        const w = holder === 'red' ? king : princess;
        w.handAnchors.L.getWorldPosition(vTmp);
        goldKey.group.position.copy(vTmp);
        goldKey.group.rotation.y = w.group.rotation.y;
        goldKey.group.scale.setScalar(0.7);
      } else if (f.gold.pos) {
        const { x, z } = cellToWorld(f.gold.pos[0], f.gold.pos[1]);
        goldKey.group.position.set(x, FLOAT_Y + bob, z);
        goldKey.group.rotation.y = spin;
        goldKey.group.scale.setScalar(1.0);
      }
    }

    // --- finale: warm flare at the gate + banner (gate stays neutral) --------
    if (i >= last && trajectory.winner) {
      const win = trajectory.winner;
      escGlow.intensity = 2 + Math.sin(elapsed * 6) * 1.0;
      banner.textContent = win === 'red' ? '👑  The King escapes - RED wins!' : '👑  The Princess escapes - BLUE wins!';
      banner.style.color = win === 'red' ? '#ffd2d2' : '#d2e2ff';
      banner.style.opacity = '1';
    } else {
      escGlow.intensity = 1.2;
    }
  }

  function dispose() {
    banner.remove();
    scene.remove(group);
  }

  return { update, reset, dispose, group };
}
