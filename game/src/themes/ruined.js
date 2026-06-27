// Round 4 - Ruined Kingdom (continuous DQN arena), from the REAL Boss Raid assets.
//
// LAYOUT (per the user's reference): the round STEP000 platform is the arena in
// the MIDDLE - the two DQN agents race on top of it - and the pack's TOWER and
// WALL ruins are ringed AROUND it as a backdrop. Models are OBJ/MTL (OBJLoader +
// MTLLoader). The env arena spans [0, A]^2 centred on the platform, so agent
// positions from the frame (frame.continuous, frame.red/blue = [x,z]) drop right
// onto the dais.
//
// Several models carry a leftover `wire_255…` helper that throws stray verts, so
// we size everything from ROBUST (outlier-trimmed) bounds, and flip the Z-up
// models (towers, the dais) upright with `zUp`.

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const ASSETS = './assets/models/ruined-kingdom/';
const AGENT_Y = 0.55;

// ---- tunable layout knobs ------------------------------------------------
const PLATFORM = 'BossRaidWorldHomeStep000';   // the round arena dais (image 2)
const PLATFORM_DIAM = 29;                       // a touch bigger than the 20x20 play area
// a broken parapet of walls rings the dais rim; a few tall towers accent it.
const WALL_RING_R = 13.0;      // walls sit ON the dais (radius < dais radius ~14.5)
const WALL_COUNT = 16;         // around the ring (some skipped = ruined gaps)
const WALL_LEN = 5.0;          // each wall ~this long; heights vary (ruined look)
const TOWER_RING_R = 16.5;     // towers just OUTSIDE the dais, as backdrop
const TOWER_H = 8.0;
const WALL_MODELS = ['BossRaidWorldHomeWall000', 'BossRaidWorldHomeWall001', 'BossRaidWorldHomeWall002'];
const TOWER_MODELS = ['BossRaidWorldHomeTower000', 'BossRaidWorldHomeTower001', 'BossRaidWorldHomeTower002'];

