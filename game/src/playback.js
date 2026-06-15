import * as THREE from 'three';
import { cellToWorld } from './layout.js';
import { updateWalker } from './characters.js';

// Animates a recorded game (trajectory.json) in the 3D scene: drives the two
// characters cell-to-cell with smooth interpolation + walk cycles, floats the
// keys, pulses the teleporter pads, hands the gold key to whoever holds it,
// and shows who won.
//
// trajectory frames are discrete sim ticks; we interpolate between consecutive
// ticks over STEP_DUR seconds so motion reads as continuous walking.

const STEP_DUR = 0.4;   // seconds per sim tick
const END_HOLD = 2.5;   // pause on the final frame before looping

function keyMesh(color, _emissive, gemColor) {
  // a chunky ornate key: ornate bow (ring + 4 lobes + a faceted gem), thick
  // shaft, and proper bit teeth. Solid polished metal — NO self-illumination
  // (it just catches the scene light), so it doesn't shine weirdly.
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.8 });
  const gemMat = new THREE.MeshStandardMaterial({ color: gemColor ?? color, roughness: 0.2, metalness: 0.5 });

  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 12, 24), metal);
  bow.position.y = 0.34;
  g.add(bow);
  // four little lobes around the bow (clover look)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), metal);
    lobe.position.set(Math.cos(a) * 0.2, 0.34 + Math.sin(a) * 0.2, 0);
    g.add(lobe);
  }
  // glowing gem in the centre of the bow
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), gemMat);
  gem.position.y = 0.34;
  g.add(gem);

  // thick shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.46, 10), metal);
  shaft.position.y = -0.02;
  g.add(shaft);
  // collar where shaft meets bow
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 16), metal);
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

function padMesh(color) {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.4, transparent: true, opacity: 0.9 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 10, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.34, 28),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5, transparent: true, opacity: 0.45 }));
  disc.rotation.x = -Math.PI / 2;
  g.add(disc, ring);
  return { group: g, mat: ringMat, disc };
}

