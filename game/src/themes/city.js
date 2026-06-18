// Round 2 — a neon-city rooftop arena built from REAL low-poly building models
// (Kenney "City Kit (Commercial)", CC0) instead of procedural boxes.
//
// The 20x20 board sits on a dark glossy platform. The board's wall tiles ('#')
// become little city buildings; a dense skyline of taller towers rings the arena
// on three sides (left / right / back) — the foreground toward the camera is left
// OPEN so you look out over the edge. A captured night-city HDRI (set via the
// theme's `env`, loaded in main.js) lights everything and reflects on the wet
// platform. The live actors / keys / gold / heatmap still ride on the y=0 board.
//
// Models load asynchronously: the platform + gameplay decals appear immediately,
// the buildings pop in as their GLBs arrive. Everything is cloned from a handful
// of loaded prototypes (shared geometry + one night-tinted material each).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GRID = 20;
const CTR = GRID / 2;
const NEON = [0x39e6ff, 0xff3bd0, 0x8b5cff, 0xffc24b, 0x49ff9e];
const MODELS = './assets/models/city/';

// kit pieces by role (heights: low ~1.3, mid ~1.5-1.7, tall ~2.9-5.5, filler ~2)
const OBSTACLE = ['building-a', 'building-b', 'building-c', 'building-d',
  'building-e', 'building-g', 'building-h'];
const TALL = ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c',
  'building-skyscraper-d', 'building-skyscraper-e'];
const MID = ['building-i', 'building-k', 'building-l', 'building-m', 'building-n'];
const FILLER = ['low-detail-building-a', 'low-detail-building-c', 'low-detail-building-f',
  'low-detail-building-h', 'low-detail-building-k'];

function hash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

