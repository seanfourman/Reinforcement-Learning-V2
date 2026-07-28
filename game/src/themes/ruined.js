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
const BANZAI_DIR = "./assets/objects/Banzai%20Bill/";
const BANZAI_ASSET = `${BANZAI_DIR}KillerMagnum.dae`;
const BANZAI_LENGTH = 2;
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
  subtitle: "The Fallen Keep",
  // pull the camera further back than the default (30) - this arena reads better
  // from a wider shot
  camera: { startDist: 38, maxDist: 38 },
  sky: ["#030303", "#0a0a0b", "#151515"], // neutral black cosmic dusk
  fog: 0x101010, // charcoal so distant objects melt into the cosmic background
  fogNear: 44,
  fogFar: 175,
  hemi: [0xd3cec3, 0x2d2b27, 0.68], // neutral ambient
  sun: 0xffefcf, // warm key, kept for contrast in the dark
  sunIntensity: 3.5,
  fill: 0xb8b0a4,
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
    // Preserve the original Ruined Kingdom composition at (10, 10). The 10 m
    // gameplay bounds are mapped into this existing scene; they must not drag
    // the platform away from its camera, towers, and hard-authored backdrop.
    const C = world.sceneCenter?.[0] ?? A / 2;
    const sceneScale = Math.max(0.01, Number(world.sceneScale) || 1);
    const sceneCenter = world.sceneCenter || [C, C];
    const sceneOffset = {
      x: sceneCenter[0] - (A * sceneScale) / 2,
      z: sceneCenter[1] - (A * sceneScale) / 2,
    };
    const simToScene = (p) => ({
      x: p[0] * sceneScale + sceneOffset.x,
      z: p[1] * sceneScale + sceneOffset.z,
    });
    const obstacles = world.obstacles || [];
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
      base.addColorStop(0.0, "#010101");
      base.addColorStop(0.55, "#070708");
      base.addColorStop(1.0, "#121212");
      g.fillStyle = base;
      g.fillRect(0, 0, W, H);
      // soft nebula clouds (additive)
      g.globalCompositeOperation = "lighter";
      const neb = ["#343434", "#46423b", "#2a2a2a", "#565047"];
      for (let i = 0; i < 8; i++) {
        const cx = bgRnd(i) * W;
        const cy = bgRnd(i + 9) * H;
        const r = 180 + bgRnd(i + 3) * 360;
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(
          0,
          hexA(neb[i % neb.length], 0.16 + bgRnd(i + 5) * 0.14),
        );
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
        fallingObjects.push({
          ...spec,
          wrap,
          fadeMats,
          baseScale,
          topY,
          bottomY,
        });
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
      g.strokeStyle = "rgba(255,205,110,1)";
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
      g.fillStyle = "rgba(255,233,180,1)";
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
      glowMat(0xffd27a),
    );
    const ringB = new THREE.Mesh(
      track(new THREE.TorusGeometry(45, 0.55, 14, 160)),
      glowMat(0xffa64d),
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
    const handMinute = mkHand(50, 0.7, 0xffe6a8);
    const handHour = mkHand(34, 1.1, 0xffbe66);

    // obstacles are invisible gameplay collisions only - no rock/grass markers.

    // (goal marker removed - no glowing ring on the arena)

    // The two arena racers are the CHOSEN characters, driven by the shared actors
    // system in arena mode (see main.js / live.js setArena) - no placeholder orbs.

    // ---- Round-4 Banzai Bills -------------------------------------------
    // The backend owns gameplay/collisions. This layer reconciles its stable IDs
    // into smoothed model clones, so slow decision playback still reads as flight.
    let missilePrototype = null;
    const missileVisuals = new Map();
    const explosionFx = [];
    const seenExplosionIds = new Set();
    const seenExplosionOrder = [];
    const MAX_EXPLOSION_FX = 6;
    const MAX_EXPLOSION_LIGHTS = 3;
    const MAX_NEW_EXPLOSIONS_PER_FRAME = 2;
    let explosionSpawnCredit = MAX_NEW_EXPLOSIONS_PER_FRAME;
    const disposeMissileModel = (model) => {
      const skeletons = new Set();
      model?.traverse((o) => {
        if (o.isSkinnedMesh && o.skeleton) skeletons.add(o.skeleton);
      });
      // cloneSkinned creates per-clone skeleton/bone textures. Geometry and
      // materials stay shared with the prototype, so dispose only the skeletons.
      for (const skeleton of skeletons) skeleton.dispose?.();
    };
    // ColladaLoader cannot resolve this pack's sampler bindings, so load its PBR
    // textures explicitly and match them to the exported material names.
    const banzaiTextureLoader = new THREE.TextureLoader();
    const banzaiTexture = (name, srgb = false) => {
      const texture = trackTexture(
        banzaiTextureLoader.load(`${BANZAI_DIR}${name}`),
      );
      texture.anisotropy = maxAniso;
      if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    };
    const banzaiBodyMaps = {
      map: banzaiTexture("KillerBody_alb.0.png", true),
      normalMap: banzaiTexture("KillerBody_nrm.png"),
      roughnessMap: banzaiTexture("KillerBody_rgh.png"),
      metalnessMap: banzaiTexture("KillerBody_mtl.png"),
    };
    const banzaiEyeMaps = [0, 1, 2].map((i) => ({
      map: banzaiTexture(`KillerEye_alb.${i}.png`, true),
      normalMap: banzaiTexture(`KillerEye_nrm.${i}.png`),
      roughnessMap: banzaiTexture(`KillerEye_rgh.${i}.png`),
      emissiveMap: banzaiTexture(`KillerEye_emm.${i}.png`, true),
    }));

    const missileReady = collada
      .loadAsync(BANZAI_ASSET)
      .then((asset) => {
        if (disposed) {
          disposeTree(asset.scene);
          return;
        }
        const root = asset.scene; // preserve the loader's Z_UP correction
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          if (!o.isMesh) return;
          // Capture-only Mario moustache. It is exported as its own skinned
          // mesh, so hiding it leaves the Banzai body, mouth and eyes intact.
          if (o.name === "Eye1__BodyMT00") o.visible = false;
          o.castShadow = true;
          o.receiveShadow = false;
          track(o.geometry);
          const old = Array.isArray(o.material) ? o.material : [o.material];
          const upgraded = old.map((mat) => {
            if (!mat) return mat;
            const materialName = mat.name || o.name || "";
            const eyeMatch = /EyeMT0?([0-2])/i.exec(materialName);
            const eyeIndex = eyeMatch ? Number(eyeMatch[1]) : -1;
            const eye = eyeIndex >= 0;
            const maps = eye ? banzaiEyeMaps[eyeIndex] : banzaiBodyMaps;
            const next = track(
              new THREE.MeshStandardMaterial({
                name: mat.name,
                ...maps,
                color: 0xffffff,
                roughness: 1,
                metalness: eye ? 0.06 : 1,
                normalScale: new THREE.Vector2(0.72, 0.72),
                emissive: eye ? 0xffffff : 0x000000,
                emissiveIntensity: eye ? 0.8 : 0,
              }),
            );
            return next;
          });
          o.material = Array.isArray(o.material) ? upgraded : upgraded[0];
        });
        root.updateMatrixWorld(true);
        // This is a genuinely skinned asset: bounds must include bone transforms.
        // The static-geometry helper used by the falling props underestimates it
        // by roughly 5x and produces a giant, badly centred missile.
        const bounds = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const centre = new THREE.Vector3();
        bounds.getSize(size);
        bounds.getCenter(centre);
        root.position.sub(centre);
        // ColladaLoader leaves this model's nose along native +Y. Pitch the
        // inner asset once so the outer flight group can steer around world Y.
        const oriented = new THREE.Group();
        oriented.rotation.x = Math.PI / 2;
        oriented.add(root);
        const holder = new THREE.Group();
        holder.add(oriented);
        holder.scale.setScalar(
          BANZAI_LENGTH / Math.max(0.001, size.x, size.y, size.z),
        );
        missilePrototype = holder;
      })
      .catch((err) => {
        console.warn("Could not load Banzai Bill", err);
      });

    // Odyssey's Banzai Bill does not use a photographic fireball. Its impact is
    // a very short cluster of irregular toon-shaded blobs, followed (on walls)
    // by a few pale dust puffs. Keep the geometry shared; every live blast only
    // owns its small set of animated materials.
    const toonGradient = (() => {
      const cv = document.createElement("canvas");
      cv.width = 4;
      cv.height = 1;
      const g = cv.getContext("2d");
      ["#3a3a3a", "#797979", "#b9b9b9", "#ffffff"].forEach((color, i) => {
        g.fillStyle = color;
        g.fillRect(i, 0, 1, 1);
      });
      const tx = trackTexture(new THREE.CanvasTexture(cv));
      tx.minFilter = THREE.NearestFilter;
      tx.magFilter = THREE.NearestFilter;
      tx.generateMipmaps = false;
      return tx;
    })();

    const explosionBlobGeometry = (() => {
      const geometry = track(new THREE.IcosahedronGeometry(0.5, 4));
      const position = geometry.attributes.position;
      const normal = geometry.attributes.normal;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const length = Math.max(0.0001, Math.hypot(x, y, z));
        const nx = x / length;
        const ny = y / length;
        const nz = z / length;
        const wobble =
          1 +
          Math.sin(nx * 8.7 + ny * 4.1 - nz * 2.3) * 0.06 +
          Math.sin(nz * 10.3 - nx * 3.7 + ny * 2.9) * 0.035;
        position.setXYZ(i, x * wobble, y * wobble, z * wobble);
        // Keep a smooth radial normal across the polyhedron's duplicated
        // vertices; computeVertexNormals() would turn it into a faceted rock.
        normal.setXYZ(i, nx, ny, nz);
      }
      position.needsUpdate = true;
      normal.needsUpdate = true;
      return geometry;
    })();

    const explosionBurstGeometry = (() => {
      const positions = [];
      const colors = [];
      const innerColor = new THREE.Color(0xda9e51);
      const tipColor = new THREE.Color(0xf6de4a);
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const inner = 0.28 + (i % 3) * 0.025;
        const outer = i % 2 ? 1.08 : 1.42;
        const halfWidth = i % 2 ? 0.046 : 0.062;
        positions.push(
          Math.cos(angle - halfWidth) * inner,
          0,
          Math.sin(angle - halfWidth) * inner,
          Math.cos(angle) * outer,
          0,
          Math.sin(angle) * outer,
          Math.cos(angle + halfWidth) * inner,
          0,
          Math.sin(angle + halfWidth) * inner,
        );
        colors.push(
          innerColor.r,
          innerColor.g,
          innerColor.b,
          tipColor.r,
          tipColor.g,
          tipColor.b,
          innerColor.r,
          innerColor.g,
          innerColor.b,
        );
      }
      const geometry = track(new THREE.BufferGeometry());
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colors, 3),
      );
      return geometry;
    })();

    const explosionCoreTexture = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 128;
      const g = cv.getContext("2d");
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.18, "rgba(255,251,208,1)");
      grad.addColorStop(0.46, "rgba(245,235,85,.86)");
      grad.addColorStop(0.7, "rgba(221,130,101,.34)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const tx = trackTexture(new THREE.CanvasTexture(cv));
      tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = maxAniso;
      return tx;
    })();

    const FIRE_CORE = new THREE.Color(0xfffbd0);
    const FIRE_HOT = new THREE.Color(0xf5eb55);
    const FIRE_GOLD = new THREE.Color(0xda9e51);
    const FIRE_CORAL = new THREE.Color(0xdd8265);
    const FIRE_BURNT = new THREE.Color(0xac4b40);

    // ---- Round-4 pickups -------------------------------------------------
    // Gameplay is owned by ContinuousArena; this is deliberately a compact,
    // reusable visual layer. Pickup models share all geometry/materials, while
    // their roots are reconciled by the stable IDs sent in frame.pickups.
    const PICKUP_TYPES = new Set([
      "speed",
      "invincible",
      "slow",
      "freeze",
    ]);
    const PICKUP_COLORS = {
      speed: 0x49e7ff,
      invincible: 0xffd83d,
      slow: 0xff4234,   // red ground glow, matching the mushroom's red cap
      freeze: 0x75dcff,
    };
    const MAX_PICKUP_VISUALS = 10;
    const MAX_PICKUP_COLLECT_FX = 12;
    const pickupVisuals = new Map();
    const pickupCollectFx = [];
    const seenPickupEventIds = new Set();
    const seenPickupEventOrder = [];

    const pickupMaterial = (
      color,
      emissive = color,
      emissiveIntensity = 0.35,
      extra = {},
    ) =>
      track(
        new THREE.MeshStandardMaterial({
          color,
          emissive,
          emissiveIntensity,
          roughness: 0.3,
          metalness: 0.08,
          ...extra,
        }),
      );
    const pickupBasicMaterial = (color, extra = {}) =>
      track(
        new THREE.MeshBasicMaterial({
          color,
          toneMapped: false,
          ...extra,
        }),
      );

    const pickupGlowTexture = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 96;
      const g = cv.getContext("2d");
      const grad = g.createRadialGradient(48, 48, 3, 48, 48, 47);
      grad.addColorStop(0, "rgba(255,255,255,.95)");
      grad.addColorStop(0.25, "rgba(255,255,255,.52)");
      grad.addColorStop(0.64, "rgba(255,255,255,.16)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 96, 96);
      const tx = trackTexture(new THREE.CanvasTexture(cv));
      tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = maxAniso;
      return tx;
    })();

    const pickupGlowGeometry = track(new THREE.PlaneGeometry(1.65, 1.65));
    const pickupGlowMaterials = Object.fromEntries(
      Object.entries(PICKUP_COLORS).map(([type, color]) => [
        type,
        pickupBasicMaterial(color, {
          map: pickupGlowTexture,
          transparent: true,
          opacity: type === "slow" ? 0.66 : 0.76,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ]),
    );

    const makeStarShape = (outer = 0.58, inner = 0.28) => {
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 ? inner : outer;
        const angle = Math.PI / 2 + (i * Math.PI) / 5;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      return shape;
    };
    const pickupStarGeometry = track(
      new THREE.ExtrudeGeometry(makeStarShape(), {
        depth: 0.17,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.055,
        bevelThickness: 0.045,
        curveSegments: 2,
      }).center(),
    );
    const pickupSparkGeometry = track(
      new THREE.OctahedronGeometry(0.105, 0),
    );

    const makePickupRoot = (type) => {
      const root = new THREE.Group();
      const glow = new THREE.Mesh(
        pickupGlowGeometry,
        pickupGlowMaterials[type],
      );
      glow.name = "pickupGlow";
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.045;
      glow.renderOrder = 2;
      root.add(glow);

      const icon = new THREE.Group();
      icon.name = "pickupIcon";
      root.add(icon);
      return { root, icon };
    };

    const pickupPrototypes = (() => {
      const prototypes = {};

      // SPEED: a chunky golden lightning badge with little cyan wind feathers.
      {
        const { root, icon } = makePickupRoot("speed");
        const bolt = new THREE.Shape();
        bolt.moveTo(0.08, 0.66);
        bolt.lineTo(-0.35, 0.08);
        bolt.lineTo(-0.06, 0.08);
        bolt.lineTo(-0.25, -0.64);
        bolt.lineTo(0.39, -0.01);
        bolt.lineTo(0.09, -0.01);
        bolt.closePath();
        const boltGeometry = track(
          new THREE.ExtrudeGeometry(bolt, {
            depth: 0.19,
            bevelEnabled: true,
            bevelSegments: 2,
            bevelSize: 0.045,
            bevelThickness: 0.04,
          }).center(),
        );
        const boltMesh = new THREE.Mesh(
          boltGeometry,
          pickupMaterial(0xffdf3f, 0xff8a18, 0.55, {
            roughness: 0.24,
          }),
        );
        boltMesh.scale.setScalar(1.08);
        icon.add(boltMesh);

        const streakGeometry = track(
          new THREE.CapsuleGeometry(0.045, 0.38, 3, 8),
        );
        const streakMaterial = pickupBasicMaterial(0xa9f7ff, {
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        for (let i = 0; i < 3; i++) {
          const streak = new THREE.Mesh(streakGeometry, streakMaterial);
          streak.rotation.z = Math.PI / 2;
          streak.position.set(-0.5 - i * 0.08, 0.25 - i * 0.25, -0.02);
          streak.scale.setScalar(1 - i * 0.16);
          icon.add(streak);
        }
        prototypes.speed = root;
      }

      // INVINCIBLE: a bright, bevelled Mario-like star with tiny face details.
      {
        const { root, icon } = makePickupRoot("invincible");
        const star = new THREE.Mesh(
          pickupStarGeometry,
          pickupMaterial(0xffd52e, 0xff9d18, 0.72, {
            roughness: 0.22,
            metalness: 0.12,
          }),
        );
        icon.add(star);
        const front = new THREE.Mesh(
          pickupStarGeometry,
          pickupMaterial(0xffef76, 0xffd52e, 0.7, {
            roughness: 0.2,
          }),
        );
        front.scale.set(0.78, 0.78, 0.22);
        front.position.z = 0.12;
        icon.add(front);
        const eyeGeometry = track(new THREE.SphereGeometry(0.047, 10, 8));
        const eyeMaterial = pickupBasicMaterial(0x372921);
        for (const x of [-0.13, 0.13]) {
          const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
          eye.scale.y = 1.65;
          eye.position.set(x, 0.055, 0.195);
          icon.add(eye);
        }
        prototypes.invincible = root;
      }

      // SLOW: a classic saturated red/white mushroom. Its red ground glow and the
      // orbiting red orbs on the slowed character both match the cap.
      {
        const { root, icon } = makePickupRoot("slow");
        const stem = new THREE.Mesh(
          track(new THREE.CapsuleGeometry(0.22, 0.36, 5, 16)),
          pickupMaterial(0xffe7bd, 0x6b3519, 0.12, {
            roughness: 0.44,
          }),
        );
        stem.position.y = -0.24;
        icon.add(stem);
        const capMaterial = pickupMaterial(0xe5231f, 0x7d0b08, 0.3, {
          roughness: 0.3,
        });
        const capRim = new THREE.Mesh(
          track(new THREE.CylinderGeometry(0.51, 0.46, 0.13, 28)),
          capMaterial,
        );
        capRim.position.y = 0.075;
        icon.add(capRim);
        const cap = new THREE.Mesh(
          track(
            new THREE.SphereGeometry(
              0.56,
              28,
              14,
              0,
              Math.PI * 2,
              0,
              Math.PI / 2,
            ),
          ),
          capMaterial,
        );
        cap.position.y = 0.1;
        cap.scale.set(1.0, 0.9, 1.0); // circular footprint + taller dome (was a flat oval)
        icon.add(cap);
        // Flat tangent patches sit flush with the ellipsoid instead of reading
        // as white balls glued onto it. Nine placements cover the crown, a
        // middle ring and a lower ring near the brim in every direction.
        const spotGeometry = track(new THREE.CircleGeometry(1, 24));
        const spotMaterial = pickupMaterial(0xfffbec, 0xffd9a2, 0.18, {
          roughness: 0.34,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const capRadii = new THREE.Vector3(
          0.56 * cap.scale.x,
          0.56 * cap.scale.y,
          0.56 * cap.scale.z,
        );
        const spots = [
          // polar angle from the crown, azimuth around world Y, patch radius
          [0.04, 0, 0.15],
          [0.62, Math.PI / 4, 0.13],
          [0.65, (Math.PI * 3) / 4, 0.125],
          [0.65, (Math.PI * 5) / 4, 0.12],
          [0.62, (Math.PI * 7) / 4, 0.125],
          [1.1, 0, 0.095],
          [1.16, Math.PI / 2, 0.1],
          [1.1, Math.PI, 0.095],
          [1.14, (Math.PI * 3) / 2, 0.09],
        ];
        const patchForward = new THREE.Vector3(0, 0, 1);
        for (const [polar, azimuth, radius] of spots) {
          const sinPolar = Math.sin(polar);
          const local = new THREE.Vector3(
            capRadii.x * sinPolar * Math.cos(azimuth),
            capRadii.y * Math.cos(polar),
            capRadii.z * sinPolar * Math.sin(azimuth),
          );
          // Ellipsoid surface normal = gradient of x^2/a^2+y^2/b^2+z^2/c^2.
          const normal = new THREE.Vector3(
            local.x / (capRadii.x * capRadii.x),
            local.y / (capRadii.y * capRadii.y),
            local.z / (capRadii.z * capRadii.z),
          ).normalize();
          const spot = new THREE.Mesh(spotGeometry, spotMaterial);
          spot.position
            .copy(local)
            .add(new THREE.Vector3(0, cap.position.y, 0))
            .addScaledVector(normal, 0.008);
          spot.quaternion.setFromUnitVectors(patchForward, normal);
          spot.scale.setScalar(radius);
          icon.add(spot);
        }
        const faceGeometry = track(new THREE.SphereGeometry(0.043, 10, 8));
        const faceMaterial = pickupBasicMaterial(0x241b18);
        for (const x of [-0.095, 0.095]) {
          const eye = new THREE.Mesh(faceGeometry, faceMaterial);
          eye.scale.set(0.8, 1.9, 0.5);
          eye.position.set(x, -0.22, 0.235);
          icon.add(eye);
        }
        const mouth = new THREE.Mesh(faceGeometry, faceMaterial);
        mouth.position.set(0, -0.355, 0.235);
        mouth.scale.set(0.9, 0.28, 0.4);
        icon.add(mouth);
        prototypes.slow = root;
      }

      // FREEZE: a thick crystalline snowflake with a translucent blue core.
      {
        const { root, icon } = makePickupRoot("freeze");
        const iceMaterial = pickupMaterial(0xbef5ff, 0x43cfff, 0.66, {
          roughness: 0.17,
          metalness: 0.15,
        });
        const armGeometry = track(new THREE.BoxGeometry(0.095, 1.12, 0.13));
        const twigGeometry = track(new THREE.BoxGeometry(0.075, 0.3, 0.1));
        for (let i = 0; i < 3; i++) {
          const arm = new THREE.Mesh(armGeometry, iceMaterial);
          arm.rotation.z = (i * Math.PI) / 3;
          icon.add(arm);
          for (const side of [-1, 1]) {
            for (const fork of [-1, 1]) {
              const twig = new THREE.Mesh(twigGeometry, iceMaterial);
              twig.position.y = side * 0.37;
              twig.rotation.z = fork * 0.72;
              const branch = new THREE.Group();
              branch.rotation.z = (i * Math.PI) / 3;
              branch.add(twig);
              icon.add(branch);
            }
          }
        }
        const gem = new THREE.Mesh(
          track(new THREE.OctahedronGeometry(0.3, 0)),
          pickupMaterial(0x6ee7ff, 0x1aaee8, 0.72, {
            transparent: true,
            opacity: 0.9,
            roughness: 0.08,
          }),
        );
        gem.scale.z = 0.75;
        icon.add(gem);
        prototypes.freeze = root;
      }
      return prototypes;
    })();

    // These four rigs follow frame.red/frame.blue and make the active status
    // readable directly on the character: no extra HUD is needed.
    const stateShared = (() => {
      const shieldMaterial = pickupMaterial(0x67edff, 0x16cde8, 0.55, {
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        roughness: 0.08,
        side: THREE.DoubleSide,
      });
      const shieldWireMaterial = pickupBasicMaterial(0xffdf58, {
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        wireframe: true,
      });
      const iceShellMaterial = pickupMaterial(0xa6edff, 0x29b6f1, 0.5, {
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        roughness: 0.1,
        side: THREE.DoubleSide,
      });
      const speedMaterial = pickupBasicMaterial(0x6ceeff, {
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const slowMaterial = pickupBasicMaterial(0xff4234, {
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      return {
        shieldGeometry: track(new THREE.SphereGeometry(1.02, 20, 14)),
        shieldWireGeometry: track(new THREE.IcosahedronGeometry(1.06, 2)),
        shieldMaterial,
        shieldWireMaterial,
        iceShellGeometry: track(new THREE.IcosahedronGeometry(0.94, 1)),
        iceShellMaterial,
        speedGeometry: track(new THREE.CapsuleGeometry(0.035, 0.52, 3, 8)),
        speedMaterial,
        slowGeometry: track(new THREE.SphereGeometry(0.105, 10, 8)),
        slowMaterial,
      };
    })();

    const createAgentEffectRig = (side) => {
      const root = new THREE.Group();
      root.name = `pickupEffects-${side}`;

      const speed = new THREE.Group();
      speed.name = "speed";
      for (let i = 0; i < 7; i++) {
        const streak = new THREE.Mesh(
          stateShared.speedGeometry,
          stateShared.speedMaterial,
        );
        streak.rotation.x = Math.PI / 2;
        streak.position.set(
          ((i % 3) - 1) * 0.28,
          0.3 + (i % 3) * 0.34,
          -0.48 - Math.floor(i / 3) * 0.28,
        );
        streak.scale.setScalar(0.75 + (i % 3) * 0.13);
        speed.add(streak);
      }
      root.add(speed);

      const invincible = new THREE.Group();
      invincible.name = "invincible";
      invincible.position.y = 1.03;
      invincible.add(
        new THREE.Mesh(
          stateShared.shieldGeometry,
          stateShared.shieldMaterial,
        ),
        new THREE.Mesh(
          stateShared.shieldWireGeometry,
          stateShared.shieldWireMaterial,
        ),
      );
      const orbitStarMaterial = pickupBasicMaterial(0xffeb69, {
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      for (let i = 0; i < 5; i++) {
        const star = new THREE.Mesh(pickupSparkGeometry, orbitStarMaterial);
        star.userData.phase = (i / 5) * Math.PI * 2;
        invincible.add(star);
      }
      root.add(invincible);

      const slow = new THREE.Group();
      slow.name = "slow";
      for (let i = 0; i < 7; i++) {
        const orb = new THREE.Mesh(
          stateShared.slowGeometry,
          stateShared.slowMaterial,
        );
        orb.userData.phase = (i / 7) * Math.PI * 2;
        slow.add(orb);
      }
      root.add(slow);

      const freeze = new THREE.Group();
      freeze.name = "freeze";
      freeze.position.y = 1.0;
      const shell = new THREE.Mesh(
        stateShared.iceShellGeometry,
        stateShared.iceShellMaterial,
      );
      shell.scale.y = 1.2;
      freeze.add(shell);
      const shardMaterial = pickupBasicMaterial(0xc5f7ff, {
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      for (let i = 0; i < 6; i++) {
        const shard = new THREE.Mesh(pickupSparkGeometry, shardMaterial);
        const angle = (i / 6) * Math.PI * 2;
        shard.position.set(
          Math.cos(angle) * 0.84,
          (i % 2 ? 0.5 : -0.42),
          Math.sin(angle) * 0.84,
        );
        shard.scale.set(0.6, 1.65, 0.6);
        freeze.add(shard);
      }
      root.add(freeze);

      for (const layer of [speed, invincible, slow, freeze]) {
        layer.visible = false;
      }
      group.add(root);
      return {
        root,
        speed,
        invincible,
        slow,
        freeze,
        blend: { speed: 0, invincible: 0, slow: 0, freeze: 0 },
        positionReady: false,
        yaw: Math.PI,
      };
    };
    const agentEffectRigs = {
      red: createAgentEffectRig("red"),
      blue: createAgentEffectRig("blue"),
    };

    const pickupIdKey = (id) => String(id ?? "");
    const pickupPhase = (id) => {
      const text = pickupIdKey(id);
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return ((hash >>> 0) % 1000) / 1000;
    };

    function removePickupVisual(key) {
      const visual = pickupVisuals.get(key);
      if (!visual) return;
      group.remove(visual.model);
      pickupVisuals.delete(key);
    }

    function createPickupVisual(pickup) {
      const type = PICKUP_TYPES.has(pickup.type) ? pickup.type : null;
      if (!type) return null;
      while (pickupVisuals.size >= MAX_PICKUP_VISUALS) {
        removePickupVisual(pickupVisuals.keys().next().value);
      }
      const key = pickupIdKey(pickup.id);
      const model = pickupPrototypes[type].clone(true);
      model.name = `pickupVisual:${type}:${key}`;
      const icon = model.getObjectByName("pickupIcon");
      const p = simToScene(pickup.pos || [0, 0]);
      const radius = Number(pickup.radius) || 0.42;
      const baseScale = THREE.MathUtils.clamp(
        (radius * sceneScale) / 1.25,
        0.72,
        1.24,
      );
      model.position.set(p.x, 0, p.z);
      model.scale.setScalar(0.001);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = !o.material?.transparent;
        o.receiveShadow = false;
      });
      group.add(model);
      const visual = {
        key,
        id: pickup.id,
        type,
        model,
        icon,
        target: new THREE.Vector3(p.x, 0, p.z),
        phase: pickupPhase(pickup.id) * Math.PI * 2,
        baseScale,
        age: 0,
        removeAge: 0,
        state: "spawn",
      };
      pickupVisuals.set(key, visual);
      return visual;
    }

    function rememberPickupEvent(id) {
      const key = pickupIdKey(id);
      seenPickupEventIds.add(key);
      seenPickupEventOrder.push(key);
      while (seenPickupEventOrder.length > 256) {
        seenPickupEventIds.delete(seenPickupEventOrder.shift());
      }
    }

    function disposePickupCollectFx(fx) {
      group.remove(fx.group);
      fx.sparkMaterial.dispose();
      fx.flashMaterial.dispose();
    }

    function spawnPickupCollectFx(event) {
      while (pickupCollectFx.length >= MAX_PICKUP_COLLECT_FX) {
        disposePickupCollectFx(pickupCollectFx.shift());
      }
      const type = PICKUP_TYPES.has(event.type) ? event.type : "speed";
      const color = PICKUP_COLORS[type];
      const p = simToScene(event.pos || [0, 0]);
      const burst = new THREE.Group();
      burst.name = `pickupCollectFx:${type}`;
      burst.position.set(p.x, 0.85, p.z);
      group.add(burst);

      const flashMaterial = new THREE.SpriteMaterial({
        map: pickupGlowTexture,
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const flash = new THREE.Sprite(flashMaterial);
      flash.scale.setScalar(0.3);
      burst.add(flash);

      const sparkMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const sparks = [];
      const phase = pickupPhase(event.id) * Math.PI * 2;
      for (let i = 0; i < 9; i++) {
        const angle = phase + (i / 9) * Math.PI * 2;
        const spark = new THREE.Mesh(pickupSparkGeometry, sparkMaterial);
        spark.position.set(0, 0, 0);
        spark.rotation.set(angle, angle * 0.6, -angle);
        burst.add(spark);
        sparks.push({
          mesh: spark,
          velocity: new THREE.Vector3(
            Math.cos(angle) * (1.5 + (i % 3) * 0.32),
            1.1 + (i % 4) * 0.32,
            Math.sin(angle) * (1.5 + (i % 3) * 0.32),
          ),
        });
      }
      pickupCollectFx.push({
        group: burst,
        flash,
        flashMaterial,
        sparkMaterial,
        sparks,
        age: 0,
        duration: 0.48,
      });
    }

    function updatePickupCollectFx(dt) {
      for (let i = pickupCollectFx.length - 1; i >= 0; i--) {
        const fx = pickupCollectFx[i];
        fx.age += dt;
        const u = Math.min(1, fx.age / fx.duration);
        const pop = Math.sin(Math.min(1, u * 1.2) * Math.PI);
        fx.flash.scale.setScalar(0.35 + pop * 1.9);
        fx.flashMaterial.opacity =
          1 - THREE.MathUtils.smoothstep(u, 0.14, 0.88);
        fx.sparkMaterial.opacity =
          1 - THREE.MathUtils.smoothstep(u, 0.48, 1);
        for (const spark of fx.sparks) {
          spark.mesh.position.addScaledVector(spark.velocity, dt);
          spark.velocity.y -= dt * 3.8;
          spark.mesh.rotation.x += dt * 8;
          spark.mesh.rotation.y += dt * 6;
          spark.mesh.scale.setScalar(Math.max(0.001, 1 - u));
        }
        if (u >= 1) {
          disposePickupCollectFx(fx);
          pickupCollectFx.splice(i, 1);
        }
      }
    }

    function updatePickups(t, dt, frame) {
      const active = new Set();
      for (const pickup of frame?.pickups || []) {
        if (!PICKUP_TYPES.has(pickup.type) || !Array.isArray(pickup.pos)) {
          continue;
        }
        const key = pickupIdKey(pickup.id);
        active.add(key);
        let visual = pickupVisuals.get(key);
        if (visual && visual.type !== pickup.type) {
          removePickupVisual(key);
          visual = null;
        }
        if (!visual) visual = createPickupVisual(pickup);
        if (!visual) continue;
        const p = simToScene(pickup.pos);
        visual.target.set(p.x, 0, p.z);
        if (visual.state === "despawn") {
          visual.state = "spawn";
          visual.age = 0.12;
          visual.removeAge = 0;
        }
      }

      for (const event of frame?.pickupEvents || []) {
        const eventKey = pickupIdKey(event.id);
        if (seenPickupEventIds.has(eventKey)) continue;
        rememberPickupEvent(event.id);
        spawnPickupCollectFx(event);
        const visual = pickupVisuals.get(pickupIdKey(event.pickupId));
        if (visual) {
          visual.state = "collect";
          visual.removeAge = 0;
          if (Array.isArray(event.pos)) {
            const p = simToScene(event.pos);
            visual.target.set(p.x, 0, p.z);
          }
        }
      }

      for (const [key, visual] of pickupVisuals) {
        if (!active.has(key) && visual.state !== "collect") {
          visual.state = "despawn";
        }
        visual.age += dt;
        const follow = 1 - Math.exp(-dt * 16);
        visual.model.position.lerp(visual.target, follow);
        if (visual.icon) {
          visual.icon.position.y =
            0.86 + Math.sin(t * 3.2 + visual.phase) * 0.13;
          visual.icon.rotation.y +=
            dt * (visual.type === "speed" ? 2.55 : 1.65);
          visual.icon.rotation.z =
            Math.sin(t * 2.1 + visual.phase) * 0.055;
        }

        let scale = visual.baseScale;
        if (visual.state === "spawn") {
          const u = Math.min(1, visual.age / 0.28);
          // a tiny overshoot gives the pickup a Mario-style item-box pop.
          const back = 1 + 2.70158 * Math.pow(u - 1, 3) +
            1.70158 * Math.pow(u - 1, 2);
          scale *= Math.max(0.001, back);
          if (u >= 1) visual.state = "active";
        } else if (
          visual.state === "collect" ||
          visual.state === "despawn"
        ) {
          visual.removeAge += dt;
          const life = visual.state === "collect" ? 0.18 : 0.24;
          const u = Math.min(1, visual.removeAge / life);
          const punch =
            visual.state === "collect"
              ? 1 + Math.sin(Math.min(1, u * 1.5) * Math.PI) * 0.35
              : 1;
          scale *= Math.max(0.001, (1 - u * u) * punch);
          if (u >= 1) {
            removePickupVisual(key);
            continue;
          }
        }
        visual.model.scale.setScalar(scale);
      }
      updatePickupCollectFx(dt);
    }

    const effectRemaining = (effects, type) => {
      if (!effects) return 0;
      if (type === "freeze") {
        return Math.max(
          0,
          Number(effects.frozen ?? effects.freeze) || 0,
        );
      }
      return Math.max(0, Number(effects[type]) || 0);
    };

    function updateAgentPickupEffects(t, dt, frame) {
      for (const side of ["red", "blue"]) {
        const rig = agentEffectRigs[side];
        const position = frame?.[side];
        if (Array.isArray(position)) {
          const p = simToScene(position);
          if (!rig.positionReady) {
            rig.root.position.set(p.x, 0, p.z);
            rig.positionReady = true;
          } else {
            const follow = 1 - Math.exp(-dt * 12);
            rig.root.position.x += (p.x - rig.root.position.x) * follow;
            rig.root.position.y += (0 - rig.root.position.y) * follow;
            rig.root.position.z += (p.z - rig.root.position.z) * follow;
          }
        }

        const velocity = frame?.[`${side}Vel`];
        if (
          Array.isArray(velocity) &&
          Math.hypot(velocity[0] || 0, velocity[1] || 0) > 0.04
        ) {
          const targetYaw = Math.atan2(velocity[0], velocity[1]);
          const delta = Math.atan2(
            Math.sin(targetYaw - rig.yaw),
            Math.cos(targetYaw - rig.yaw),
          );
          rig.yaw += delta * (1 - Math.exp(-dt * 10));
        }
        rig.speed.rotation.y = rig.yaw;

        const effects = frame?.effects?.[side];
        for (const type of ["speed", "invincible", "slow", "freeze"]) {
          const active = effectRemaining(effects, type) > 0;
          rig.blend[type] = THREE.MathUtils.clamp(
            rig.blend[type] + dt * (active ? 8 : -9),
            0,
            1,
          );
          const layer = rig[type];
          layer.visible = rig.blend[type] > 0.01;
          const eased = THREE.MathUtils.smoothstep(
            rig.blend[type],
            0,
            1,
          );
          layer.scale.setScalar(Math.max(0.001, eased));
        }

        rig.speed.children.forEach((streak, i) => {
          streak.position.z =
            -0.42 - Math.floor(i / 3) * 0.28 -
            ((t * 2.8 + i * 0.17) % 0.28);
        });
        rig.invincible.rotation.y += dt * 1.75;
        rig.invincible.children.slice(2).forEach((star, i) => {
          const angle = t * 3.1 + star.userData.phase;
          star.position.set(
            Math.cos(angle) * 1.14,
            Math.sin(t * 4.2 + i) * 0.42,
            Math.sin(angle) * 1.14,
          );
          star.rotation.x += dt * 5;
          star.rotation.y += dt * 7;
        });
        rig.slow.children.forEach((orb, i) => {
          const angle = t * 0.72 + orb.userData.phase;
          orb.position.set(
            Math.cos(angle) * (0.78 + (i % 2) * 0.16),
            0.26 + (i % 3) * 0.36 +
              Math.sin(t * 1.8 + i) * 0.08,
            Math.sin(angle) * (0.78 + (i % 2) * 0.16),
          );
        });
        rig.freeze.rotation.y = Math.sin(t * 0.8) * 0.12;
      }
    }

    function resetPickupEffects(frameToSuppress = null) {
      for (const key of [...pickupVisuals.keys()]) removePickupVisual(key);
      for (const fx of pickupCollectFx) disposePickupCollectFx(fx);
      pickupCollectFx.length = 0;
      seenPickupEventIds.clear();
      seenPickupEventOrder.length = 0;
      for (const event of frameToSuppress?.pickupEvents || []) {
        rememberPickupEvent(event.id);
      }
      for (const rig of Object.values(agentEffectRigs)) {
        rig.positionReady = false;
        for (const type of ["speed", "invincible", "slow", "freeze"]) {
          rig.blend[type] = 0;
          rig[type].visible = false;
        }
      }
    }

    function missileVisual(missile) {
      let visual = missileVisuals.get(missile.id);
      if (visual || !missilePrototype) return visual;
      const model = cloneSkinned(missilePrototype);
      const p = simToScene(missile.pos);
      model.position.set(p.x, 1.65, p.z);
      const yaw = Math.atan2(missile.vel?.[0] ?? 0, missile.vel?.[1] ?? 1);
      model.rotation.y = yaw;
      group.add(model);
      visual = {
        model,
        target: new THREE.Vector3(p.x, 1.65, p.z),
        yaw,
        targetYaw: yaw,
      };
      missileVisuals.set(missile.id, visual);
      return visual;
    }

    function rememberExplosion(id) {
      seenExplosionIds.add(id);
      seenExplosionOrder.push(id);
      if (seenExplosionOrder.length > 256) {
        seenExplosionIds.delete(seenExplosionOrder.shift());
      }
    }

    function spawnExplosion(event) {
      while (explosionFx.length >= MAX_EXPLOSION_FX) {
        disposeExplosion(explosionFx.shift());
      }
      const p = simToScene(event.pos);
      const blast = new THREE.Group();
      blast.position.set(p.x, 0.88, p.z);
      const isHit = Boolean(event.hit);

      const coreMat = new THREE.SpriteMaterial({
        map: explosionCoreTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const core = new THREE.Sprite(coreMat);
      core.scale.setScalar(0.32);
      core.renderOrder = 34;
      blast.add(core);

      const burstMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const burst = new THREE.Mesh(explosionBurstGeometry, burstMat);
      burst.position.y = 0.035;
      burst.rotation.y = Math.random() * Math.PI * 2;
      burst.scale.setScalar(0.42);
      burst.renderOrder = 33;
      blast.add(burst);

      const fireLayers = [];
      const fireCount = isHit ? 8 : 7;
      const blastScale = isHit ? 1.13 : 1.09;
      for (let i = 0; i < fireCount; i++) {
        const emissivePeak =
          i === 0 ? 1.02 : i === 1 ? 0.7 : 0.48 + Math.random() * 0.13;
        const material = new THREE.MeshToonMaterial({
          color: FIRE_CORE,
          gradientMap: toonGradient,
          emissive: FIRE_HOT,
          emissiveIntensity: emissivePeak,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: true,
          toneMapped: false,
        });
        const mesh = new THREE.Mesh(explosionBlobGeometry, material);
        const angle =
          i === 0
            ? 0
            : i * 2.399963229728653 +
              (Math.random() - 0.5) * 0.62;
        const radius =
          (i === 0
            ? 0
            : i === 1
              ? 0.2 + Math.random() * 0.12
              : 0.48 + Math.random() * 0.3) * 1.08;
        const origin = new THREE.Vector3(
          Math.cos(angle) * radius,
          i === 0
            ? 0.12
            : -0.08 + Math.random() * 0.5,
          Math.sin(angle) * radius,
        );
        mesh.position.copy(origin);
        mesh.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        );
        mesh.scale.setScalar(0.001);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 29;
        blast.add(mesh);

        const size =
          (i === 0
            ? 1.5
            : i === 1
              ? 1.3 + Math.random() * 0.14
              : 1.1 + Math.random() * 0.34) * blastScale;
        fireLayers.push({
          mesh,
          material,
          origin,
          delay: i === 0 ? 0 : 0.018 + Math.random() * 0.045,
          life: i === 0 ? 0.42 : 0.34 + Math.random() * 0.05,
          maxScale: new THREE.Vector3(
            size * (0.9 + Math.random() * 0.18),
            size * (0.82 + Math.random() * 0.22),
            size * (0.9 + Math.random() * 0.18),
          ),
          maxOpacity: i === 0 ? 1 : 0.94,
          heatOffset:
            i === 0
              ? -0.1
              : i === 1
                ? 0.06
                : 0.14 + Math.random() * 0.12,
          emissivePeak,
          spin: new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.7,
            (Math.random() - 0.5) * 1.5,
          ),
          drift: new THREE.Vector3(
            Math.cos(angle) * (0.12 + Math.random() * 0.17),
            0.04 + Math.random() * 0.13,
            Math.sin(angle) * (0.12 + Math.random() * 0.17),
          ),
        });
      }

      // Character impacts end on the fire cluster. Only a wall hit leaves the
      // brief pale debris cloud visible in the Odyssey reference.
      const dustLayers = [];
      if (!isHit) {
        const outward = new THREE.Vector3(
          p.x - sceneCenter[0],
          0,
          p.z - sceneCenter[1],
        );
        if (outward.lengthSq() < 0.001) outward.set(0, 0, 1);
        outward.normalize();
        const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
        const dustPalette = [0xf4efe5, 0xe7e0d3, 0xd2ccc4, 0xb7b0aa];
        for (let i = 0; i < 8; i++) {
          const color = dustPalette[i % dustPalette.length];
          const material = new THREE.MeshToonMaterial({
            color,
            gradientMap: toonGradient,
            emissive: color,
            emissiveIntensity: 0.08,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: true,
            toneMapped: false,
          });
          const mesh = new THREE.Mesh(explosionBlobGeometry, material);
          const side = (Math.random() - 0.5) * 1.6;
          const origin = new THREE.Vector3()
            .addScaledVector(tangent, side)
            .addScaledVector(outward, (Math.random() - 0.5) * 0.16);
          origin.y = -0.14 + Math.random() * 0.55;
          mesh.position.copy(origin);
          mesh.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI,
          );
          mesh.scale.setScalar(0.001);
          mesh.renderOrder = 21 + i;
          blast.add(mesh);
          const width = 0.55 + Math.random() * 0.34;
          dustLayers.push({
            mesh,
            material,
            origin,
            delay: 0.27 + Math.random() * 0.045,
            life: 0.39 + Math.random() * 0.05,
            maxScale: new THREE.Vector3(
              width,
              0.5 + Math.random() * 0.4,
              0.44 + Math.random() * 0.28,
            ),
            maxOpacity: 0.58 + Math.random() * 0.16,
            spin: new THREE.Vector3(
              (Math.random() - 0.5) * 0.65,
              (Math.random() - 0.5) * 0.75,
              (Math.random() - 0.5) * 0.65,
            ),
            drift: new THREE.Vector3()
              .addScaledVector(tangent, (Math.random() - 0.5) * 0.32)
              .addScaledVector(outward, -0.08 - Math.random() * 0.16)
              .add(new THREE.Vector3(0, 0.32 + Math.random() * 0.42, 0)),
          });
        }
      }

      const hasLightBudget =
        explosionFx.filter((fx) => fx.light).length < MAX_EXPLOSION_LIGHTS;
      const light = hasLightBudget
        ? new THREE.PointLight(
            0xffdc57,
            isHit ? 18 : 15,
            isHit ? 9 : 8,
            2,
          )
        : null;
      if (light) {
        light.position.y = 0.45;
        light.castShadow = false;
        blast.add(light);
      }
      group.add(blast);
      const duration =
        Math.max(
          0.52,
          ...fireLayers.map((layer) => layer.delay + layer.life),
          ...dustLayers.map((layer) => layer.delay + layer.life),
        ) + 0.06;
      explosionFx.push({
        group: blast,
        core,
        coreMat,
        burst,
        burstMat,
        fireLayers,
        dustLayers,
        light,
        lightPeak: isHit ? 18 : 15,
        age: 0,
        duration,
      });
    }

    function updateExplosions(dt) {
      for (let i = explosionFx.length - 1; i >= 0; i--) {
        const fx = explosionFx[i];
        fx.age += dt;
        const u = Math.min(1, fx.age / fx.duration);

        const coreU = Math.min(1, fx.age / 0.29);
        fx.core.scale.setScalar(
          0.32 + 1.48 * (1 - Math.exp(-coreU * 7.5)),
        );
        fx.coreMat.opacity =
          1 - THREE.MathUtils.smoothstep(coreU, 0.22, 1);

        const burstU = Math.min(1, fx.age / 0.2);
        fx.burst.scale.setScalar(
          0.42 + 0.78 * (1 - Math.pow(1 - burstU, 3)),
        );
        fx.burst.rotation.y += dt * 1.2;
        fx.burstMat.opacity =
          1 - THREE.MathUtils.smoothstep(burstU, 0.16, 1);

        for (const layer of fx.fireLayers) {
          const local = (fx.age - layer.delay) / layer.life;
          if (local <= 0 || local >= 1) {
            layer.material.opacity = 0;
            continue;
          }
          const appear = THREE.MathUtils.smoothstep(local, 0, 0.075);
          const fade = 1 - THREE.MathUtils.smoothstep(local, 0.56, 1);
          const enter = Math.min(1, local / 0.18);
          const pop = 1 - Math.pow(1 - enter, 3);
          const contract =
            1 - 0.62 * THREE.MathUtils.smoothstep(local, 0.54, 1);
          layer.mesh.scale
            .copy(layer.maxScale)
            .multiplyScalar(Math.max(0.001, pop * contract));
          const move = THREE.MathUtils.smoothstep(local, 0.12, 1);
          layer.mesh.position
            .copy(layer.origin)
            .addScaledVector(layer.drift, move);
          layer.mesh.rotation.x += layer.spin.x * dt;
          layer.mesh.rotation.y += layer.spin.y * dt;
          layer.mesh.rotation.z += layer.spin.z * dt;
          layer.material.opacity = appear * fade * layer.maxOpacity;

          const heat = THREE.MathUtils.clamp(
            local + layer.heatOffset,
            0,
            1,
          );
          if (heat < 0.2) {
            layer.material.color.lerpColors(
              FIRE_CORE,
              FIRE_HOT,
              heat / 0.2,
            );
          } else if (heat < 0.48) {
            layer.material.color.lerpColors(
              FIRE_HOT,
              FIRE_GOLD,
              (heat - 0.2) / 0.28,
            );
          } else if (heat < 0.75) {
            layer.material.color.lerpColors(
              FIRE_GOLD,
              FIRE_CORAL,
              (heat - 0.48) / 0.27,
            );
          } else {
            layer.material.color.lerpColors(
              FIRE_CORAL,
              FIRE_BURNT,
              (heat - 0.75) / 0.25,
            );
          }
          layer.material.emissive.copy(layer.material.color);
          layer.material.emissiveIntensity =
            0.04 +
            layer.emissivePeak *
              (1 - THREE.MathUtils.smoothstep(local, 0.1, 0.68));
        }

        for (const layer of fx.dustLayers) {
          const local = (fx.age - layer.delay) / layer.life;
          if (local <= 0 || local >= 1) {
            layer.material.opacity = 0;
            continue;
          }
          const appear = THREE.MathUtils.smoothstep(local, 0, 0.13);
          const fade = 1 - THREE.MathUtils.smoothstep(local, 0.56, 1);
          const grow = 1 - Math.pow(1 - Math.min(1, local / 0.32), 3);
          layer.mesh.scale
            .copy(layer.maxScale)
            .multiplyScalar(Math.max(0.001, grow));
          layer.mesh.position
            .copy(layer.origin)
            .addScaledVector(layer.drift, local);
          layer.mesh.rotation.x += layer.spin.x * dt;
          layer.mesh.rotation.y += layer.spin.y * dt;
          layer.mesh.rotation.z += layer.spin.z * dt;
          layer.material.opacity = appear * fade * layer.maxOpacity;
        }

        if (fx.light) {
          fx.light.intensity = fx.lightPeak * Math.exp(-fx.age * 10.5);
        }
        if (u >= 1) {
          disposeExplosion(fx);
          explosionFx.splice(i, 1);
        }
      }
    }

    function disposeExplosion(fx) {
      group.remove(fx.group);
      fx.coreMat.dispose();
      fx.burstMat.dispose();
      for (const layer of fx.fireLayers) layer.material.dispose();
      for (const layer of fx.dustLayers) layer.material.dispose();
    }

    function updateMissiles(frame, dt) {
      explosionSpawnCredit = Math.min(
        MAX_NEW_EXPLOSIONS_PER_FRAME,
        explosionSpawnCredit + dt * 12,
      );
      const active = new Set();
      for (const missile of frame?.missiles || []) {
        active.add(missile.id);
        const visual = missileVisual(missile);
        if (!visual) continue;
        const p = simToScene(missile.pos);
        visual.target.set(p.x, 1.65, p.z);
        visual.targetYaw = Math.atan2(
          missile.vel?.[0] ?? 0,
          missile.vel?.[1] ?? 1,
        );
        const k = 1 - Math.exp(-dt * 14);
        visual.model.position.lerp(visual.target, k);
        const delta = Math.atan2(
          Math.sin(visual.targetYaw - visual.yaw),
          Math.cos(visual.targetYaw - visual.yaw),
        );
        visual.yaw += delta * (1 - Math.exp(-dt * 10));
        visual.model.rotation.y = visual.yaw;
        visual.model.rotation.z = THREE.MathUtils.clamp(delta * -0.55, -0.5, 0.5);
      }
      for (const [id, visual] of missileVisuals) {
        if (active.has(id)) continue;
        group.remove(visual.model);
        disposeMissileModel(visual.model);
        missileVisuals.delete(id);
      }
      const unseenExplosions = [];
      for (const event of frame?.explosions || []) {
        if (seenExplosionIds.has(event.id)) continue;
        unseenExplosions.push(event);
      }
      const spawnCount = Math.min(
        MAX_NEW_EXPLOSIONS_PER_FRAME,
        Math.floor(explosionSpawnCredit),
        unseenExplosions.length,
      );
      if (spawnCount > 0) {
        const selected = unseenExplosions
          .sort(
            (a, b) =>
              Number(Boolean(b.hit)) - Number(Boolean(a.hit)) ||
              Number(b.id) - Number(a.id),
          )
          .slice(0, spawnCount)
          .sort((a, b) => Number(a.id) - Number(b.id));
        for (const event of selected) {
          rememberExplosion(event.id);
          spawnExplosion(event);
        }
        explosionSpawnCredit -= selected.length;
      }
      updateExplosions(dt);
    }

    function resetEffects(frameToSuppress = null) {
      seenExplosionIds.clear();
      seenExplosionOrder.length = 0;
      for (const fx of explosionFx) disposeExplosion(fx);
      explosionFx.length = 0;
      explosionSpawnCredit = MAX_NEW_EXPLOSIONS_PER_FRAME;
      for (const event of frameToSuppress?.explosions || []) {
        rememberExplosion(event.id);
      }
      resetPickupEffects(frameToSuppress);
    }

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
        for (const mat of obj.fadeMats)
          mat.opacity = mat.userData.baseOpacity * opacity;
        obj.wrap.rotation.x = (obj.rot?.[0] ?? 0) + t * (obj.spin?.[0] ?? 0);
        obj.wrap.rotation.y = (obj.rot?.[1] ?? 0) + t * (obj.spin?.[1] ?? 0);
        obj.wrap.rotation.z = (obj.rot?.[2] ?? 0) + t * (obj.spin?.[2] ?? 0);
      }
      updatePickups(t, dt, frame);
      updateAgentPickupEffects(t, dt, frame);
      updateMissiles(frame, dt);
    }

    function dispose() {
      disposed = true;
      for (const visual of missileVisuals.values()) {
        group.remove(visual.model);
        disposeMissileModel(visual.model);
      }
      missileVisuals.clear();
      resetEffects();
      scene.remove(group);
      for (const o of trash) o.dispose?.();
    }

    return {
      group,
      update,
      resetEffects,
      dispose,
      ready: missileReady,
    };
  },
};