function buildPedestal() {
  // a carved stone plinth with a glowing rune ring; the gold key floats above
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xcfc4b0, roughness: 0.85, metalness: 0.05 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.52, 0.16, 8), stone);
  base.position.y = 0.08;
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.34, 8), stone);
  col.position.y = 0.33;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.26, 0.12, 8), stone);
  top.position.y = 0.56;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.028, 8, 22),
    new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc24b, emissiveIntensity: 1.0, roughness: 0.4 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.63;
  g.add(base, col, top, ring);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function buildPortcullis() {
  // an iron portcullis with a keyhole. Neutral metal (NOT agent-coloured). The
  // `bars` group slides down into the floor when the door is unlocked.
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x4b4b54, metalness: 0.7, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b31, metalness: 0.5, roughness: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xa8843c, metalness: 0.7, roughness: 0.4 });
  const black = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.85 });

  // stone-set frame: two jambs (sunk in the flanking walls) + a lintel
  const postGeo = new THREE.BoxGeometry(0.14, 1.55, 0.32);
  for (const px of [-0.5, 0.5]) {
    const p = new THREE.Mesh(postGeo, dark);
    p.position.set(px, 0.77, 0);
    p.castShadow = true;
    g.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.22, 0.36), dark);
  lintel.position.y = 1.55;
  lintel.castShadow = true;
  g.add(lintel);

  // brass keyhole escutcheon on the lintel
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.05), brass);
  plate.position.set(0, 1.5, 0.2);
  g.add(plate);
  const holeC = new THREE.Mesh(new THREE.CircleGeometry(0.045, 14), black);
  holeC.position.set(0, 1.53, 0.231);
  g.add(holeC);
  const holeS = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.07), black);
  holeS.position.set(0, 1.48, 0.231);
  g.add(holeS);

  // the sliding grille: vertical bars + crossbars + pointed tips
  const bars = new THREE.Group();
  const barGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.46, 8);
  const tipGeo = new THREE.ConeGeometry(0.045, 0.12, 6);
  for (const bx of [-0.33, -0.11, 0.11, 0.33]) {
    const b = new THREE.Mesh(barGeo, iron);
    b.position.set(bx, 0.75, 0);
    b.castShadow = true;
    bars.add(b);
    const tip = new THREE.Mesh(tipGeo, iron);
    tip.position.set(bx, 0.0, 0);
    bars.add(tip);
  }
  for (const cy of [0.32, 1.2]) {
    const cr = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.06, 0.06), iron);
    cr.position.set(0, cy, 0);
    bars.add(cr);
  }
  g.add(bars);
  return { group: g, bars };
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

  // --- props ---------------------------------------------------------------
  const FLOAT_Y = 0.62;
  const redKey = keyMesh(0xff4d6a, 0x8a1020, 0xff9aa8);
  const blueKey = keyMesh(0x5b8dff, 0x10318a, 0xb9d2ff);
  const goldKey = keyMesh(0xf2c84b, 0x8a6410, 0xfff0a0);
  for (const k of [redKey, blueKey, goldKey]) group.add(k.group);

  const place = (obj, cell, y) => {
    const { x, z } = cellToWorld(cell.r, cell.c);
    obj.position.set(x, y, z);
  };
  place(redKey.group, layout.redKey, FLOAT_Y);
  place(blueKey.group, layout.blueKey, FLOAT_Y);

  const pad1 = padMesh(0x9b7bff);
  const pad2 = padMesh(0x9b7bff);
  group.add(pad1.group, pad2.group);
  place(pad1.group, layout.pad1, 0.18);
  place(pad2.group, layout.pad2, 0.18);

  // the pedestal under the gold key — a glowing centrepiece
  const pedestal = buildPedestal();
  place(pedestal, layout.gold, 0.16);
  group.add(pedestal);
  const gW = cellToWorld(layout.gold.r, layout.gold.c);
  const pedestalGlow = new THREE.PointLight(0xffe6a0, 1.1, 4.5, 2);
  pedestalGlow.position.set(gW.x, 1.3, gW.z);
  group.add(pedestalGlow);

  // bedroom doors: iron portcullises that slide down when unlocked
  const redPort = buildPortcullis();
  const bluePort = buildPortcullis();
  place(redPort.group, layout.redDoor, 0.16);
  place(bluePort.group, layout.blueDoor, 0.16);
  group.add(redPort.group, bluePort.group);
  const doors = [
    { bars: redPort.bars, keyFlag: 'redKey', walker: king,
      pos: cellToWorld(layout.redDoor.r, layout.redDoor.c), open: 0, latched: false },
    { bars: bluePort.bars, keyFlag: 'blueKey', walker: princess,
      pos: cellToWorld(layout.blueDoor.r, layout.blueDoor.c), open: 0, latched: false },
  ];

  // a warm torch-glow at the escape gate — neutral, never tinted by who wins
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
    for (const d of doors) {
      d.open = 0;
      d.latched = false;
      d.bars.position.y = 0;
    }
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

    // --- colored keys vanish once collected ----------------------------------
    redKey.group.visible = !f.redKey;
    blueKey.group.visible = !f.blueKey;
    const spin = elapsed * 1.5;
    const bob = Math.sin(elapsed * 2) * 0.05;
    for (const k2 of [redKey, blueKey]) {
      k2.group.rotation.y = spin;
      k2.group.position.y = FLOAT_Y + bob;
    }

    // --- gold key: carried by its holder, else floating on the ground --------
    const holder = f.gold.holder;
    if (holder) {
      const w = holder === 'red' ? king : princess;
      w.handAnchors.L.getWorldPosition(vTmp);
      goldKey.group.position.copy(vTmp);
      goldKey.group.rotation.y = w.group.rotation.y;
      goldKey.group.scale.setScalar(0.7);
    } else {
      const gp = f.gold.pos; // [row, col]
      const { x, z } = cellToWorld(gp[0], gp[1]);
      goldKey.group.position.set(x, FLOAT_Y + bob, z);
      goldKey.group.rotation.y = spin;
      goldKey.group.scale.setScalar(1.0);
    }

    // --- bedroom doors: open when the key-holder ARRIVES at the door, not the
    // instant they grab the key. Latches open once reached.
    for (const d of doors) {
      if (!d.latched && f[d.keyFlag]) {
        const ddx = d.walker.group.position.x - d.pos.x;
        const ddz = d.walker.group.position.z - d.pos.z;
        if (ddx * ddx + ddz * ddz < 1.6 * 1.6) d.latched = true;
      }
      d.open += ((d.latched ? 1 : 0) - d.open) * Math.min(1, dt * 5);
      d.bars.position.y = -d.open * 1.6; // sink the grille into the floor
    }

    // --- teleporter pads pulse -----------------------------------------------
    const pulse = 0.6 + Math.sin(elapsed * 4) * 0.25;
    pad1.mat.emissiveIntensity = pulse;
    pad2.mat.emissiveIntensity = pulse;

    // --- finale: warm flare at the gate + banner (gate stays neutral) --------
    if (i >= last && trajectory.winner) {
      const win = trajectory.winner;
      escGlow.intensity = 2 + Math.sin(elapsed * 6) * 1.0;
      banner.textContent = win === 'red' ? '👑  The King escapes — RED wins!' : '👑  The Princess escapes — BLUE wins!';
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