export const ruined = {
  name: 'ruined',
  title: 'Ruined Kingdom',
  sky: ['#2f2c44', '#585473', '#9f99b6'],
  fog: 0x7c7793,
  fogNear: 46,
  fogFar: 170,
  hemi: [0xc4cdea, 0x4c4660, 1.05],
  sun: 0xf6f0ff,
  sunIntensity: 3.4,
  fill: 0x97a3d8,
  fillIntensity: 0.4,
  exposure: 1.14,
  bloom: { strength: 0.3, radius: 0.5, threshold: 0.72 },
  redName: 'DQN',
  blueName: 'Double-DQN',

  buildScene(scene, world, { renderer } = {}) {
    const group = new THREE.Group();
    scene.add(group);
    const trash = [];
    const track = (o) => (trash.push(o), o);
    let disposed = false;
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

    const A = world.arena || 20;
    const C = A / 2;
    const obstacles = world.obstacles || [];
    const goalPos = world.goal || [C, 2.5];
    const goalR = world.goalR || 1.4;
    const spawns = world.spawns || { red: [3, A - 2.5], blue: [A - 3, A - 2.5] };

    // ---- OBJ pipeline ----------------------------------------------------
    const protos = new Map();
    function loadObj(name) {
      if (!protos.has(name)) {
        protos.set(name, new Promise((resolve) => {
          const finish = (obj) => {
            if (obj) obj.traverse((o) => {
              if (!o.isMesh) return;
              o.castShadow = true; o.receiveShadow = true;
              const ms = Array.isArray(o.material) ? o.material : [o.material];
              ms.forEach((m) => {
                if (!m) return;
                if (/wire/i.test(m.name || '')) { m.transparent = true; m.opacity = 0; m.depthWrite = false; return; }
                m.transparent = false; m.opacity = 1; m.depthWrite = true;
                if (m.color) m.color.setRGB(1, 1, 1);                  // pack Kd (0.588) dims the texture
                if (m.emissive) m.emissive.setRGB(0.05, 0.05, 0.06);   // faint lift so shadowed sides aren't black
                if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = maxAniso; }
              });
            });
            resolve(obj);
          };
          const objOnly = () => new OBJLoader().setPath(ASSETS).load(name + '.obj', finish, undefined, () => resolve(null));
          new MTLLoader().setPath(ASSETS).setResourcePath(ASSETS).load(
            name + '.mtl',
            (mats) => { mats.preload(); new OBJLoader().setMaterials(mats).setPath(ASSETS).load(name + '.obj', finish, undefined, objOnly); },
            undefined, objOnly,
          );
        }));
      }
      return protos.get(name);
    }

    // robust bounds: trim the 0.5% extreme verts each axis so a stray wire-helper
    // corner vertex can't blow up the scale.
    const _v = new THREE.Vector3();
    function robustBounds(obj) {
      obj.updateMatrixWorld(true);
      const xs = [], ys = [], zs = [];
      obj.traverse((o) => {
        const g = o.geometry;
        if (!o.isMesh || !g?.attributes?.position) return;
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); xs.push(_v.x); ys.push(_v.y); zs.push(_v.z); }
      });
      if (!xs.length) return null;
      // trim at least 8 verts each end (not just 2%) so the wire_ bounding-box
      // helper corners are removed even on small models (e.g. the stones), which
      // otherwise drop the measured floor far below the real geometry.
      const ext = (a) => {
        a.sort((m, n) => m - n);
        const N = a.length;
        const k = Math.min((N - 1) >> 1, Math.max(8, Math.floor(N * 0.02)));
        return [a[k], a[N - 1 - k]];
      };
      const [x0, x1] = ext(xs), [y0, y1] = ext(ys), [z0, z1] = ext(zs);
      return { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) };
    }

    // place a model at (x,z): fit by height (Y) or footprint (XZ); zUp stands a
    // Z-up model upright; topAt anchors its TOP at a Y; else base sits on baseY.
    function place(name, x, z, opts = {}) {
      loadObj(name).then((proto) => {
        if (disposed || !proto) return;
        const inner = proto.clone(true);
        if (opts.zUp) {
          inner.rotation.x = -Math.PI / 2;                  // dais: drum axis (Z) -> up
        } else if (opts.standUp) {
          // these ruins use inconsistent up-axes (tower = long Z, wall = long X,
          // with stray helper verts). Auto-stand: rotate the LONGEST real axis to Y.
          const b0 = robustBounds(inner);
          if (b0) {
            const ex = b0.max.x - b0.min.x, ey = b0.max.y - b0.min.y, ez = b0.max.z - b0.min.z;
            if (ex >= ey && ex >= ez) inner.rotation.z = Math.PI / 2;        // X -> Y
            else if (ez >= ey && ez >= ex) inner.rotation.x = -Math.PI / 2;  // Z -> Y
            // else Y is already the long axis -> upright
          }
        }
        const b = robustBounds(inner);
        if (!b) return;
        const dx = b.max.x - b.min.x, dy = b.max.y - b.min.y, dz = b.max.z - b.min.z;
        let s;
        if (opts.height != null) s = opts.height / Math.max(1e-4, dy);
        else if (opts.footprint != null) s = opts.footprint / Math.max(1e-4, Math.max(dx, dz));
        else s = opts.scale ?? 1;
        inner.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
        const wrap = new THREE.Group();
        wrap.add(inner);
        wrap.scale.setScalar(s);
        wrap.rotation.y = opts.ry ?? 0;
        const y = opts.topAt != null ? opts.topAt - dy * s : (opts.baseY ?? 0);
        wrap.position.set(x, y, z);
        group.add(wrap);
      });
    }

    // ---- the arena: STEP000 dais in the middle, agents race on its top ---
    place(PLATFORM, C, C, { zUp: true, footprint: PLATFORM_DIAM, topAt: 0 });

    // The explicit arena FLOOR the agents race on: a disc textured with the pack's
    // boss-arena rock plate, capped just above the dais. (Step000's own top wasn't
    // rendering as a usable surface, so this is the guaranteed play floor.) A skirt
    // gives it a solid thick edge so it never reads as a thin floating disc.
    const _ftex = new THREE.TextureLoader().setPath(ASSETS);
    const floorTex = (name, rep) => {
      const t = track(_ftex.load(name));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
      t.anisotropy = maxAniso; t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const FLOOR_R = 14.6;
    const floor = new THREE.Mesh(track(new THREE.CircleGeometry(FLOOR_R, 64)),
      track(new THREE.MeshStandardMaterial({
        map: floorTex('rockplateattack04_alb.png', 4), color: 0xd8d0c4, roughness: 0.95, metalness: 0,
      })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(C, 0.02, C);
    floor.receiveShadow = true;
    group.add(floor);
    const skirt = new THREE.Mesh(
      track(new THREE.CylinderGeometry(FLOOR_R, FLOOR_R * 0.9, 2.2, 64, 1, true)),
      track(new THREE.MeshStandardMaterial({ color: 0x4f4a5e, roughness: 1, side: THREE.DoubleSide })));
    skirt.position.set(C, -1.08, C);
    skirt.receiveShadow = true;
    group.add(skirt);

    // ---- broken WALL parapet around the dais rim (sits ON the platform) --
    for (let i = 0; i < WALL_COUNT; i++) {
      if (i % 5 === 4) continue;                       // gaps = ruined
      const ang = (i / WALL_COUNT) * Math.PI * 2;
      const x = C + Math.cos(ang) * WALL_RING_R;
      const z = C + Math.sin(ang) * WALL_RING_R;
      place(WALL_MODELS[i % WALL_MODELS.length], x, z,
        { zUp: true, footprint: WALL_LEN, ry: -ang + Math.PI / 2, baseY: 0 });
    }

    // ---- tall TOWERS as backdrop accents just outside the dais ----------
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + i * (Math.PI / 2);
      const x = C + Math.cos(ang) * TOWER_RING_R;
      const z = C + Math.sin(ang) * TOWER_RING_R;
      place(TOWER_MODELS[i % TOWER_MODELS.length], x, z,
        { zUp: true, height: TOWER_H, ry: -ang, baseY: -0.4 });
    }

    // ---- stone rubble on the gameplay obstacles -------------------------
    // Same Stone000 model as before; just lowered (it sits high, so STONE_Y drops
    // it onto the floor). Tune STONE_Y if it needs to go down/up more.
    const STONE_Y = -0.6;
    for (let i = 0; i < obstacles.length; i++) {
      const [ox, oz, r] = obstacles[i];
      place('BossRaidWorldHomeStone000', ox, oz, { zUp: true, footprint: r * 2.0, baseY: STONE_Y, ry: i * 1.3 });
    }

    // ---- glowing goal ring ----------------------------------------------
    const goalRing = new THREE.Group();
    const ring = new THREE.Mesh(track(new THREE.TorusGeometry(goalR, 0.16, 16, 44)),
      track(new THREE.MeshStandardMaterial({ color: 0xffe9a0, emissive: 0xffc23a, emissiveIntensity: 0.85, roughness: 0.4 })));
    ring.rotation.x = -Math.PI / 2;
    goalRing.add(ring);
    goalRing.position.set(goalPos[0], 0.08, goalPos[1]);
    group.add(goalRing);
    const goalGlow = track(new THREE.PointLight(0xffd866, 1.2, 9, 2));
    goalGlow.position.set(goalPos[0], 1.3, goalPos[1]);
    group.add(goalGlow);

    // ---- the two agents (from the continuous frame) ----------------------
    function makeOrb(color, emissive) {
      const wrap = new THREE.Group();
      const body = new THREE.Mesh(track(new THREE.SphereGeometry(0.5, 22, 16)),
        track(new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.1 })));
      body.castShadow = true;
      wrap.add(body);
      wrap.add(new THREE.PointLight(color, 0.5, 4, 2));
      group.add(wrap);
      return wrap;
    }
    const orbs = { red: makeOrb(0xff4d5e, 0x5a0a10), blue: makeOrb(0x4d8bff, 0x0a1a4a) };
    const cur = { red: { x: spawns.red[0], z: spawns.red[1] }, blue: { x: spawns.blue[0], z: spawns.blue[1] } };
    orbs.red.position.set(cur.red.x, AGENT_Y, cur.red.z);
    orbs.blue.position.set(cur.blue.x, AGENT_Y, cur.blue.z);

    // ---- animation + teardown -------------------------------------------
    function update(t, dt, frame) {
      goalRing.rotation.y += dt * 0.7;
      goalGlow.intensity = 0.9 + 0.3 * Math.sin(t * 2.0);
      if (frame && frame.continuous) {
        const k = 1 - Math.exp(-dt * 14);
        for (const side of ['red', 'blue']) {
          const p = frame[side];
          if (!p) continue;
          cur[side].x += (p[0] - cur[side].x) * k;
          cur[side].z += (p[1] - cur[side].z) * k;
          orbs[side].position.set(cur[side].x, AGENT_Y, cur[side].z);
        }
      }
    }

    function dispose() {
      disposed = true;
      scene.remove(group);
      for (const o of trash) o.dispose?.();
    }

    return { group, update, dispose };
  },
};
