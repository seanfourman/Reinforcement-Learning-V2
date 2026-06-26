import * as THREE from 'three';
import { cellToWorld } from './layout.js';
import { updateWalker } from './characters.js';

// Live actor driver: the King, the Queen and the three keys, driven by frames
// polled from the Python backend (/api/snapshot). Unlike the old playback.js
// (which indexed a fully-recorded trajectory), frames arrive one at a time, so
// we smooth the rendered position toward the latest frame's target each tick -
// slow sim speed reads as walking, fast speed as a blur (you watch the panel).

const FLOAT_Y = 0.62;

function keyMesh(color, gemColor) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.8 });
  const gemMat = new THREE.MeshStandardMaterial({ color: gemColor ?? color, roughness: 0.2, metalness: 0.5 });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 16, 32), metal);
  bow.position.y = 0.34;
  g.add(bow);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), metal);
    lobe.position.set(Math.cos(a) * 0.2, 0.34 + Math.sin(a) * 0.2, 0);
    g.add(lobe);
  }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), gemMat);
  gem.position.y = 0.34;
  g.add(gem);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.46, 16), metal);
  shaft.position.y = -0.02;
  g.add(shaft);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 12, 24), metal);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.18;
  g.add(collar);
  for (const [ty, tw] of [[-0.18, 0.14], [-0.25, 0.1]]) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.05, 0.06), metal);
    tooth.position.set(tw / 2 + 0.02, ty, 0);
    g.add(tooth);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, mat: metal, gem: gemMat };
}

