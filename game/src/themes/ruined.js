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

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const ASSETS = "./assets/models/ruined-kingdom/";
const FALLING_ASSETS = "./assets/models/falling/";
const AGENT_Y = 0.55;
const FALLING_PROP_SCALE = 0.02;
const FALLING_TOP_Y = 30;
const FALLING_BOTTOM_Y = -13;
const FALLING_FADE_START = 0.7;
const FALLING_END_SCALE = 0.18;

// ---- tunable layout knobs ------------------------------------------------
const PLATFORM = "BossRaidWorldHomeStep000"; // the round arena dais (image 2)
const PLATFORM_DIAM = 33; // matches the floor disc (FLOOR_R 16.5)
// a broken parapet of walls rings the dais rim; a few tall towers accent it.
const WALL_RING_R = 15.7; // walls out at the rim, clear of the play area
const WALL_COUNT = 12; // around the ring (some skipped = ruined gaps)
const WALL_LEN = 9.0; // each wall ~this long; heights vary (ruined look)
const TOWER_RING_R = 16.0; // towers at the rim, just behind the walls
const TOWER_H = 18.0; // tall, imposing backdrop
const WALL_MODELS = [
  "BossRaidWorldHomeWall000",
  "BossRaidWorldHomeWall001",
  "BossRaidWorldHomeWall002",
];
const TOWER_MODELS = [
  "BossRaidWorldHomeTower000",
  "BossRaidWorldHomeTower001",
  "BossRaidWorldHomeTower002",
];
const FALLING_PROP_TYPES = [
  {
    file: "rubber-dorrie/SouvenirLake2.dae",
    height: 1.7,
    spin: [-0.2, 0.7, 0.32],
    rot: [0.25, 0.8, -0.45],
  },
  {
    file: "moon-lamp/SouvenirMoon2.dae",
    height: 1.25,
    spin: [-0.18, 0.45, 0.52],
    rot: [0.55, -0.8, -0.2],
  },
  {
    file: "t-rex-model/T-Rex Model/T-Rex.dae",
    height: 2.1,
    spin: [0.2, -0.6, 0.18],
    rot: [-0.25, 1.1, 0.1],
  },
  {
    file: "triceratops-trophy/Triceratops Trophy/Triceratops Trophy.dae",
    height: 1.8,
    spin: [-0.15, 0.52, -0.24],
    rot: [0.2, -1.2, 0.34],
  },
  {
    file: "jaxi-statue/SouvenirSand2.dae",
    height: 1.35,
    spin: [0.36, 0.42, -0.18],
    rot: [0.1, 0.4, -0.2],
  },
  {
    file: "jizo-statue/SouvenirSky2.dae",
    height: 1.2,
    spin: [-0.28, 0.2, 0.45],
    rot: [-0.3, -0.2, 0.18],
  },
  {
    file: "paper-lantern/SouvenirSky1.dae",
    height: 1.15,
    spin: [0.18, -0.34, 0.58],
    rot: [0.4, 0.1, -0.3],
  },
  {
    file: "butterfly-mobile/SouvenirCrash2.dae",
    height: 1.45,
    spin: [-0.22, 0.64, 0.28],
    rot: [0.25, -0.6, 0.22],
  },
  {
    file: "plush-frog/SouvenirHat1.dae",
    height: 1.3,
    spin: [0.42, -0.22, 0.35],
    rot: [-0.18, 0.7, -0.15],
  },
  {
    file: "potted-palm-tree/SouvenirCrash1.dae",
    height: 1.55,
    spin: [-0.24, 0.38, -0.2],
    rot: [0.28, -0.8, 0.2],
  },
  {
    file: "sand-jar/SouvenirSea1.dae",
    height: 1.25,
    spin: [0.3, 0.48, -0.35],
    rot: [0.35, 0.4, -0.32],
  },
  {
    file: "souvenir-forks/SouvenirLava1.dae",
    height: 1.5,
    spin: [-0.3, -0.5, 0.26],
    rot: [-0.2, -0.5, 0.3],
  },
  {
    file: "watering-can/SouvenirForest2.dae",
    height: 1.55,
    spin: [0.24, -0.4, -0.44],
    rot: [0.15, 1.0, -0.25],
  },
  {
    file: "underwater-dome/SouvenirLake1.dae",
    height: 1.65,
    spin: [-0.34, 0.32, 0.2],
    rot: [0.22, -0.3, -0.18],
  },
];
const FALLING_SIDE_LANES = [
  { x: -10, z: -5 },
  { x: 30, z: -5 },
  { x: -13, z: 0 },
  { x: 33, z: 0 },
  { x: -16, z: 5 },
  { x: 36, z: 5 },
  { x: -11, z: 10 },
  { x: 31, z: 10 },
  { x: -15, z: 15 },
  { x: 35, z: 15 },
  { x: -12, z: 20 },
  { x: 32, z: 20 },
  { x: -17, z: 25 },
  { x: 37, z: 25 },
  { x: -10, z: 30 },
  { x: 30, z: 30 },
  { x: -14, z: 35 },
  { x: 34, z: 35 },
];
const FALLING_PROPS = Array.from({ length: 90 }, (_, i) => {
  const type = FALLING_PROP_TYPES[i % FALLING_PROP_TYPES.length];
  const lane = FALLING_SIDE_LANES[i % FALLING_SIDE_LANES.length];
  const wave = Math.floor(i / FALLING_SIDE_LANES.length);
  const xJitter = (((i * 37) % 13) - 6) * 0.22;
  const zJitter = (((i * 19) % 11) - 5) * 0.18;
  // push each lane a little further from the arena centre (x=10) so even the big
  // props (T-Rex, triceratops) fully clear the tower ring.
  const laneX = lane.x < 10 ? lane.x - 3 : lane.x + 3;
  return {
    ...type,
    x: laneX + xJitter,
    z: lane.z + zJitter,
    height: type.height * (0.86 + ((i * 11) % 7) * 0.045),
    speed: 0.056 + ((i * 17) % 10) * 0.0055,
    phase: (i * 0.173 + wave * 0.071) % 1,
    topY: FALLING_TOP_Y + (wave % 4) * 5,
    bottomY: FALLING_BOTTOM_Y - (wave % 3) * 2,
  };
});