export const city = {
  name: 'city',
  title: 'Neon City',
  sky: ['#05061c', '#0c1238', '#1d0e3e'],
  fog: 0x0a0e2e,
  fogNear: 26,
  fogFar: 130,
  hemi: [0x3a4a86, 0x05030f, 0.45],
  sun: 0x9fb0ff,
  sunIntensity: 0.55,
  fill: 0xff3bd0,
  fillIntensity: 0.45,
  exposure: 1.0,
  // gentle bloom + high threshold so only true neon (cars, gold, rim) glows — the
  // self-lit buildings must NOT bloom or the whole scene blows out to white.
  bloom: { strength: 0.16, radius: 0.5, threshold: 0.85 },
  // real captured night-city HDRI (Poly Haven, CC0): image-based reflections on
  // the wet platform + the towers, and a believable skyline behind everything.
  env: './assets/hdri/modern_buildings_night_2k.hdr',
  envIntensity: 0.55,
  envBlur: 0.16,
  bgIntensity: 0.7,
  camera: { pitchDeg: 40, dist: 34, targetY: 1.2 },   // used if the rig supports setView
  redName: 'Crimson',
  blueName: 'Cobalt',

  buildScene(scene, world) {
    const group = new THREE.Group();
    scene.add(group);
    const trash = [];
    const track = (o) => (trash.push(o), o);
    let disposed = false;

    const rows = world.rows;
    const loader = new GLTFLoader();
    const protos = new Map();   // name -> prepared prototype Object3D

    // ---- night-tint a loaded kit model and cache it as a clonable prototype ---
    function prepare(gltf) {
      const root = gltf.scene;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const m = o.material.clone();
        m.color.multiply(new THREE.Color(0x8e9ac0));   // knock the bright day palette toward night
        m.emissive = new THREE.Color(0x16213a);        // faint self-lit so windows read at night
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0.14;                    // low: bloom must not catch the walls
        m.metalness = 0.2;
        m.roughness = 0.75;
        m.needsUpdate = true;
        o.material = m;
        track(m);
        track(o.geometry);
      });
      return root;
    }
    function getModel(name) {
      if (protos.has(name)) return Promise.resolve(protos.get(name));
      return loader.loadAsync(MODELS + name + '.glb').then((g) => {
        const p = prepare(g);
        protos.set(name, p);
        return p;
      });
    }
    // place a clone (shares geometry + tinted material — cheap) of `name`
    function place(name, x, z, scale, ry) {
      getModel(name).then((proto) => {
        if (disposed) return;
        const inst = proto.clone(true);
        inst.position.set(x, 0, z);
        inst.scale.setScalar(scale);
        inst.rotation.y = ry;
        group.add(inst);
      }).catch(() => { /* a model failed to load — skip it */ });
    }

    // ---- platform the board rests on (dark, glossy/wet, reflects the HDRI) ----
    const platform = new THREE.Mesh(
      track(new THREE.BoxGeometry(GRID + 3, 1.4, GRID + 3)),
      track(new THREE.MeshStandardMaterial({ color: 0x070a16, roughness: 0.22, metalness: 0.9,
        emissive: 0x0a1430, emissiveIntensity: 0.35 })));
    platform.position.set(CTR, -0.7, CTR);
    platform.receiveShadow = true;
    group.add(platform);

    // a supporting shaft dropping into the haze, so you feel high up
    const shaft = new THREE.Mesh(
      track(new THREE.BoxGeometry(GRID + 2, 60, GRID + 2)),
      track(new THREE.MeshStandardMaterial({ color: 0x05070f, roughness: 0.6, metalness: 0.4 })));
    shaft.position.set(CTR, -0.7 - 30, CTR);
    group.add(shaft);

    // ---- board floor + additive neon grid (cosmetic; raycast uses a math plane) -
    const gc = document.createElement('canvas'); gc.width = gc.height = 512;
    const gx = gc.getContext('2d');
    gx.fillStyle = '#070b18'; gx.fillRect(0, 0, 512, 512);
    gx.strokeStyle = 'rgba(80,170,255,0.55)'; gx.lineWidth = 2;
    for (let i = 0; i <= GRID; i++) {
      const p = (i / GRID) * 512;
      gx.beginPath(); gx.moveTo(p, 0); gx.lineTo(p, 512); gx.stroke();
      gx.beginPath(); gx.moveTo(0, p); gx.lineTo(512, p); gx.stroke();
    }
    const gridTex = track(new THREE.CanvasTexture(gc));
    gridTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(
      track(new THREE.PlaneGeometry(GRID, GRID)),
      track(new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.35, metalness: 0.6,
        emissive: 0x0a1830, emissiveMap: gridTex, emissiveIntensity: 0.22 })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(CTR, 0.02, CTR);
    floor.receiveShadow = true;
    group.add(floor);

    // glowing rim around the board
    const rimMat = track(new THREE.MeshBasicMaterial({ color: 0x39e6ff }));
    const rimH = track(new THREE.BoxGeometry(GRID + 0.3, 0.16, 0.18));
    const rimV = track(new THREE.BoxGeometry(0.18, 0.16, GRID + 0.3));
    for (const [g2, x, z] of [[rimH, CTR, 0], [rimH, CTR, GRID], [rimV, 0, CTR], [rimV, GRID, CTR]]) {
      const bar = new THREE.Mesh(g2, rimMat); bar.position.set(x, 0.09, z); group.add(bar);
    }

    // ---- in-play buildings: a real Kenney model on every '#' wall tile ---------
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (rows[r][c] !== '#') continue;
        const h = hash(r, c);
        const name = OBSTACLE[h % OBSTACLE.length];
        const ry = (h >> 3 & 3) * (Math.PI / 2);
        place(name, c + 0.5, r + 0.5, 0.94, ry);
      }
    }

    // ---- surrounding skyline: towers on three sides, foreground left OPEN ------
    // camera sits on the +z side, so the open band is high z (toward the viewer).
    for (let x = -16; x <= 36; x += 4) {
      for (let z = -16; z <= 24; z += 4) {
        const onBoard = x > -2 && x < 22 && z > -2 && z < 22;
        const inFront = z > 21 && x > -3 && x < 23;     // keep the foreground clear
        if (onBoard || inFront) continue;
        const h = hash(x + 200, z + 200);
        if (h % 10 < 3) continue;                       // gaps = sky-streets
        const roll = h % 10;
        const name = roll < 4 ? TALL[h % TALL.length]
          : roll < 7 ? FILLER[h % FILLER.length]
            : MID[h % MID.length];
        const scale = 1.4 + (h % 5) * 0.45;             // 1.4 .. 3.2
        const jx = (((h >> 4) % 5) - 2) * 0.5;
        const jz = (((h >> 8) % 5) - 2) * 0.5;
        const ry = (h >> 2 & 3) * (Math.PI / 2);
        place(name, x + jx, z + jz, scale, ry);
      }
    }

    // ---- gameplay decals (slip / drop-traps / escape / doors / gold pedestal) --
    const decal = (r, c, hex, op = 0.7, y = 0.05) => {
      const mesh = new THREE.Mesh(
        track(new THREE.PlaneGeometry(0.92, 0.92)),
        track(new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op,
          blending: THREE.AdditiveBlending, depthWrite: false })));
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(c + 0.5, y, r + 0.5); group.add(mesh); return mesh;
    };
    for (const [r, c] of world.slipCells) decal(r, c, 0x2ad0ff, 0.5);
    const grates = (world.dropTraps || []).map(([r, c]) => decal(r, c, 0xff5a1a, 0.6));
    const portals = world.escape.map(([r, c]) => decal(r, c, 0x49ff9e, 0.85, 0.06));

    // gold pedestal under the floating gold key
    const [gr, gc2] = world.goldHome;
    const pedestal = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.34, 0.42, 0.3, 16)),
      track(new THREE.MeshStandardMaterial({ color: 0x1a2240, emissive: 0xffc24b,
        emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.7 })));
    pedestal.position.set(gc2 + 0.5, 0.15, gr + 0.5); group.add(pedestal);

    // key-locked door shutters (visible until that side grabs its colored key)
    const slab = (r, c, hex) => {
      const mesh = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.96, 1.1, 0.22)),
        track(new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.9,
          transparent: true, opacity: 0.75, roughness: 0.3, metalness: 0.4 })));
      mesh.position.set(c + 0.5, 0.55, r + 0.5); group.add(mesh); return mesh;
    };
    const redShutter = slab(world.redDoor[0], world.redDoor[1], 0xff3b46);
    const blueShutter = slab(world.blueDoor[0], world.blueDoor[1], 0x3b7bff);

    // arena lights so the actors read against the dim night HDRI
    const goldLight = track(new THREE.PointLight(0xffc24b, 14, 14, 2));
    goldLight.position.set(gc2 + 0.5, 2.4, gr + 0.5);
    const gateLight = track(new THREE.PointLight(0x49ff9e, 16, 14, 2));
    gateLight.position.set(CTR, 2.2, 0.8);
    group.add(goldLight, gateLight);

    // ---- a few flying cars weaving around the towers (flavor) ------------------
    const cars = [];
    const carGeo = track(new THREE.BoxGeometry(0.9, 0.22, 0.36));
    for (let i = 0; i < 8; i++) {
      const hue = NEON[i % NEON.length];
      const body = new THREE.Mesh(carGeo, track(new THREE.MeshStandardMaterial({
        color: 0x111, emissive: hue, emissiveIntensity: 1.8, roughness: 0.4 })));
      group.add(body);
      cars.push({ body, r: 16 + (i % 4) * 5, h: 3 + (i % 4) * 2.2, spd: (i % 2 ? 1 : -1) * (0.12 + 0.04 * (i % 3)), ang: i * 0.8 });
    }

    function update(t, dt, frame) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.2);
      for (const p of portals) p.material.opacity = 0.55 + 0.35 * pulse;
      for (const g2 of grates) g2.material.opacity = 0.4 + 0.3 * Math.abs(Math.sin(t * 3));
      goldLight.intensity = 11 + 5 * Math.sin(t * 1.7);
      for (const car of cars) {
        car.ang += car.spd * dt;
        car.body.position.set(CTR + Math.cos(car.ang) * car.r, car.h + Math.sin(t * 0.7 + car.r) * 0.4, CTR + Math.sin(car.ang) * car.r);
        car.body.rotation.y = -car.ang + Math.PI / 2;
      }
      if (frame) { redShutter.visible = !frame.redKey; blueShutter.visible = !frame.blueKey; }
    }

    function dispose() {
      disposed = true;
      scene.remove(group);
      for (const o of trash) o.dispose?.();
    }

    return { group, update, dispose };
  },
};