export function createLiveActors(scene, walkers) {
  const group = new THREE.Group();
  scene.add(group);

  let king = walkers.red;
  let princess = walkers.blue;
  king.group.scale.setScalar(1.2);
  princess.group.scale.setScalar(1.2);
  group.add(king.group, princess.group);

  // swap in different walker models at runtime (e.g. the chosen menu characters)
  function setWalkers(next) {
    for (const side of ['red', 'blue']) {
      const w = next[side];
      if (!w) continue;
      const old = side === 'red' ? king : princess;
      if (old && old.group) group.remove(old.group);
      w.group.scale.setScalar(1.2);
      group.add(w.group);
      if (side === 'red') king = w; else princess = w;
    }
  }

  const redKey = keyMesh(0xff4d6a, 0xff9aa8);
  const blueKey = keyMesh(0x5b8dff, 0xb9d2ff);
  const goldKey = keyMesh(0xf2c84b, 0xfff0a0);
  group.add(redKey.group, blueKey.group, goldKey.group);

  const escGlow = new THREE.PointLight(0xffcf8a, 1.2, 6, 2);
  group.add(escGlow);

  // winner banner (DOM overlay)
  const banner = document.createElement('div');
  banner.style.cssText =
    'position:fixed;top:8%;left:50%;transform:translateX(-50%);padding:14px 30px;' +
    'border-radius:14px;font:600 30px "Segoe UI",system-ui,sans-serif;color:#fff;' +
    'background:rgba(20,18,34,0.72);box-shadow:0 6px 30px rgba(0,0,0,0.4);' +
    'opacity:0;transition:opacity .4s;pointer-events:none;backdrop-filter:blur(4px);z-index:5;';
  document.body.appendChild(banner);

  const heading = { red: Math.PI, blue: Math.PI };
  const rendered = { red: { x: 10, z: 18 }, blue: { x: 10, z: 18 } };
  const target = { red: { x: 10, z: 18 }, blue: { x: 10, z: 18 } };
  let frame = null;
  let layout = null;
  let isCross = false;   // cross rounds (the hedge maze) have NO keys / gold
  // manhole fall animation, latched by the env's count (dormant unless drop_traps)
  const fell = { red: null, blue: null };
  const lastFallN = { red: 0, blue: 0 };
  const FALL_DUR = 0.55;
  const vTmp = new THREE.Vector3();

  const cw = (cell) => cellToWorld(cell.r, cell.c); // {r,c} -> {x,z}
  const cwArr = (arr) => cellToWorld(arr[0], arr[1]); // [row,col] -> {x,z}

  function setWorld(lay, cross = false) {
    layout = lay;
    isCross = cross;
    // no keys / gold in a cross round - hide them outright so they never appear
    redKey.group.visible = !cross;
    blueKey.group.visible = !cross;
    goldKey.group.visible = !cross;
    const place = (k, cell) => { const { x, z } = cw(cell); k.group.position.set(x, FLOAT_Y, z); };
    if (!cross && lay.redKey) place(redKey, lay.redKey);
    if (!cross && lay.blueKey) place(blueKey, lay.blueKey);
    const e = lay.escape[0] || { r: 0, c: 10 };
    const ew = cw(e);
    escGlow.position.set(ew.x + 0.5, 1.4, ew.z);
    // snap actors to spawns so they don't streak across a brand-new world
    const rs = lay.redSpawn ? cw(lay.redSpawn) : { x: 0.5, z: 18.5 };
    const bs = lay.blueSpawn ? cw(lay.blueSpawn) : { x: 18.5, z: 18.5 };
    rendered.red = { ...rs }; target.red = { ...rs };
    rendered.blue = { ...bs }; target.blue = { ...bs };
    banner.style.opacity = '0';
  }

  function onFrame(f) {
    frame = f;
    target.red = cwArr(f.red);
    target.blue = cwArr(f.blue);
    // start a fall animation when the env reports a new manhole drop
    if (f.fell) {
      for (const key of ['red', 'blue']) {
        const fe = f.fell[key];
        if (fe && fe.cell && fe.n > lastFallN[key]) {
          lastFallN[key] = fe.n;
          fell[key] = { at: cwArr(fe.cell), e: 0 };
        }
      }
    }
  }

  function faceToward(walker, key, dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) {
      const t = Math.atan2(dx, dz);
      let d = t - heading[key];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading[key] += d * 0.35;
    }
    walker.group.rotation.y = heading[key];
  }

  function update(dt, t) {
    const k = 1 - Math.exp(-dt * 12); // smoothing toward the latest target
    for (const [key, walker] of [['red', king], ['blue', princess]]) {
      // mid-fall: drop into the manhole (sink + shrink + spin), then reappear
      if (fell[key]) {
        fell[key].e += dt;
        const p = fell[key].e / FALL_DUR;
        if (p < 1) {
          const at = fell[key].at;
          walker.group.position.set(at.x, -2.6 * p, at.z);
          walker.group.scale.setScalar(1.2 * (1 - 0.6 * p));
          walker.group.rotation.y += dt * 9;
          continue;                       // skip normal movement while falling
        }
        fell[key] = null;
        walker.group.position.y = 0;
        walker.group.scale.setScalar(1.2);
        rendered[key] = { ...target[key] }; // reappear at spawn without sliding
      }
      const r = rendered[key], tg = target[key];
      const dx = tg.x - r.x, dz = tg.z - r.z;
      const moving = Math.abs(dx) + Math.abs(dz) > 0.02;
      if (Math.hypot(dx, dz) > 1.5) {
        // a teleport (mirror) or ladder climb - snap instead of sliding through walls
        r.x = tg.x; r.z = tg.z;
      } else {
        r.x += dx * k;
        r.z += dz * k;
      }
      walker.group.position.x = r.x;
      walker.group.position.z = r.z;
      faceToward(walker, key, dx, dz);
      updateWalker(walker, dt, moving);
    }

    if (!frame) return;
    if (!isCross) {                       // keys + gold only exist in race rounds
      redKey.group.visible = !frame.redKey;
      blueKey.group.visible = !frame.blueKey;
      const spin = t * 1.5;
      const bob = Math.sin(t * 2) * 0.05;
      for (const kk of [redKey, blueKey]) {
        kk.group.rotation.y = spin;
        kk.group.position.y = FLOAT_Y + bob;
      }

      goldKey.group.visible = !!(frame.gold.holder || frame.gold.pos);
      const holder = frame.gold.holder;
      if (holder) {
        const w = holder === 'red' ? king : princess;
        w.handAnchors.L.getWorldPosition(vTmp);
        goldKey.group.position.copy(vTmp);
        goldKey.group.rotation.y = w.group.rotation.y;
        goldKey.group.scale.setScalar(0.7);
      } else if (frame.gold.pos) {
        const { x, z } = cwArr(frame.gold.pos);
        // the on-ground gold rests in its central chamber cell (col 9); nudge it
        // half a tile east so it sits dead-centre between the two gates (x = 10).
        goldKey.group.position.set(x + 0.5, FLOAT_Y + Math.sin(t * 2) * 0.05, z);
        goldKey.group.rotation.y = t * 1.5;
        goldKey.group.scale.setScalar(1.0);
      }
    }

    if (frame.winner) {
      escGlow.intensity = 2 + Math.sin(t * 6) * 1.0;
      banner.textContent = frame.winner === 'red'
        ? '👑  The King escapes - RED wins!'
        : '👑  The Queen escapes - BLUE wins!';
      banner.style.color = frame.winner === 'red' ? '#ffd2d2' : '#d2e2ff';
      banner.style.opacity = '1';
    } else {
      escGlow.intensity = 1.2;
      banner.style.opacity = '0';
    }
  }

  return { setWorld, onFrame, update, group, setWalkers };
}