export const ruined = {
  name: "ruined",
  title: "Ruined Kingdom",
  sky: ["#121020", "#27243c", "#46425f"], // deep, moody dusk
  fog: 0x1a1444, // dark indigo so distant objects melt into the cosmic background
  fogNear: 44,
  fogFar: 175,
  hemi: [0xaab4dc, 0x322e46, 0.68], // ambient
  sun: 0xffefcf, // warm key, kept for contrast in the dark
  sunIntensity: 3.5,
  fill: 0x8ea0d8,
  fillIntensity: 0.22,
  exposure: 1.0, // a bit brighter than the dark pass
  bloom: { strength: 0.34, radius: 0.5, threshold: 0.72 }, // goal/agents glow pops
  redName: "DQN",
  blueName: "Double-DQN",

  buildScene(scene, world, { renderer } = {}) {
    const group = new THREE.Group();
    scene.add(group);
    const trash = [];
    const textures = new Set();
    const track = (o) => (trash.push(o), o);
    const trackTexture = (tex) => {
      if (tex && tex.isTexture && !textures.has(tex)) {
        textures.add(tex);
        trash.push(tex);
      }
      return tex;
    };
    let disposed = false;
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
    const collada = new ColladaLoader();
    const fallingProtos = new Map();
    const fallingObjects = [];

    const A = world.arena || 20;
    const C = A / 2;
    const obstacles = world.obstacles || [];
    const goalPos = world.goal || [C, 2.5];
    const goalR = world.goalR || 1.4;
    const spawns = world.spawns || {
      red: [3, A - 2.5],
      blue: [A - 3, A - 2.5],
    };

    // ---- cosmic BACKGROUND: a starfield + soft nebula behind everything ---
    // overrides the flat gradient sky for this round so the arena reads as
    // floating in a starry void. (set on scene.background; the next round's
    // applyTheme restores its own sky.)
    const bgRnd = (n) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const hexA = (hex, a) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };
    const bgTex = (() => {
      const W = 1600,
        H = 900;
      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const g = cv.getContext("2d");
      const base = g.createLinearGradient(0, 0, 0, H);
      base.addColorStop(0.0, "#05030f");
      base.addColorStop(0.55, "#0c0a22");
      base.addColorStop(1.0, "#1a1444");
      g.fillStyle = base;
      g.fillRect(0, 0, W, H);
      // soft nebula clouds (additive)
      g.globalCompositeOperation = "lighter";
      const neb = ["#6a2c9a", "#2c5f9a", "#9a2c6f", "#2c9a86"];
      for (let i = 0; i < 8; i++) {
        const cx = bgRnd(i) * W;
        const cy = bgRnd(i + 9) * H;
        const r = 180 + bgRnd(i + 3) * 360;
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, hexA(neb[i % neb.length], 0.16 + bgRnd(i + 5) * 0.14));
        rg.addColorStop(1, hexA(neb[i % neb.length], 0));
        g.fillStyle = rg;
        g.fillRect(0, 0, W, H);
      }
      // stars
      for (let i = 0; i < 420; i++) {
        const s = bgRnd(i + 300);
        const r = s < 0.93 ? 0.5 + s * 1.1 : 1.6 + bgRnd(i + 400) * 1.6;
        g.fillStyle = `rgba(255,255,255,${0.45 + bgRnd(i + 500) * 0.55})`;
        g.beginPath();
        g.arc(bgRnd(i + 100) * W, bgRnd(i + 200) * H, r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
      const t = track(new THREE.CanvasTexture(cv));
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    scene.background = bgTex;

    // ---- OBJ pipeline ----------------------------------------------------
    // MTLLoader only loads the albedo, so the stone is flat/dull. Upgrade each
    // material to PBR and load the pack's sibling _nrm normal map (named like the
    // albedo) - the surface relief is what makes the stone read as stone.
    const auxTex = new THREE.TextureLoader().setPath(ASSETS);
    function siblingTex(albMap, suffix) {
      const src = albMap.image?.src || albMap.source?.data?.src || "";
      const file = src.split("/").pop().split("?")[0];
      if (!file || !/_alb\.png$/i.test(file)) return null;
      const t = track(auxTex.load(file.replace(/_alb\.png$/i, suffix)));
      t.wrapS = albMap.wrapS;
      t.wrapT = albMap.wrapT;
      t.repeat.copy(albMap.repeat);
      t.anisotropy = maxAniso;
      return t;
    }
    function upgradeMat(m) {
      if (!m) return m;
      // hide the wire helper AND any grass/plant/flower cards (e.g. Step000's
      // PlantsTower) - we don't want greenery in the ruined arena.
      if (/wire|grass|plant|flower|leaf|weed/i.test(m.name || "")) {
        m.transparent = true;
        m.opacity = 0;
        m.depthWrite = false;
        return m;
      }
      const map = m.map || null;
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = maxAniso;
      }
      const std = track(
        new THREE.MeshStandardMaterial({
          map,
          color: 0xffffff,
          roughness: 0.85,
          metalness: 0.0,
          emissive: new THREE.Color(0.02, 0.02, 0.03),
        }),
      );
      if (map) {
        const nrm = siblingTex(map, "_nrm.png");
        if (nrm) {
          std.normalMap = nrm;
          std.normalScale.set(1.3, 1.3);
        }
      }
      std.name = m.name;
      return std;
    }
    const protos = new Map();
    function loadObj(name) {
      if (!protos.has(name)) {
        protos.set(
          name,
          new Promise((resolve) => {
            const finish = (obj) => {
              if (obj)
                obj.traverse((o) => {
                  if (!o.isMesh) return;
                  const ms = Array.isArray(o.material)
                    ? o.material
                    : [o.material];
                  // a mesh that's entirely wire/grass/plant: hide it OUTRIGHT so it
                  // casts no shadow either (opacity 0 alone still shadows).
                  if (
                    ms.every((m) =>
                      /wire|grass|plant|flower|leaf|weed/i.test(m?.name || ""),
                    )
                  ) {
                    o.visible = false;
                    o.castShadow = false;
                    o.receiveShadow = false;
                    return;
                  }
                  o.castShadow = true;
                  o.receiveShadow = true;
                  o.material = Array.isArray(o.material)
                    ? o.material.map(upgradeMat)
                    : upgradeMat(o.material);
                });
              resolve(obj);
            };
            const objOnly = () =>
              new OBJLoader()
                .setPath(ASSETS)
                .load(name + ".obj", finish, undefined, () => resolve(null));
            new MTLLoader()
              .setPath(ASSETS)
              .setResourcePath(ASSETS)
              .load(
                name + ".mtl",
                (mats) => {
                  mats.preload();
                  new OBJLoader()
                    .setMaterials(mats)
                    .setPath(ASSETS)
                    .load(name + ".obj", finish, undefined, objOnly);
                },
                undefined,
                objOnly,
              );
          }),
        );
      }
      return protos.get(name);
    }

    function disposeTree(root) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          for (const value of Object.values(mat)) {
            if (value?.isTexture) value.dispose?.();
          }
          mat.dispose?.();
        }
      });
    }

    function tuneFallingMaterial(mat) {
      if (!mat)
        return track(
          new THREE.MeshStandardMaterial({
            color: 0xb8b0aa,
            roughness: 0.82,
            metalness: 0,
          }),
        );
      const m = mat.clone();
      if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace;
        m.map.anisotropy = maxAniso;
        trackTexture(m.map);
      }
      if (m.normalMap) trackTexture(m.normalMap);
      if (m.roughnessMap) trackTexture(m.roughnessMap);
      if (m.alphaMap) {
        trackTexture(m.alphaMap);
        m.transparent = true;
        m.alphaTest = Math.max(m.alphaTest || 0, 0.16);
      }
      if (
        /leaf|plant|grass|flower|glass|water|paper|cloth|flag|fence/i.test(
          m.name || "",
        )
      ) {
        m.side = THREE.DoubleSide;
        m.transparent = true;
        m.alphaTest = Math.max(m.alphaTest || 0, 0.12);
      }
      if ("emissiveIntensity" in m)
        m.emissiveIntensity = Math.min(m.emissiveIntensity || 0, 0.35);
      if ("shininess" in m) m.shininess = Math.min(m.shininess || 30, 10);
      track(m);
      return m;
    }

    function prepareFalling(asset) {
      const root = asset.scene;
      root.rotation.set(0, 0, 0);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = false;
        track(o.geometry);
        o.material = Array.isArray(o.material)
          ? o.material.map(tuneFallingMaterial)
          : tuneFallingMaterial(o.material);
      });
      root.updateMatrixWorld(true);
      const b = robustBounds(root) || new THREE.Box3().setFromObject(root);
      root.userData.bounds = {
        cx: (b.min.x + b.max.x) * 0.5,
        cy: (b.min.y + b.max.y) * 0.5,
        cz: (b.min.z + b.max.z) * 0.5,
        minY: b.min.y,
        h: Math.max(0.001, b.max.y - b.min.y),
        w: Math.max(0.001, b.max.x - b.min.x),
        d: Math.max(0.001, b.max.z - b.min.z),
      };
      return root;
    }

    function loadFalling(name) {
      if (!fallingProtos.has(name)) {
        fallingProtos.set(
          name,
          collada
            .loadAsync(FALLING_ASSETS + name)
            .then((asset) => {
              const proto = prepareFalling(asset);
              if (disposed) disposeTree(proto);
              return proto;
            })
            .catch((err) => {
              console.warn(`Could not load falling prop ${name}`, err);
              return null;
            }),
        );
      }
      return fallingProtos.get(name);
    }

    function addFallingProp(spec) {
      loadFalling(spec.file).then((proto) => {
        if (disposed || !proto) return;
        const b = proto.userData.bounds;
        const inner = cloneSkinned(proto);
        inner.position.set(-b.cx, -b.cy, -b.cz);
        const fadeMats = [];
        inner.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const cloned = mats.map((mat) => {
            if (!mat) return mat;
            const m = mat.clone();
            m.transparent = true;
            m.userData.baseOpacity = m.opacity ?? 1;
            fadeMats.push(m);
            track(m);
            return m;
          });
          o.material = Array.isArray(o.material) ? cloned : cloned[0];
        });
        const largest = Math.max(b.w, b.h, b.d);
        const scale =
          spec.height != null
            ? spec.height / largest
            : spec.footprint != null
              ? spec.footprint / largest
              : (spec.scale ?? 1);
        const baseScale = scale * FALLING_PROP_SCALE;
        const wrap = new THREE.Group();
        wrap.add(inner);
        wrap.scale.setScalar(baseScale);
        wrap.rotation.set(
          spec.rot?.[0] ?? 0,
          spec.rot?.[1] ?? 0,
          spec.rot?.[2] ?? 0,
        );
        const topY = spec.topY ?? FALLING_TOP_Y;
        const bottomY = spec.bottomY ?? FALLING_BOTTOM_Y;
        wrap.position.set(spec.x, topY, spec.z);
        group.add(wrap);
        fallingObjects.push({ ...spec, wrap, fadeMats, baseScale, topY, bottomY });
      });
    }

    // robust bounds: trim the 0.5% extreme verts each axis so a stray wire-helper
    // corner vertex can't blow up the scale.
    const _v = new THREE.Vector3();
    function robustBounds(obj) {
      obj.updateMatrixWorld(true);
      const xs = [],
        ys = [],
        zs = [];
      obj.traverse((o) => {
        const g = o.geometry;
        if (!o.isMesh || !g?.attributes?.position) return;
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          _v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          xs.push(_v.x);
          ys.push(_v.y);
          zs.push(_v.z);
        }
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
      const [x0, x1] = ext(xs),
        [y0, y1] = ext(ys),
        [z0, z1] = ext(zs);
      return {
        min: new THREE.Vector3(x0, y0, z0),
        max: new THREE.Vector3(x1, y1, z1),
      };
    }

    // place a model at (x,z): fit by height (Y) or footprint (XZ); zUp stands a
    // Z-up model upright; topAt anchors its TOP at a Y; else base sits on baseY.
    function place(name, x, z, opts = {}) {
      loadObj(name).then((proto) => {
        if (disposed || !proto) return;
        const inner = proto.clone(true);
        if (opts.zUp) {
          inner.rotation.x = Math.PI / 2; // Z-up models stand upright (was flipped: down-up)
        } else if (opts.standUp) {
          // these ruins use inconsistent up-axes (tower = long Z, wall = long X,
          // with stray helper verts). Auto-stand: rotate the LONGEST real axis to Y.
          const b0 = robustBounds(inner);
          if (b0) {
            const ex = b0.max.x - b0.min.x,
              ey = b0.max.y - b0.min.y,
              ez = b0.max.z - b0.min.z;
            if (ex >= ey && ex >= ez)
              inner.rotation.z = Math.PI / 2; // X -> Y
            else if (ez >= ey && ez >= ex) inner.rotation.x = -Math.PI / 2; // Z -> Y
            // else Y is already the long axis -> upright
          }
        }
        const b = robustBounds(inner);
        if (!b) return;
        const dx = b.max.x - b.min.x,
          dy = b.max.y - b.min.y,
          dz = b.max.z - b.min.z;
        let s;
        if (opts.height != null) s = opts.height / Math.max(1e-4, dy);
        else if (opts.footprint != null)
          s = opts.footprint / Math.max(1e-4, Math.max(dx, dz));
        else s = opts.scale ?? 1;
        inner.position.set(
          -(b.min.x + b.max.x) / 2,
          -b.min.y,
          -(b.min.z + b.max.z) / 2,
        );
        const wrap = new THREE.Group();
        wrap.add(inner);
        wrap.scale.setScalar(s);
        wrap.rotation.y = opts.ry ?? 0;
        const y = opts.topAt != null ? opts.topAt - dy * s : (opts.baseY ?? 0);
        wrap.position.set(x, y, z);
        group.add(wrap);
      });
    }

    // ---- the arena: a clean circular STONE DRUM (agents race on its top) ---
    // Built from primitives so it's a PERFECT circle: a rock-plate top + textured
    // drum sides + a dark bottom cap. (The Step000 model wasn't cleanly round.)
    const _ftex = new THREE.TextureLoader().setPath(ASSETS);
    const tex = (name, rx, ry, srgb = true) => {
      const t = track(_ftex.load(name));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.anisotropy = maxAniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace; // normal maps must stay linear
      return t;
    };
    const FLOOR_R = 16.5;
    const floor = new THREE.Mesh(
      track(new THREE.CircleGeometry(FLOOR_R, 96)),
      track(
        new THREE.MeshStandardMaterial({
          map: tex("rockplateattack04_alb.png", 4, 4),
          normalMap: tex("rockplateattack04_nrm.png", 4, 4, false),
          color: 0xd8d0c4,
          roughness: 0.82,
          metalness: 0,
        }),
      ),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(C, 0.02, C);
    floor.receiveShadow = true;
    group.add(floor);
    // the decorated Step000 drum back as the PEDESTAL under the clean floor disc:
    // its top tucks just under the disc (topAt 0) so the floor stays a clean
    // circle, and the detailed drum sides show below the rim.
    place(PLATFORM, C, C, { zUp: true, footprint: PLATFORM_DIAM, topAt: 0 });

    // ---- broken WALL parapet around the rim (one gap = the open gate) -----
    const RING_ROT = (4 * Math.PI) / 180; // 4 deg spin of the whole ring
    for (let i = 0; i < WALL_COUNT; i++) {
      if (i % 5 === 4) continue; // gaps = ruined (one is the open gate)
      const ang = (i / WALL_COUNT) * Math.PI * 2 + RING_ROT;
      const x = C + Math.cos(ang) * WALL_RING_R;
      const z = C + Math.sin(ang) * WALL_RING_R;
      place(WALL_MODELS[i % WALL_MODELS.length], x, z, {
        zUp: true,
        footprint: WALL_LEN,
        ry: -ang + Math.PI / 2 + Math.PI, // 180: face the inside of the circle
        baseY: 0,
      });
    }

    // ---- tall TOWERS as backdrop accents just outside the dais ----------
    for (let i = 0; i < 4; i++) {
      const ang = Math.PI / 4 + i * (Math.PI / 2);
      const x = C + Math.cos(ang) * TOWER_RING_R;
      const z = C + Math.sin(ang) * TOWER_RING_R;
      place(TOWER_MODELS[i % TOWER_MODELS.length], x, z, {
        zUp: true,
        height: TOWER_H,
        ry: -ang + Math.PI, // 180: face the inside of the circle
        baseY: -0.4,
      });
    }

    // ---- impossible falling souvenirs beside the tower -------------------
    // These are visual-only background props. They fall in side lanes outside
    // the tower ring and cast no shadows, so they cannot affect the DQN arena.
    FALLING_PROPS.forEach(addFallingProp);

    // ---- the TIME RING: a glowing clock-seal the dais floats on ----------
    // additive glow (bloom-friendly): a soft energy haze, a rune-seal with Roman
    // numerals (a clock face), concentric rings and sweeping clock hands.
    // (energy haze removed - the falling props passed through its glow)

    const sealTex = (() => {
      const S = 1024,
        cx = 512,
        cy = 512;
      const cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const g = cv.getContext("2d");
      g.clearRect(0, 0, S, S);
      g.strokeStyle = "rgba(150,225,255,1)";
      g.lineWidth = 4;
      for (const r of [210, 300, 470, 500]) {
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.lineWidth = 3;
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * 470, cy + Math.sin(a) * 470);
        g.lineTo(cx + Math.cos(a) * 500, cy + Math.sin(a) * 500);
        g.stroke();
      }
      g.fillStyle = "rgba(205,185,255,1)";
      g.font = "bold 72px 'Times New Roman', serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const NUM = [
        "XII",
        "I",
        "II",
        "III",
        "IV",
        "V",
        "VI",
        "VII",
        "VIII",
        "IX",
        "X",
        "XI",
      ];
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
        g.fillText(NUM[i], cx + Math.cos(a) * 250, cy + Math.sin(a) * 250);
      }
      return track(new THREE.CanvasTexture(cv));
    })();
    const sealSpin = new THREE.Group();
    sealSpin.position.set(C, -2.5, C);
    group.add(sealSpin);
    const seal = new THREE.Mesh(
      track(new THREE.CircleGeometry(54, 80)),
      track(
        new THREE.MeshBasicMaterial({
          map: sealTex,
          transparent: true,
          opacity: 0.9, // ~10% less glow
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      ),
    );
    seal.rotation.x = -Math.PI / 2;
    sealSpin.add(seal);

    const glowMat = (c) =>
      track(
        new THREE.MeshBasicMaterial({
          color: c,
          transparent: true,
          opacity: 0.81, // ~10% less glow
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
    const ringA = new THREE.Mesh(
      track(new THREE.TorusGeometry(30, 0.4, 14, 140)),
      glowMat(0x66e6ff),
    );
    const ringB = new THREE.Mesh(
      track(new THREE.TorusGeometry(45, 0.55, 14, 160)),
      glowMat(0xb070ff),
    );
    for (const r of [ringA, ringB]) {
      r.rotation.x = Math.PI / 2;
      r.position.set(C, -2, C);
      group.add(r);
    }

    const mkHand = (len, w, c) => {
      const grp = new THREE.Group();
      grp.position.set(C, -1.9, C);
      const bar = new THREE.Mesh(
        track(new THREE.BoxGeometry(len, 0.05, w)),
        glowMat(c),
      );
      bar.position.x = len / 2 - 3;
      grp.add(bar);
      group.add(grp);
      return grp;
    };
    const handMinute = mkHand(50, 0.7, 0x8fe6ff);
    const handHour = mkHand(34, 1.1, 0xc79bff);

    // obstacles are invisible gameplay collisions only - no rock/grass markers.

    // (goal marker removed - no glowing ring on the arena)

    // The two arena racers are the CHOSEN characters, driven by the shared actors
    // system in arena mode (see main.js / live.js setArena) - no placeholder orbs.

    // ---- animation + teardown -------------------------------------------
    function update(t, dt, frame) {
      sealSpin.rotation.y += dt * 0.03; // the clock face drifts slowly
      ringA.scale.setScalar(1 + Math.sin(t * 1.3) * 0.03);
      ringB.scale.setScalar(1 + Math.sin(t * 1.3 + 1.5) * 0.03);
      handMinute.rotation.y -= dt * 0.45; // sweeping clock hands
      handHour.rotation.y -= (dt * 0.45) / 12;
      for (const obj of fallingObjects) {
        const u = (t * (obj.speed ?? 0.065) + (obj.phase ?? 0)) % 1;
        const fade = THREE.MathUtils.smoothstep(u, FALLING_FADE_START, 1);
        const opacity = 1 - fade;
        obj.wrap.position.set(
          obj.x,
          THREE.MathUtils.lerp(obj.topY, obj.bottomY, u),
          obj.z,
        );
        obj.wrap.scale.setScalar(
          obj.baseScale * THREE.MathUtils.lerp(1, FALLING_END_SCALE, fade),
        );
        for (const mat of obj.fadeMats) mat.opacity = mat.userData.baseOpacity * opacity;
        obj.wrap.rotation.x = (obj.rot?.[0] ?? 0) + t * (obj.spin?.[0] ?? 0);
        obj.wrap.rotation.y = (obj.rot?.[1] ?? 0) + t * (obj.spin?.[1] ?? 0);
        obj.wrap.rotation.z = (obj.rot?.[2] ?? 0) + t * (obj.spin?.[2] ?? 0);
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
