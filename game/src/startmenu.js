// Start menu — the Super Mario Odyssey ship cabin (HomeInside) used as a
// cinematic 3D background, with a title card + Start button. main.js shows this
// before booting the live match; clicking Start tears it down and starts the game.
//
// The cabin models are the vendored Odyssey "HomeInside" pack (Y-up, so no axis
// fix needed). They're loaded once and shown as-is (bind pose) — no cloning.

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";

const ASSETS = "./assets/models/home-inside/";
const CHARS = "./assets/models/characters/";

// the cast copied into game/assets/models/characters/ (from the repo-root
// characters/ rips). Each is a single base-pose Collada model.
const CHARACTERS = [
  { name: "Mario", file: "mario/mario.dae" },
  { name: "Luigi", file: "luigi/luigi.dae" },
  { name: "Yoshi", file: "yoshi/yoshi.dae" },
  { name: "Toadette", file: "toadette/toadette.dae" },
  { name: "Pauline", file: "pauline/pauline.dae" },
  { name: "Koopa", file: "koopa/koopa.dae" },
  { name: "Bowser", file: "bowser/bowser.dae" },
  { name: "Peach", file: "peach/peach.dae" },
  { name: "Toad", file: "toad/toad.dae" },
  { name: "Parabones", file: "parabones/parabones.dae" },
];

const JOINT_ALIASES = {
  mario: {
    Hip: "joint0",
    LegL1: "joint1",
    LegL2: "joint2",
    FootL: "joint3",
    ToeL: "joint4",
    LegR1: "joint5",
    LegR2: "joint6",
    FootR: "joint7",
    ToeR: "joint8",
    Spine1: "joint9",
    Spine2: "joint10",
    Head: "joint11",
    ShoulderL: "joint12",
    ArmL1: "joint13",
    ArmL2: "joint15",
    HandL: "joint17",
    ShoulderR: "joint18",
    ArmR1: "joint19",
    ArmR2: "joint21",
    HandR: "joint23",
    LipUpper: "joint40",
    Jaw: "joint41",
    LipLowerCenter: "joint42",
    LipLowerL: "joint43",
    LipLowerR: "joint44",
    MouthCornerL: "joint45",
    MouthCornerR: "joint46",
  },
  luigi: {
    // LuigiUnused model (26-joint rig)
    Hip: "joint7",
    LegL1: "joint8",
    LegL2: "joint9",
    FootL: "joint10",
    ToeL: "joint11",
    LegR1: "joint12",
    LegR2: "joint13",
    FootR: "joint14",
    ToeR: "joint15",
    Spine1: "joint0",
    Spine2: "joint1",
    Head: "joint16",
    ShoulderL: "joint2",
    ArmL1: "joint3",
    ArmL2: "joint18",
    HandL: "joint20",
    ShoulderR: "joint4",
    ArmR1: "joint5",
    ArmR2: "joint22",
    HandR: "joint24",
    Jaw: "joint25",
  },
  yoshi: {
    Hip: "joint13",
    LegL1: "joint14",
    LegL2: "joint15",
    FootL: "joint16",
    ToeL: "joint17",
    LegR1: "joint18",
    LegR2: "joint19",
    FootR: "joint20",
    ToeR: "joint21",
    Tail: "joint22",
    Spine1: "joint24",
    Spine2: "joint25",
    Head: "joint26",
    ShoulderL: "joint31",
    ArmL1: "joint32",
    ArmL2: "joint34",
    HandL: "joint36",
    ShoulderR: "joint37",
    ArmR1: "joint38",
    ArmR2: "joint40",
    HandR: "joint42",
  },
  toadette: {
    Hip: "joint3",
    LegL1: "joint4",
    LegL2: "joint5",
    FootL: "joint6",
    LegR1: "joint7",
    LegR2: "joint8",
    FootR: "joint9",
    Spine1: "joint10",
    Spine2: "joint11",
    Head: "joint12",
    HairL1: "joint13",
    HairR1: "joint16",
    ShoulderL: "joint24",
    ArmL1: "joint25",
    ArmL2: "joint26",
    HandL: "joint27",
    ShoulderR: "joint28",
    ArmR1: "joint29",
    ArmR2: "joint30",
    HandR: "joint31",
  },
  pauline: {
    Hip: "joint3",
    LegL1: "joint4",
    LegL2: "joint5",
    FootL: "joint6",
    LegR1: "joint10",
    LegR2: "joint11",
    FootR: "joint12",
    Spine1: "joint18",
    Spine2: "joint19",
    Head: "joint22",
    ShoulderL: "joint31",
    ArmL1: "joint32",
    ArmL2: "joint33",
    HandL: "joint35",
    ShoulderR: "joint52",
    ArmR1: "joint53",
    ArmR2: "joint54",
    HandR: "joint55",
    HairL1: "joint29",
    HairR1: "joint30",
    EyelidLA: "joint89",
    EyelidLB: "joint90",
    EyelidRA: "joint91",
    EyelidRB: "joint92",
  },
  koopa: {
    Hip: "joint3",
    LegL1: "joint4",
    LegL2: "joint5",
    FootL: "joint6",
    ToeL: "joint7",
    LegR1: "joint8",
    LegR2: "joint9",
    FootR: "joint10",
    ToeR: "joint11",
    Spine1: "joint12",
    Spine2: "joint13",
    Head: "joint14",
    ShoulderL: "joint16",
    ArmL1: "joint17",
    ArmL2: "joint18",
    HandL: "joint19",
    ShoulderR: "joint20",
    ArmR1: "joint21",
    ArmR2: "joint22",
    HandR: "joint23",
  },
  bowser: {
    // bone names differ: Hip1/Spine/Stomach/Face/ShoulderR1/Wrist*/Foot*1
    Hip: "joint0",
    Spine1: "joint9",
    Spine2: "joint66",
    Head: "joint12",
    LegL1: "joint1",
    LegL2: "joint2",
    FootL: "joint3",
    LegR1: "joint5",
    LegR2: "joint6",
    FootR: "joint7",
    ShoulderL: "joint32",
    ArmL1: "joint33",
    ArmL2: "joint34",
    HandL: "joint36",
    ShoulderR: "joint49",
    ArmR1: "joint50",
    ArmR2: "joint51",
    HandR: "joint53",
  },
  peach: {
    // PeachSwimwear rig (83 joints) — beach look (towel/sarong, flower, sunglasses)
    LegL1: "joint2",
    LegL2: "joint3",
    FootL: "joint30",
    LegR1: "joint5",
    LegR2: "joint6",
    FootR: "joint7",
    Spine1: "joint9",
    Spine2: "joint10",
    Head: "joint12",
    ShoulderL: "joint13",
    ArmL1: "joint44",
    ArmL2: "joint45",
    HandL: "joint46",
    ShoulderR: "joint14",
    ArmR1: "joint15",
    ArmR2: "joint62",
    HandR: "joint63",
  },
  toad: {
    Hip: "joint3",
    LegL1: "joint4",
    LegL2: "joint5",
    FootL: "joint6",
    LegR1: "joint8",
    LegR2: "joint9",
    FootR: "joint10",
    Spine1: "joint12",
    Spine2: "joint13",
    Head: "joint14",
    ShoulderL: "joint16",
    ArmL1: "joint17",
    ArmL2: "joint18",
    HandL: "joint19",
    ShoulderR: "joint20",
    ArmR1: "joint21",
    ArmR2: "joint22",
    HandR: "joint23",
  },
  parabones: {
    // KaronWing rig — bones use their real names (legs/head/feet found directly);
    // only the arms differ (ArmL/ElbowL instead of ArmL1/ArmL2)
    LegL1: "LegL1",
    LegL2: "LegL2",
    LegR1: "LegR1",
    LegR2: "LegR2",
    FootL: "FootL",
    FootR: "FootR",
    Head: "Head",
    ArmL1: "ArmL",
    ArmL2: "ElbowL",
    HandL: "HandL",
    ArmR1: "ArmR",
    ArmR2: "ElbowR",
    HandR: "HandR",
  },
};

// --- seating knobs (the character is scaled RELATIVE to the chair, so it tracks
// the cabin scale automatically; tweak these to fine-tune how they sit) ---------
const CHAR_HEIGHT = 1.72; // character height in WORLD units (the chair bbox is a
//                          near-zero skinned-mesh box, so size absolutely instead)
const CHAR_FWD = 0.68; // nudge out of the seat toward the camera, world units
const CHAR_LIFT = 0.1; // vertical offset, world units (feet at floor = 0)
const CHAR_PITCH = 0.06; // small upright seated lean
const CHAR_ROT = 0.0; // extra Y rotation (radians) on top of the chair's facing
const CHAR_SEAT_OFFSETS = {
  pauline: { scale: 1.25, y: -0.55, z: -0.2 },
  toadette: { y: 0.24, z: -0.12 },
  toad: { y: 0.25 }, // sits low — lift him onto the cushion
  peach: { scale: 1.25, y: -0.5, z: -0.2 }, // swimwear sits a touch high — drop her onto the cushion
  parabones: { y: 0.35 }, // winged — hovers above the seat
};

// seated pose is computed GEOMETRICALLY — the rip rigs name every bone joint0..N,
// JOINT_ALIASES maps those runtime names back to hips, legs, arms, and head.
// SEAT_FACE flips which way is "forward" for future assets if needed.
const SEAT_FACE = 1; // +1 or -1

// --- camera framing knobs (fractions of the ROOM box; the giant backdrop plane
// behind the window is auto-excluded so it doesn't blow up the framing) -------
const CAM_BACK = 0.05; // camera distance from the open FRONT, as a fraction of room depth (neg = outside, further back)
const CAM_H = 0.32; // camera height, as a fraction of room height
const LOOK_BACK = 0.15; // look-at distance from the BACK (window) wall, fraction of depth
const LOOK_H = 0.1; // look-at height (lower = camera angles down), fraction of height

// --- chair placement knobs (two armchairs in the back corners, angled inward) -
const CHAIR_X = 90.0; // horizontal offset from centre, in chair-widths (left/right)
const CHAIR_BACK = 90.0; // how far back toward the window, in chair-depths
const CHAIR_ANGLE = Math.PI / 4; // turn-in angle toward the centre/camera

export function createStartMenu({
  scene,
  camera,
  renderer,
  actors,
  heatmap,
  fx,
  onStart,
}) {
  let active = true;
  let disposed = false;
  const collada = new ColladaLoader();
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

  const group = new THREE.Group();
  scene.add(group);

  // hide the game's actors + value heatmap while the menu is up
  const prevActorsVisible = actors?.group ? actors.group.visible : null;
  if (actors?.group) actors.group.visible = false;
  heatmap?.hide?.();

  // hide the game HUD (Blue/Red/round), the control panel + its tab, and the edge
  // vignette so the menu is clean. All restored in dispose().
  const hiddenEls = [];
  for (const id of ["rl-hud", "rl-panel", "rl-tab"]) {
    const el = document.getElementById(id);
    if (el) {
      hiddenEls.push([el, el.style.display]);
      el.style.display = "none";
    }
  }
  fx?.setVignette?.(false);

  // turn OFF the game's bright daylight while the menu's warm interior is up —
  // otherwise the sun (intensity ~1.9) + my lights double up and blow the light
  // cream cabinet out to white. Restored in dispose().
  const dimmedLights = [];
  scene.traverse((o) => {
    if (o.isLight) {
      dimmedLights.push([o, o.intensity]);
      o.intensity = 0;
    }
  });
  const prevExposure = renderer.toneMappingExposure;
  renderer.toneMappingExposure = 1.1;
  // gentle, NORMAL scene glow: low strength + high threshold so only the very
  // brightest background (the window) blooms a little — books never glow. Reset in
  // dispose().
  fx?.setBloom?.({ strength: 0.2, radius: 0.7, threshold: 0.42 });

  // ---- alive, game-y lighting: a warm KEY with real shadows + a cool RIM for
  // colour contrast + a warm/cool hemisphere. Positioned to the room in frame(),
  // gently animated in update() so the scene breathes instead of sitting flat.
  const KEY_I = 2.5,
    RIM_I = 1.0;
  const menuLights = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xfdf4ec, 0x2a3a50, 1.25); // neutral sky / cool floor
  menuLights.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2e2, KEY_I); // near-white key (casts shadows)
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  menuLights.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x56a6ff, RIM_I); // cool complementary rim
  menuLights.add(rim, rim.target);
  const fill = new THREE.DirectionalLight(0xfff0e6, 0.75); // soft neutral front fill
  menuLights.add(fill, fill.target);
  scene.add(menuLights);

  // camera framing, computed once the room's bounds are known
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  let framed = false;

  // fly-through-the-window state (kicked off by Start)
  let flying = false;
  let flyU = 0;
  let hasWindow = false;
  const flyStart = new THREE.Vector3();
  const flyEnd = new THREE.Vector3();
  const flyLook = new THREE.Vector3();
  const flyThrough = new THREE.Vector3(); // the window centre (set when the sky plane is built)
  const FLY_DUR = 1.0; // seconds (synced to the iris close)

  function frame(root) {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const boxes = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      o.geometry.computeBoundingBox();
      boxes.push(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    if (!boxes.length) return;
    const maxDim = (b) => {
      b.getSize(v);
      return Math.max(v.x, v.y, v.z);
    };
    const sorted = boxes.map(maxDim).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    const box = new THREE.Box3();
    for (const b of boxes) if (maxDim(b) <= median * 2.5) box.union(b); // drop the huge backdrop
    const { min, max } = box;
    const cx = (min.x + max.x) / 2,
      H = max.y - min.y,
      D = max.z - min.z;
    // place the lights relative to the room + size the key's shadow to cover it
    const cz = (min.z + max.z) / 2;
    const S = Math.max(max.x - min.x, H, D);
    const lc = new THREE.Vector3(cx, min.y + H * 0.55, cz);
    key.position.set(lc.x + S * 0.55, lc.y + S * 0.85, lc.z + S * 0.6);
    key.target.position.copy(lc);
    const sc = key.shadow.camera;
    sc.left = -S * 0.75;
    sc.right = S * 0.75;
    sc.top = S * 0.75;
    sc.bottom = -S * 0.75;
    sc.near = S * 0.05;
    sc.far = S * 3.5;
    sc.updateProjectionMatrix();
    key.shadow.bias = -0.0006;
    rim.position.set(lc.x - S * 0.7, lc.y + S * 0.45, lc.z - S * 0.8);
    rim.target.position.copy(lc);
    fill.position.set(lc.x, lc.y + S * 0.25, lc.z + S * 1.1);
    fill.target.position.copy(lc);
    // camera sits inside the room near the open FRONT (max.z), looking back + up
    // at the round window on the BACK wall (min.z)
    camTarget.set(cx, min.y + LOOK_H * H, min.z + LOOK_BACK * D);
    camPos.set(cx, min.y + CAM_H * H, max.z - CAM_BACK * D);
    camera.near = 0.1;
    camera.far = Math.max(camera.far, D * 8);
    camera.updateProjectionMatrix();
    framed = true;
  }

  // a generated sky for the porthole (its own texture is blank white): an
  // atmospheric blue gradient with soft FRACTAL-NOISE clouds (layered value noise,
  // not blobs) so it reads like a real sky.
  function skyCanvas() {
    const S = 384;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d");
    const hash = (i, j, s) => {
      let h = (i * 374761393 + j * 668265263 + s * 1442695040) & 0x7fffffff;
      h = ((h ^ (h >> 13)) * 1274126177) & 0x7fffffff;
      return (h & 0xffff) / 0xffff;
    };
    const vnoise = (x, y, s) => {
      const xi = Math.floor(x),
        yi = Math.floor(y);
      const xf = x - xi,
        yf = y - yi;
      const u = xf * xf * (3 - 2 * xf),
        v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi, s),
        b = hash(xi + 1, yi, s);
      const e = hash(xi, yi + 1, s),
        f = hash(xi + 1, yi + 1, s);
      return a + (b - a) * u + (e - a) * v + (a - b - e + f) * u * v;
    };
    const fbm = (x, y) => {
      let val = 0,
        amp = 0.5,
        fr = 1;
      for (let i = 0; i < 5; i++) {
        val += amp * vnoise(x * fr, y * fr, i * 131);
        fr *= 2;
        amp *= 0.5;
      }
      return val;
    };
    const sstep = (a, b, x) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      const t = y / S; // 0 = zenith (deep blue), 1 = horizon (pale)
      const r0 = 26 + (104 - 26) * t,
        g0 = 92 + (166 - 92) * t,
        b0 = 204 + (230 - 204) * t;
      for (let x = 0; x < S; x++) {
        const n = fbm(x / 95, y / 52); // clouds wider than tall
        const cov = sstep(0.5, 0.72, n) * (0.4 + 0.6 * t); // more cloud toward the horizon
        const i = (y * S + x) * 4;
        d[i] = r0 * (1 - cov) + 255 * cov;
        d[i + 1] = g0 * (1 - cov) + 253 * cov;
        d[i + 2] = b0 * (1 - cov) + 250 * cov;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const skyTex = new THREE.CanvasTexture(skyCanvas());
  skyTex.colorSpace = THREE.SRGBColorSpace;

  function tune(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // the porthole "glass" uses a blank white texture -> swap it for the sky
      const isWindow = mats.some((m) =>
        /window/i.test(m?.map?.image?.src || m?.map?.name || m?.name || ""),
      );
      if (isWindow) {
        // the window mesh's UVs smear a flat texture into vertical stripes -> hide
        // it and place a clean flat sky plane right behind the porthole instead
        o.updateWorldMatrix(true, false);
        const box = new THREE.Box3().setFromObject(o);
        const ctr = box.getCenter(new THREE.Vector3());
        const sz = box.getSize(new THREE.Vector3());
        o.visible = false;
        const w = Math.max(sz.x, sz.y) * 1.2;
        const sky = new THREE.Mesh(
          new THREE.PlaneGeometry(w, w),
          new THREE.MeshBasicMaterial({
            map: skyTex,
            side: THREE.DoubleSide,
            fog: false,
          }),
        );
        sky.position.set(ctr.x, ctr.y, ctr.z - Math.max(sz.z, w * 0.04));
        group.add(sky);
        // remember the porthole so Start flies the camera UP-and-OUT through it
        // (not straight into the low wall point the menu camera looks at)
        flyThrough.copy(ctr);
        hasWindow = true;
        return;
      }
      for (const m of mats) {
        if (!m) continue;
        if (m.map) {
          // tile mirrored HORIZONTALLY only (left-right flip on each repeat) so the
          // panels line up; vertical stays a normal repeat (no up/down flip)
          m.map.wrapS = THREE.MirroredRepeatWrapping;
          m.map.wrapT = THREE.RepeatWrapping;
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.anisotropy = maxAniso;
          m.map.needsUpdate = true;
          // the bright book pages otherwise dominate the bloom -> knock the paper
          // (open book + map) material down so the scene glow doesn't fixate on it
          const src = m.map.image?.src || m.map.name || m.name || "";
          if (/paper/i.test(src)) m.color?.set?.(0x8a8a8a);
        }
        if ("shininess" in m) m.shininess = Math.min(m.shininess || 20, 12);
      }
    });
  }

  function load(name, onReady, side) {
    collada
      .loadAsync(ASSETS + name)
      .then((asset) => {
        if (disposed) return;
        const root = asset.scene;
        tune(root);
        if (side) {
          // both chairs are modelled on the same centred spot (they overlap into
          // one in the table). Recentre each on its own X/Z axis (keep Y so it
          // stays on the floor), then push it back + out to a corner, angled inward.
          const box = new THREE.Box3().setFromObject(root);
          const c = box.getCenter(new THREE.Vector3());
          const sz = box.getSize(new THREE.Vector3());
          root.position.set(-c.x, 0, -c.z);
          const wrap = new THREE.Group();
          wrap.add(root);
          wrap.rotation.y = -side * CHAIR_ANGLE; // left turns right, right turns left
          wrap.position.set(
            c.x + side * CHAIR_X * sz.x, // left (-1) / right (+1)
            0,
            c.z - CHAIR_BACK * sz.z, // back toward the window
          );
          group.add(wrap);
          chairWrap[side] = wrap; // so a character can be parented onto the seat
          chairSize[side] = sz.clone();
        } else {
          group.add(root);
        }
        onReady?.(root);
      })
      .catch((e) => console.warn("start menu: could not load", name, e));
  }

  // ---- characters seated in the two chairs -----------------------------
  const chairWrap = {}; // side(-1/+1) -> chair wrap Group
  const chairSize = {}; // side -> chair Box3 size (for scaling the character)
  const seated = {}; // side -> the character Group currently in the chair
  const seatedIdle = {}; // side -> seated rig animation state
  const seatToken = {}; // side -> guard so rapid cycling ignores stale loads

  function readPicks() {
    let p = {};
    try {
      p = JSON.parse(localStorage.getItem("rl-chars") || "{}");
    } catch {
      p = {};
    }
    const ok = (v, d) =>
      Number.isInteger(v) && v >= 0 && v < CHARACTERS.length ? v : d;
    return { [-1]: ok(p["-1"], 0), [1]: ok(p["1"], 1) }; // default Mario / Luigi
  }
  const picks = readPicks();
  function savePicks() {
    try {
      localStorage.setItem(
        "rl-chars",
        JSON.stringify({ "-1": picks[-1], 1: picks[1] }),
      );
    } catch {
      /* ignore */
    }
  }

  function tuneChar(root, charKey) {
    const face = { eyelids: [], eyes: [] };
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name || "";
      const lower = n.toLowerCase();
      // the iris/eyeball meshes use the eye material (…__EyeMT / __EyePupil…) and the
      // rip sets that texture to repeat, so the iris tiles -> clamp it (stretch)
      const eyeMesh = /eyemt|eyepupil|eyeball/i.test(n);
      const koopaEye = /^Eye(?:Angry|Close|HalfClose|Open|QuarterClose)__/.test(
        n,
      );
      const yoshiEye = charKey === "yoshi" && /^Eye[0-2]__/.test(n);
      const peachEye =
        charKey === "peach" && /^Eye(?:Open|Close|Half|Smile)[LR]__/.test(n);
      if (charKey === "koopa" && koopaEye) {
        const open = /^EyeOpen__/.test(n);
        const closed = /^EyeClose__/.test(n);
        o.visible = open;
        if (open) face.eyes.push({ mesh: o, baseVisible: true });
        if (closed) face.eyelids.push({ mesh: o });
      } else if (yoshiEye) {
        const open = /^Eye0__/.test(n);
        const closed = /^Eye2__/.test(n);
        o.visible = open;
        if (open) face.eyes.push({ mesh: o, baseVisible: true });
        if (closed) face.eyelids.push({ mesh: o });
      } else if (peachEye) {
        // show only the open-eye meshes; hide the close/half/smile expressions
        const open = /^EyeOpen[LR]__/.test(n);
        const closed = /^EyeClose[LR]__/.test(n);
        o.visible = open;
        if (open) face.eyes.push({ mesh: o, baseVisible: true });
        if (closed) face.eyelids.push({ mesh: o });
      } else if (charKey === "bowser" && /MarioEye/i.test(n)) {
        // stray blue Mario-pupil overlay sits over his real KoopaEye — hide it here
        // (NOT via the costume chain, or the blink idle re-shows it every frame)
        o.visible = false;
      } else if (lower.includes("eyelid")) {
        o.visible = false;
        if (charKey !== "mario" || lower.includes("eyelidclose")) {
          face.eyelids.push({ mesh: o });
        }
      } else if (
        (lower.includes("eye") || lower.includes("pupil")) &&
        !lower.includes("brow")
      ) {
        face.eyes.push({ mesh: o, baseVisible: o.visible });
      }
      if (charKey === "luigi") {
        if (/bag/i.test(n)) o.visible = false; // remove the backpack
        // the model ships 4 overlapping hand-pose meshes per side (HandL00..03) —
        // keep only the 00 pose so the hand doesn't render doubled
        if (/^Hand[LR]0[1-9]/i.test(n)) o.visible = false;
      } else if (charKey === "yoshi") {
        if (/^(?:YoshiTongue|Mustache)__/.test(n)) o.visible = false;
        if (/^Hand[LR]0[1-9]/i.test(n)) o.visible = false;
      } else if (
        charKey === "mario" &&
        (/mario_(?:tongue|tooth)/i.test(n) || /^Hair__/i.test(n))
      ) {
        // hide the full hair (it pokes through the cap); the "cap-on" hair
        // (CapHair__HairMT) stays so he's not bald under the hat
        o.visible = false;
      } else if (charKey === "pauline" && /HairCapOn/i.test(n)) {
        // the small top clump pokes through the hat; her real hair (HairBase) stays
        o.visible = false;
      } else if (charKey === "parabones" && /^Mustache/i.test(n)) {
        o.visible = false; // remove the mustache
      } else if (charKey === "parabones" && /MarioEye/i.test(n)) {
        // glowing yellow eyes
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m) continue;
          m.map = null;
          m.color?.set?.(0xffe11a);
          m.emissive?.set?.(0xffd000);
          if ("emissiveIntensity" in m) m.emissiveIntensity = 0.7;
        }
      } else if (charKey === "bowser" && /Mustache/i.test(n)) {
        o.visible = false; // drop his mustache (the Mario-eye overlay is hidden above)
      }
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds can be wrong -> keep it visible
      o.userData.excludeBloom = true; // characters are kept out of the menu bloom
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        if (m.map) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.anisotropy = maxAniso;
        }
        if (eyeMesh && charKey !== "yoshi") {
          // the eye texture is set to repeat -> it tiles; clamp so the single eye
          // image just stretches across the UVs instead
          for (const t of [m.map, m.normalMap, m.roughnessMap]) {
            if (!t) continue;
            t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
            t.needsUpdate = true;
          }
        }
        // matte like the cabin textures: no shiny specular highlights / reflections
        m.specular?.set?.(0x000000);
        if ("shininess" in m) m.shininess = 0;
        if ("reflectivity" in m) m.reflectivity = 0;
        m.envMap = null;
        if ("envMapIntensity" in m) m.envMapIntensity = 0;
        // Pauline's eyeball maps to a red patch of the shared skin texture -> force
        // a clean white sclera (her blue iris is a separate mesh rendered on top)
        if (charKey === "pauline" && /eyeball/i.test(n)) {
          m.map = null;
          m.color?.set?.(0xffffff);
          m.emissive?.set?.(0x000000);
          m.needsUpdate = true;
        }
      }
    });
    return face;
  }

  function collectRig(root, charKey) {
    const bones = new Map();
    const aliases = JOINT_ALIASES[charKey] ?? {};
    root.traverse((o) => {
      if (o.isBone) bones.set(o.name, o);
      else if (o.isSkinnedMesh && o.skeleton) {
        o.skeleton.bones.forEach((b) => bones.set(b.name, b));
      }
    });
    const bone = (...names) => {
      for (const n of names) {
        const b = bones.get(n) || bones.get(aliases[n]);
        if (b) return b;
      }
      return null;
    };
    return {
      bones: [...bones.values()],
      hip: bone("Hip"),
      spine1: bone("Spine1"),
      spine2: bone("Spine2"),
      head: bone("Head"),
      shoulderL: bone("ShoulderL"),
      shoulderR: bone("ShoulderR"),
      armL1: bone("ArmL1"),
      armR1: bone("ArmR1"),
      armL2: bone("ArmL2"),
      armR2: bone("ArmR2"),
      handL: bone("HandL"),
      handR: bone("HandR"),
      legL1: bone("LegL1"),
      legR1: bone("LegR1"),
      legL2: bone("LegL2"),
      legR2: bone("LegR2"),
      footL: bone("FootL"),
      footR: bone("FootR"),
      toeL: bone("ToeL"),
      toeR: bone("ToeR"),
      tail: bone("Tail"),
      wingL1: bone("WingL1"),
      wingL2: bone("WingL2"),
      wingR1: bone("WingR1"),
      wingR2: bone("WingR2"),
      hairL1: bone("HairL1"),
      hairR1: bone("HairR1"),
      eyelidLA: bone("EyelidLA"),
      eyelidLB: bone("EyelidLB"),
      eyelidRA: bone("EyelidRA"),
      eyelidRB: bone("EyelidRB"),
      jaw: bone("Jaw", "JoeUnder"),
      lipUpper: bone("LipUpper"),
      lipLowerCenter: bone("LipLowerCenter"),
      lipLowerL: bone("LipLowerL", "LipLowerLeft"),
      lipLowerR: bone("LipLowerR", "LipLowerRight"),
      mouthCornerL: bone("MouthCornerL", "JoeLeft"),
      mouthCornerR: bone("MouthCornerR", "JoeRight"),
    };
  }

  function makeBoneAimer(root) {
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const pointAlong = (bone, targetBone, target) => {
      if (!bone || !targetBone) return false;
      root.updateMatrixWorld(true);
      const cur = wp(targetBone).sub(wp(bone));
      const tgt = target.clone();
      if (cur.lengthSq() < 1e-8 || tgt.lengthSq() < 1e-8) return false;
      cur.normalize();
      tgt.normalize();
      const qWorld = new THREE.Quaternion().setFromUnitVectors(cur, tgt);
      const nextWorld = qWorld.multiply(
        bone.getWorldQuaternion(new THREE.Quaternion()),
      );
      const parentWorld = bone.parent
        ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
        : new THREE.Quaternion();
      bone.quaternion.copy(parentWorld.invert().multiply(nextWorld));
      bone.updateMatrixWorld(true);
      return true;
    };
    const aim = (bone, targetBone, tx, ty, tz) =>
      pointAlong(bone, targetBone, new THREE.Vector3(tx, ty, tz));
    aim.vector = pointAlong;
    return aim;
  }

  function firstBoneChild(bone, boneSet) {
    return bone?.children.find((c) => boneSet.has(c)) ?? null;
  }

  const poseEuler = new THREE.Euler();
  const poseQuat = new THREE.Quaternion();
  function addLocalPose(bone, x = 0, y = 0, z = 0) {
    if (!bone) return;
    poseEuler.set(x, y, z, "XYZ");
    poseQuat.setFromEuler(poseEuler);
    bone.quaternion.multiply(poseQuat);
  }

  function poseNeutralMouth(rig, charKey) {
    if (charKey === "luigi") {
      addLocalPose(rig.jaw, 0, 0, 0.8);
      return;
    }
    if (charKey !== "mario") return;
    addLocalPose(rig.jaw, 0, 0, -0.2);
    addLocalPose(rig.lipLowerCenter, 0, 0, -0.06);
    addLocalPose(rig.lipLowerL, 0, 0, -0.04);
    addLocalPose(rig.lipLowerR, 0, 0, -0.04);
    addLocalPose(rig.lipUpper, 0, 0, 0.025);
  }

  function poseFallbackSeated(root, rig, aim) {
    const bones = rig.bones;
    const boneSet = new Set(bones);
    if (!bones.length) return false;
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const bb = new THREE.Box3();
    bones.forEach((b) => bb.expandByPoint(wp(b)));
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const arm = { L: null, R: null };
    const thigh = { L: null, R: null };
    for (const b of bones) {
      const c = firstBoneChild(b, boneSet);
      if (!c) continue;
      const p = wp(b);
      const d = wp(c).sub(p);
      const ax = Math.abs(d.x);
      const ay = Math.abs(d.y);
      const az = Math.abs(d.z);
      if (p.y > cy && ax > ay && ax > az) {
        const s = d.x < 0 ? "L" : "R";
        if (!arm[s] || Math.abs(p.x - cx) < Math.abs(wp(arm[s]).x - cx))
          arm[s] = b;
      } else if (p.y < cy && ay > ax && ay > az && d.y < 0) {
        const s = p.x < cx ? "L" : "R";
        if (!thigh[s] || wp(thigh[s]).y < p.y) thigh[s] = b;
      }
    }
    const f = SEAT_FACE;
    const sideAxis =
      arm.L && arm.R
        ? wp(arm.L).sub(wp(arm.R)).normalize()
        : new THREE.Vector3(-1, 0, 0);
    const down = new THREE.Vector3(0, -1, 0);
    const forward = new THREE.Vector3(0, 0, f);
    let posed = false;
    if (arm.L) {
      const out = sideAxis.clone();
      const target = out
        .multiplyScalar(0.58)
        .addScaledVector(down, 0.78)
        .addScaledVector(forward, 0.08);
      posed =
        aim.vector(arm.L, firstBoneChild(arm.L, boneSet), target) || posed;
    }
    if (arm.R) {
      const out = sideAxis.clone().negate();
      const target = out
        .multiplyScalar(0.58)
        .addScaledVector(down, 0.78)
        .addScaledVector(forward, 0.08);
      posed =
        aim.vector(arm.R, firstBoneChild(arm.R, boneSet), target) || posed;
    }
    for (const side of ["L", "R"]) {
      const thighBone = thigh[side];
      if (!thighBone) continue;
      const shin = firstBoneChild(thighBone, boneSet);
      const sign = side === "L" ? -1 : 1;
      posed = aim(thighBone, shin, sign * 0.1, 0.02, 1.15 * f) || posed;
      if (shin)
        posed =
          aim(shin, firstBoneChild(shin, boneSet), sign * 0.02, -1, 0.04 * f) ||
          posed;
    }
    return posed;
  }

  // Build a chair-ready pose from the named Nintendo-style limb rig. If a future
  // model lacks those names, the fallback still finds broad limb directions.
  function poseSeated(root, charKey) {
    root.updateMatrixWorld(true);
    const rig = collectRig(root, charKey);
    const aim = makeBoneAimer(root);
    const f = SEAT_FACE;
    const shoulderLeft = rig.shoulderL?.getWorldPosition(new THREE.Vector3());
    const shoulderRight = rig.shoulderR?.getWorldPosition(new THREE.Vector3());
    const sideAxis =
      shoulderLeft && shoulderRight
        ? shoulderLeft.sub(shoulderRight).normalize()
        : new THREE.Vector3(-1, 0, 0);
    const down = new THREE.Vector3(0, -1, 0);
    const forward = new THREE.Vector3(0, 0, f);
    let posed = false;

    const leg = (side, sign) => {
      const upper = side === "L" ? rig.legL1 : rig.legR1;
      const lower = side === "L" ? rig.legL2 : rig.legR2;
      const foot = side === "L" ? rig.footL : rig.footR;
      const toe = side === "L" ? rig.toeL : rig.toeR;
      posed = aim(upper, lower, sign * 0.08, 0.02, 1.18 * f) || posed;
      posed = aim(lower, foot, sign * 0.02, -1.0, 0.04 * f) || posed;
      posed = aim(foot, toe, sign * 0.02, -0.04, 1.08 * f) || posed;
    };
    leg("L", -1);
    leg("R", 1);

    const arm = (side, sign) => {
      const upper = side === "L" ? rig.armL1 : rig.armR1;
      const lower = side === "L" ? rig.armL2 : rig.armR2;
      const hand = side === "L" ? rig.handL : rig.handR;
      const out = sideAxis.clone().multiplyScalar(side === "L" ? 1 : -1);
      let upperTarget;
      let lowerTarget;
      if (charKey === "pauline") {
        upperTarget = out
          .clone()
          .multiplyScalar(0.14)
          .addScaledVector(down, 0.86)
          .addScaledVector(forward, 0.25);
        lowerTarget = out
          .clone()
          .multiplyScalar(-0.52)
          .addScaledVector(down, side === "R" ? 0.05 : 0.2)
          .addScaledVector(forward, side === "R" ? 0.54 : 0.72);
      } else {
        upperTarget = out
          .clone()
          .multiplyScalar(0.62)
          .addScaledVector(down, 0.76)
          .addScaledVector(forward, 0.08);
        lowerTarget = out
          .clone()
          .multiplyScalar(0.3)
          .addScaledVector(down, 0.42)
          .addScaledVector(forward, 0.42);
      }
      posed = aim.vector(upper, lower, upperTarget) || posed;
      posed = aim.vector(lower, hand, lowerTarget) || posed;
    };
    // Parabones' thin skeletal arms get tucked into the body by the seated aim —
    // rotate the bind T-pose arms down to the sides with a simple local roll instead
    if (charKey !== "parabones") {
      arm("L", -1);
      arm("R", 1);
    } else {
      // remove the arms — collapse the arm bones so the geometry shrinks into the body
      rig.armL1?.scale.setScalar(0.0001);
      rig.armR1?.scale.setScalar(0.0001);
    }
    if (charKey === "pauline") {
      addLocalPose(rig.handL, -1.5, 0, 0);
      addLocalPose(rig.handR, -1.5, 0, 0);
    }

    if (!posed) poseFallbackSeated(root, rig, aim);
    poseNeutralMouth(rig, charKey);
    root.updateMatrixWorld(true);
    return rig;
  }

  const idleEuler = new THREE.Euler();
  const idleQuat = new THREE.Quaternion();
  function idleCtrl(bone) {
    return bone ? { bone, base: bone.quaternion.clone() } : null;
  }

  function createSeatedIdle(root, inner, side, rig, face) {
    const phase = (side < 0 ? 0.7 : 3.6) + Math.random() * 0.35;
    return {
      root,
      inner,
      side,
      phase,
      face,
      fly: !!rig.wingL1, // winged characters get a flying up/down hover
      blinkAt: null,
      blinkDur: 0.12,
      quickBlink: false,
      basePos: inner.position.clone(),
      baseRotY: inner.rotation.y,
      bones: {
        spine1: idleCtrl(rig.spine1),
        spine2: idleCtrl(rig.spine2),
        head: idleCtrl(rig.head),
        shoulderL: idleCtrl(rig.shoulderL),
        shoulderR: idleCtrl(rig.shoulderR),
        armL1: idleCtrl(rig.armL1),
        armR1: idleCtrl(rig.armR1),
        armL2: idleCtrl(rig.armL2),
        armR2: idleCtrl(rig.armR2),
        handL: idleCtrl(rig.handL),
        handR: idleCtrl(rig.handR),
        footL: idleCtrl(rig.footL),
        footR: idleCtrl(rig.footR),
        toeL: idleCtrl(rig.toeL),
        toeR: idleCtrl(rig.toeR),
        tail: idleCtrl(rig.tail),
        wingL1: idleCtrl(rig.wingL1),
        wingL2: idleCtrl(rig.wingL2),
        wingR1: idleCtrl(rig.wingR1),
        wingR2: idleCtrl(rig.wingR2),
        hairL1: idleCtrl(rig.hairL1),
        hairR1: idleCtrl(rig.hairR1),
        eyelidLA: idleCtrl(rig.eyelidLA),
        eyelidLB: idleCtrl(rig.eyelidLB),
        eyelidRA: idleCtrl(rig.eyelidRA),
        eyelidRB: idleCtrl(rig.eyelidRB),
        jaw: idleCtrl(rig.jaw),
        lipUpper: idleCtrl(rig.lipUpper),
        lipLowerCenter: idleCtrl(rig.lipLowerCenter),
        lipLowerL: idleCtrl(rig.lipLowerL),
        lipLowerR: idleCtrl(rig.lipLowerR),
        mouthCornerL: idleCtrl(rig.mouthCornerL),
        mouthCornerR: idleCtrl(rig.mouthCornerR),
      },
    };
  }

  function applyIdle(ctrl, x = 0, y = 0, z = 0) {
    if (!ctrl) return;
    idleEuler.set(x, y, z, "XYZ");
    idleQuat.setFromEuler(idleEuler);
    ctrl.bone.quaternion.copy(ctrl.base).multiply(idleQuat);
  }

  function updateFaceIdle(state, t) {
    const face = state.face ?? {};
    const meshEyelids = face.eyelids ?? [];
    const eyeMeshes = face.eyes ?? [];
    const b = state.bones ?? {};
    const hasMeshBlink = meshEyelids.length > 0;
    const hasBoneBlink = !!(
      b.eyelidLA ||
      b.eyelidLB ||
      b.eyelidRA ||
      b.eyelidRB
    );
    if (!hasMeshBlink && !hasBoneBlink) return;
    if (state.blinkAt == null) {
      state.blinkAt = t + 0.72 + (state.side < 0 ? 0 : 0.38);
      return;
    }
    let blink = 0;
    if (t >= state.blinkAt) {
      const u = (t - state.blinkAt) / state.blinkDur;
      if (u <= 1) {
        blink = Math.sin(u * Math.PI);
      } else if (!state.quickBlink && Math.sin(t * 7.3 + state.phase) > 0.7) {
        state.quickBlink = true;
        state.blinkAt = t + 0.16;
      } else {
        state.quickBlink = false;
        state.blinkAt =
          t + 2.35 + (Math.sin(t * 1.17 + state.phase * 2.4) + 1) * 0.85;
      }
    }
    const closed = blink > 0.24;
    for (const part of meshEyelids) part.mesh.visible = closed;
    for (const part of eyeMeshes) {
      part.mesh.visible = part.baseVisible && blink < 0.72;
    }
    applyIdle(b.eyelidLA, 0, 0, -blink * 0.42);
    applyIdle(b.eyelidLB, 0, 0, -blink * 0.24);
    applyIdle(b.eyelidRA, 0, 0, blink * 0.42);
    applyIdle(b.eyelidRB, 0, 0, blink * 0.24);
  }

  function updateSeatedIdle(state, t) {
    const b = state.bones;
    const p = state.phase;
    const breathe = Math.sin(t * 1.35 + p);
    const breathe2 = Math.sin(t * 2.7 + p * 0.6);
    const glance = Math.sin(t * 0.38 + p * 1.7);
    const nod = Math.sin(t * 0.82 + p * 0.9);
    const hand = Math.sin(t * 1.55 + p + 0.4);
    const mouth = Math.sin(t * 0.74 + p * 1.9);
    const hover = state.fly ? Math.sin(t * 1.7 + p) * 0.09 : 0;
    state.inner.position.y =
      state.basePos.y + breathe * 0.012 + breathe2 * 0.003 + hover;
    state.inner.rotation.y = state.baseRotY + state.side * glance * 0.014;

    updateFaceIdle(state, t);
    applyIdle(b.spine1, breathe * 0.012, state.side * glance * 0.006, 0);
    applyIdle(
      b.spine2,
      breathe * 0.018,
      state.side * glance * 0.008,
      -state.side * breathe * 0.004,
    );
    applyIdle(
      b.head,
      nod * 0.018 + breathe * 0.006,
      state.side * glance * 0.026,
      -state.side * nod * 0.012,
    );
    applyIdle(b.shoulderL, breathe * 0.012, 0, hand * 0.006);
    applyIdle(b.shoulderR, breathe * 0.012, 0, -hand * 0.006);
    applyIdle(b.armL1, hand * 0.018, 0, -breathe * 0.01);
    applyIdle(b.armR1, -hand * 0.018, 0, breathe * 0.01);
    applyIdle(b.armL2, -hand * 0.012, breathe * 0.005, 0);
    applyIdle(b.armR2, hand * 0.012, -breathe * 0.005, 0);
    applyIdle(b.handL, 0, 0, hand * 0.025);
    applyIdle(b.handR, 0, 0, -hand * 0.025);
    applyIdle(b.footL, Math.sin(t * 0.9 + p) * 0.01, 0, 0);
    applyIdle(b.footR, Math.sin(t * 0.85 + p + 1.6) * 0.01, 0, 0);
    applyIdle(b.toeL, Math.sin(t * 1.1 + p) * 0.012, 0, 0);
    applyIdle(b.toeR, Math.sin(t * 1.05 + p + 1.4) * 0.012, 0, 0);
    applyIdle(b.tail, breathe * 0.018, state.side * hand * 0.016, 0);
    // Parabones wings flap forward from rest (0->forward->0), tips lag the base
    const flap = (Math.sin(t * 6.5 + p) + 1) * 0.5;
    const flapTip = (Math.sin(t * 6.5 + p - 0.6) + 1) * 0.5;
    applyIdle(b.wingL1, 0, -flap * 0.5, 0);
    applyIdle(b.wingR1, 0, flap * 0.5, 0);
    applyIdle(b.wingL2, 0, -flapTip * 0.34, 0);
    applyIdle(b.wingR2, 0, flapTip * 0.34, 0);
    applyIdle(b.hairL1, hand * 0.012, 0, breathe * 0.01);
    applyIdle(b.hairR1, -hand * 0.012, 0, -breathe * 0.01);
    applyIdle(b.jaw, 0, 0, mouth * 0.004);
    applyIdle(b.lipUpper, 0, 0, -mouth * 0.002);
    applyIdle(b.lipLowerCenter, 0, 0, mouth * 0.003);
    applyIdle(b.lipLowerL, 0, 0, mouth * 0.002);
    applyIdle(b.lipLowerR, 0, 0, mouth * 0.002);
    applyIdle(b.mouthCornerL, 0, 0, mouth * 0.005);
    applyIdle(b.mouthCornerR, 0, 0, -mouth * 0.005);
    state.root.updateMatrixWorld(true);
  }

  function updateSeatedIdles(t) {
    for (const state of Object.values(seatedIdle)) {
      if (state) updateSeatedIdle(state, t);
    }
  }

  function disposeSeated(side) {
    const g = seated[side];
    if (!g) return;
    delete seatedIdle[side];
    g.parent?.remove(g);
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose?.();
        m.dispose?.();
      }
    });
    seated[side] = null;
  }

  function seatCharacter(side, idx) {
    const wrap = chairWrap[side];
    const chSz = chairSize[side];
    const def = CHARACTERS[idx];
    if (!wrap || !chSz || !def) return; // chair not loaded yet
    const token = (seatToken[side] = (seatToken[side] || 0) + 1);
    collada
      .loadAsync(CHARS + def.file)
      .then((asset) => {
        if (disposed || token !== seatToken[side]) return; // stale / torn down
        const root = asset.scene;
        const charKey = def.file.split("/")[0];
        // ColladaLoader applies a Z_UP->Y conversion; these rips are inconsistent,
        // so verify the model stands (height is the dominant axis) and undo it if
        // it ended up tipped over. Bowser is a genuine Z-up that DOES stand after the
        // loader's fix, but his arm span makes him wider-than-tall and trips this test
        // (which would tip him onto his back) — so skip the undo for him.
        root.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(root);
        let s = box.getSize(new THREE.Vector3());
        if (charKey !== "bowser" && s.y < Math.max(s.x, s.z) * 0.85) {
          root.rotation.set(0, 0, 0);
        }
        const rig = poseSeated(root, charKey); // bend the legs into a sit
        const face = tuneChar(root, charKey); // matte materials + neutral face parts
        // re-measure AFTER posing so the seated figure sits feet-on-floor
        root.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(root);
        s = box.getSize(new THREE.Vector3());
        const anchor =
          (rig.hip || rig.spine1 || null)?.getWorldPosition(
            new THREE.Vector3(),
          ) ?? box.getCenter(new THREE.Vector3());
        root.position.set(-anchor.x, -box.min.y, -anchor.z); // hips centred, feet at y=0
        const inner = new THREE.Group();
        inner.add(root);
        const seatOffset = CHAR_SEAT_OFFSETS[charKey] ?? {};
        inner.scale.setScalar((CHAR_HEIGHT * (seatOffset.scale ?? 1)) / s.y);
        inner.rotation.x = CHAR_PITCH;
        inner.rotation.y = CHAR_ROT;
        inner.position.set(
          seatOffset.x ?? 0,
          CHAR_LIFT + (seatOffset.y ?? 0),
          CHAR_FWD + (seatOffset.z ?? 0),
        );
        disposeSeated(side);
        wrap.add(inner);
        seated[side] = inner;
        seatedIdle[side] = createSeatedIdle(root, inner, side, rig, face);
      })
      .catch((e) => console.warn("character load failed:", def.file, e));
  }

  // render a head-and-shoulders portrait of a character to a data URL (for the
  // selector grid). Loads the model into a throwaway scene, frames the head, renders
  // to an offscreen target, then disposes it. Cached per character.
  const portraitCache = {};
  async function portrait(idx) {
    if (idx in portraitCache) return portraitCache[idx];
    const def = CHARACTERS[idx];
    try {
      const asset = await collada.loadAsync(CHARS + def.file);
      await new Promise((r) => setTimeout(r, 500)); // let textures finish loading
      if (disposed) return null;
      const root = asset.scene;
      root.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(root);
      let s = box.getSize(new THREE.Vector3());
      if (s.y < Math.max(s.x, s.z) * 0.85) {
        root.rotation.set(0, 0, 0);
        root.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(root);
        s = box.getSize(new THREE.Vector3());
      }
      tuneChar(root, def.file.split("/")[0]);
      const ctr = box.getCenter(new THREE.Vector3());
      // the face is on the +Z or -Z side — find it from the eye meshes
      let ez = 0,
        en = 0;
      root.traverse((o) => {
        if (o.isMesh && /eye/i.test(o.name) && !/brow|lid/i.test(o.name)) {
          ez += new THREE.Box3()
            .setFromObject(o)
            .getCenter(new THREE.Vector3()).z;
          en++;
        }
      });
      const dir = en ? Math.sign(ez / en - ctr.z) || 1 : 1;
      const headH = s.y * 0.27;
      const target = new THREE.Vector3(ctr.x, box.max.y - headH * 0.55, ctr.z);
      const sc = new THREE.Scene();
      sc.add(root);
      sc.add(new THREE.HemisphereLight(0xffffff, 0x55606e, 2.6));
      const dl = new THREE.DirectionalLight(0xfff2e2, 2.3);
      dl.position.set(target.x + dir, target.y + headH, target.z + dir * 2);
      sc.add(dl);
      const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
      cam.position.set(
        target.x,
        target.y + headH * 0.18,
        target.z + dir * headH * 3.2,
      );
      cam.lookAt(target);
      const SZ = 256;
      const rt = new THREE.WebGLRenderTarget(SZ, SZ);
      const prevRT = renderer.getRenderTarget();
      const pc = renderer.getClearColor(new THREE.Color());
      const pa = renderer.getClearAlpha();
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(sc, cam);
      renderer.setRenderTarget(prevRT);
      renderer.setClearColor(pc, pa);
      const buf = new Uint8Array(SZ * SZ * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, SZ, SZ, buf);
      const cnv = document.createElement("canvas");
      cnv.width = cnv.height = SZ;
      const c2 = cnv.getContext("2d");
      const im = c2.createImageData(SZ, SZ);
      for (let y = 0; y < SZ; y++) {
        const sy = SZ - 1 - y; // readRenderTargetPixels is bottom-up
        for (let x = 0; x < SZ; x++) {
          const d = (y * SZ + x) * 4,
            q = (sy * SZ + x) * 4;
          im.data[d] = buf[q];
          im.data[d + 1] = buf[q + 1];
          im.data[d + 2] = buf[q + 2];
          im.data[d + 3] = buf[q + 3];
        }
      }
      c2.putImageData(im, 0, 0);
      rt.dispose();
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material)) m?.dispose?.();
      });
      const url = cnv.toDataURL();
      portraitCache[idx] = url;
      return url;
    } catch (e) {
      console.warn("portrait failed:", def?.file, e);
      portraitCache[idx] = null;
      return null;
    }
  }

  load("HomeInside.dae", (room) => frame(room));
  load("HomeChairL.dae", () => seatCharacter(-1, picks[-1]), -1);
  load("HomeChairR.dae", () => seatCharacter(1, picks[1]), +1);

  // ---- DOM overlay -----------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    #rl-menu{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;
      align-items:flex-start;justify-content:flex-end;padding:0 0 13vh 3.5vw;pointer-events:none;
      perspective:1600px;font-family:"Segoe UI",system-ui,sans-serif;opacity:0;transition:opacity .9s ease;}
    #rl-menu .panel{display:flex;flex-direction:column;align-items:flex-start;
      transform-origin:left center;transform:translateX(0) rotateY(32deg);
      transition:transform .45s cubic-bezier(.5,0,.2,1);
      backface-visibility:hidden;-webkit-backface-visibility:hidden;will-change:transform;}
    #rl-menu.show{opacity:1;}
    #rl-menu.out{opacity:0;transition:opacity .5s ease;}
    /* slide ONLY the menu list off-screen while the selector is up (logo stays) */
    #rl-menu.shift .panel{transform:translateX(-160%) rotateY(32deg);}
    #rl-menu .brand{position:absolute;top:2vh;left:2vw;margin:0;}
    #rl-menu .brand img{display:block;width:340px;height:auto;
      filter:drop-shadow(0 8px 20px rgba(0,0,0,.55));}
    #rl-menu .items{display:flex;flex-direction:column;align-items:flex-start;gap:13px;}
    #rl-menu .item{pointer-events:auto;cursor:pointer;border:none;background:none;text-align:left;
      display:flex;align-items:center;gap:16px;padding:9px 12px;opacity:.9;
      font:800 40px "Segoe UI",system-ui,sans-serif;color:#fff;
      text-shadow:0 2px 12px rgba(0,0,0,.55);transition:transform .16s ease,opacity .16s ease;}
    #rl-menu .item:nth-child(n+2){font-size:33px;opacity:.8;}
    #rl-menu .item .cap{width:0;height:38px;overflow:hidden;flex:none;transition:width .18s ease;
      background-color:#e8352b;
      -webkit-mask:url(./assets/icons/Mushroom-Super-icon.png) no-repeat center/contain;
      mask:url(./assets/icons/Mushroom-Super-icon.png) no-repeat center/contain;}
    #rl-menu .item.sel{background:#fff;color:#3a3a3a;border-radius:8px;min-width:440px;
      box-sizing:border-box;padding:16px 84px 16px 20px;transform:rotate(-1.7deg);opacity:1;
      text-shadow:none;box-shadow:0 16px 40px rgba(0,0,0,.34);font-size:44px;}
    #rl-menu .item.sel .cap{width:62px;}
    /* character selector — slides up from the bottom; Player 1 on the left, Player 2
       on the right, the cabin fully visible between them (no backdrop) */
    #rl-select{position:fixed;left:0;right:0;bottom:0;z-index:55;padding:0 0 10vh;
      display:flex;flex-direction:row;justify-content:center;align-items:flex-end;gap:5vw;
      pointer-events:none;font-family:"Segoe UI",system-ui,sans-serif;
      transform:translateY(118%);transition:transform .45s cubic-bezier(.4,0,.2,1);}
    #rl-select.open{transform:translateY(0);}
    #rl-select .side{display:flex;flex-direction:column;align-items:center;gap:10px;pointer-events:auto;}
    #rl-select .plab{font-weight:900;font-size:20px;letter-spacing:2px;text-transform:uppercase;
      text-shadow:0 2px 12px rgba(0,0,0,.8);}
    #rl-select .side.left .plab{color:#ff7d7d;}
    #rl-select .side.right .plab{color:#7da4ff;}
    #rl-select .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:28px 34px;}
    #rl-select .tile{width:96px;height:112px;cursor:pointer;position:relative;}
    #rl-select .tile .pic{position:absolute;inset:0;background-size:contain;background-position:center;
      background-repeat:no-repeat;}
    /* 4 corner-bracket cursors on the selected tile, pulsing out and in */
    #rl-select .tile .cursor{position:absolute;inset:0;display:none;pointer-events:none;z-index:4;}
    #rl-select .tile.sel .cursor,#rl-select .tile:hover .cursor{display:block;}
    /* hovering moves the cursor off the locked pick onto whatever you point at */
    #rl-select .grid:hover .tile.sel:not(:hover) .cursor{display:none;}
    #rl-select .tile .cc{position:absolute;width:30px;height:30px;background-color:#fff;
      -webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;}
    #rl-select .tile .cc.tl{top:10px;left:-8px;-webkit-mask-image:url(./assets/cursor/bg_cursor_1.png);
      mask-image:url(./assets/cursor/bg_cursor_1.png);animation:rl-cur-tl .6s ease-in-out infinite;}
    #rl-select .tile .cc.tr{top:10px;right:-8px;-webkit-mask-image:url(./assets/cursor/bg_cursor_2.png);
      mask-image:url(./assets/cursor/bg_cursor_2.png);animation:rl-cur-tr .6s ease-in-out infinite;}
    #rl-select .tile .cc.bl{bottom:-8px;left:-8px;-webkit-mask-image:url(./assets/cursor/bg_cursor_3.png);
      mask-image:url(./assets/cursor/bg_cursor_3.png);animation:rl-cur-bl .6s ease-in-out infinite;}
    #rl-select .tile .cc.br{bottom:-8px;right:-8px;-webkit-mask-image:url(./assets/cursor/bg_cursor_4.png);
      mask-image:url(./assets/cursor/bg_cursor_4.png);animation:rl-cur-br .6s ease-in-out infinite;}
    @keyframes rl-cur-tl{0%{transform:translate(0,0);}67%{transform:translate(-5px,-5px);}100%{transform:translate(0,0);}}
    @keyframes rl-cur-tr{0%{transform:translate(0,0);}67%{transform:translate(5px,-5px);}100%{transform:translate(0,0);}}
    @keyframes rl-cur-bl{0%{transform:translate(0,0);}67%{transform:translate(-5px,5px);}100%{transform:translate(0,0);}}
    @keyframes rl-cur-br{0%{transform:translate(0,0);}67%{transform:translate(5px,5px);}100%{transform:translate(0,0);}}
    #rl-select .tile .nm{position:absolute;left:0;right:0;bottom:-2px;text-align:center;
      font-weight:800;font-size:12px;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.95),0 0 3px rgba(0,0,0,.9);}
    #rl-select .back{position:absolute;left:1.5vw;bottom:3vh;display:flex;align-items:center;gap:11px;
      cursor:pointer;pointer-events:auto;color:#fff;}
    #rl-select .back .key{display:inline-flex;align-items:center;justify-content:center;
      width:40px;height:38px;border-radius:9px;background:#fff;color:#222;font-weight:800;
      font-size:13px;letter-spacing:.5px;box-shadow:0 3px 12px rgba(0,0,0,.5);}
    #rl-select .back .txt{font-weight:800;font-size:21px;text-shadow:0 2px 12px rgba(0,0,0,.75);}
    #rl-select .back:hover{opacity:.85;}
    /* kill the browser focus outline that flashes a square on the menu buttons */
    #rl-menu .item:focus,#rl-menu .item:focus-visible,
    #rl-select .tile:focus,#rl-select .back:focus{outline:none;}
  `;
  document.head.appendChild(style);

  const CAP = `<span class="cap"></span>`;

  const el = document.createElement("div");
  el.id = "rl-menu";
  el.innerHTML = `
    <div class="brand"><img src="./assets/ui/rival-minds-logo.png" alt="Rival Minds"></div>
    <div class="panel">
      <div class="items">
        <button class="item sel" type="button" data-go="1">${CAP}Start</button>
        <button class="item" type="button" data-open="1">${CAP}Characters</button>
        <button class="item" type="button">${CAP}How It Works</button>
        <button class="item" type="button">${CAP}Algorithms</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  // ---- character selector: a bottom panel with a Player 1 + Player 2 row, both
  // shown at once. Opened from the "Characters" menu item; the menu slides left.
  const selectEl = document.createElement("div");
  selectEl.id = "rl-select";
  selectEl.innerHTML =
    `<div class="side left"><span class="plab">Player 1</span>` +
    `<div class="grid" data-side="-1"></div></div>` +
    `<div class="side right"><span class="plab">Player 2</span>` +
    `<div class="grid" data-side="1"></div></div>` +
    `<div class="back"><span class="key">ESC</span><span class="txt">Back</span></div>`;
  document.body.appendChild(selectEl);

  // a row of tiles per side; each uses the character's icon + the 4 animated
  // corner-bracket cursors (shown on the selected tile)
  const CURSOR =
    `<div class="cursor">` +
    `<div class="cc tl"></div><div class="cc tr"></div>` +
    `<div class="cc bl"></div><div class="cc br"></div></div>`;
  const sideTiles = { "-1": [], 1: [] };
  for (const side of [-1, 1]) {
    const strip = selectEl.querySelector(`.grid[data-side="${side}"]`);
    CHARACTERS.forEach((def, idx) => {
      const key = def.file.split("/")[0];
      const t = document.createElement("div");
      t.className = "tile";
      t.innerHTML =
        `<div class="pic" style="background-image:url(./assets/icons/${key}.png)"></div>` +
        CURSOR;
      t.addEventListener("click", () => {
        picks[side] = idx;
        savePicks();
        seatCharacter(side, idx);
        refreshSelect();
      });
      strip.appendChild(t);
      sideTiles[side].push(t);
    });
  }

  function refreshSelect() {
    for (const side of [-1, 1])
      sideTiles[side].forEach((t, i) =>
        t.classList.toggle("sel", picks[side] === i),
      );
  }
  refreshSelect();
  selectEl
    .querySelector(".back")
    .addEventListener("click", () => closeSelect());
  function onSelectKey(e) {
    if (e.key === "Escape" && selectEl.classList.contains("open"))
      closeSelect();
  }
  window.addEventListener("keydown", onSelectKey);

  function closeSelect() {
    selectEl.classList.remove("open");
    el.classList.remove("shift"); // bring the main menu back
  }
  function openSelect() {
    if (starting) return;
    selectEl.classList.add("open");
    el.classList.add("shift"); // slide the main menu off to the left
    refreshSelect();
  }

  // ---- Mario-style iris wipe: a circular transparent hole in a full-screen black
  // (a big box-shadow). Shrinking the circle to 0 = fades to black; growing it back
  // = reveals the scene. Starts fully open (no black).
  const iris = document.createElement("div");
  const diag = Math.ceil(
    Math.hypot(window.innerWidth, window.innerHeight) * 1.3,
  );
  const setIris = (dpx) => {
    iris.style.width = iris.style.height = dpx + "px";
    iris.style.margin = `${-dpx / 2}px 0 0 ${-dpx / 2}px`;
  };
  iris.style.cssText =
    "position:fixed;top:50%;left:50%;border-radius:50%;pointer-events:none;z-index:100;" +
    `width:${diag}px;height:${diag}px;margin:${-diag / 2}px 0 0 ${-diag / 2}px;` +
    `box-shadow:0 0 0 ${diag}px #000;` +
    "transition:width 1s cubic-bezier(.66,0,.34,1),height 1s cubic-bezier(.66,0,.34,1),margin 1s cubic-bezier(.66,0,.34,1);";
  document.body.appendChild(iris);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let starting = false;
  async function runStart() {
    if (starting) return;
    starting = true;
    el.classList.remove("show");
    el.classList.add("out"); // fade the title card
    selectEl.classList.remove("open"); // close the selector if it's open
    el.classList.remove("shift");

    // 1) fly the camera UP through the porthole and OUT into the sky while the iris
    // closes. Aim at the window centre (not the low wall point), and keep looking
    // forward PAST the window so it reads as exiting, not stopping at the glass.
    flying = true;
    flyU = 0;
    flyStart.copy(camera.position);
    const tgt = hasWindow ? flyThrough : camTarget;
    const dir = tgt.clone().sub(flyStart);
    flyEnd.copy(flyStart).addScaledVector(dir, 1.05); // up to the porthole/sky (black hits here)
    flyLook.copy(flyStart).addScaledVector(dir, 3.0); // look forward, out through the window
    requestAnimationFrame(() => setIris(0)); // close to black (next frame so it animates)
    await wait(1040);

    // 2) fully black: tear the menu down, let the game render (still hidden by black)
    teardown();
    active = false;

    // 3) boot the match and WAIT until the scene is fully loaded (no pop-in)
    await onStart?.();

    // 4) iris-open onto the finished game
    setIris(diag);
    await wait(1020);
    iris.remove();
  }
  // hovering an item slides the white pill onto it; clicking "Start" launches
  const items = [...el.querySelectorAll(".item")];
  const itemsBox = el.querySelector(".items");
  let selected = items[0];
  function select(it) {
    if (it === selected) return;
    selected = it;
    for (const x of items) x.classList.toggle("sel", x === it);
  }
  // move the pill to whichever item the cursor is vertically nearest, so it flips
  // at the midpoint between items — the selection heads to the next one as soon as
  // you move toward it, not only once you're fully over it
  function onMove(e) {
    if (starting || disposed) return;
    const box = itemsBox.getBoundingClientRect();
    if (
      e.clientX < box.left - 140 ||
      e.clientX > box.right + 180 ||
      e.clientY < box.top - 60 ||
      e.clientY > box.bottom + 60
    )
      return;
    let best = selected,
      bestD = Infinity;
    for (const it of items) {
      const r = it.getBoundingClientRect();
      const d = Math.abs(e.clientY - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    select(best);
  }
  window.addEventListener("mousemove", onMove);
  for (const it of items) {
    it.addEventListener("click", () => {
      select(it);
      if (it.dataset.go) runStart();
      else if (it.dataset.open) openSelect();
    });
  }

  // ---- per-frame: a gentle cinematic camera drift ----------------------
  function update(dt, t) {
    updateSeatedIdles(t);
    if (!framed) return;
    if (flying) {
      // accelerate forward through the porthole, looking out into the sky. Ease the
      // look target from the menu's camTarget out to flyLook so the view doesn't
      // snap/rotate on the first frame (start matches where the drift left off).
      flyU = Math.min(1, flyU + dt / FLY_DUR);
      camera.position.lerpVectors(flyStart, flyEnd, flyU * flyU);
      camera.lookAt(
        camTarget.x + (flyLook.x - camTarget.x) * flyU,
        camTarget.y + (flyLook.y - camTarget.y) * flyU,
        camTarget.z + (flyLook.z - camTarget.z) * flyU,
      );
      return;
    }
    const yaw = Math.sin(t * 0.15) * 0.08; // slow orbit around the target
    const dx = camPos.x - camTarget.x,
      dz = camPos.z - camTarget.z;
    const cos = Math.cos(yaw),
      sin = Math.sin(yaw);
    camera.position.set(
      camTarget.x + dx * cos - dz * sin,
      camPos.y + Math.sin(t * 0.11) * 0.12,
      camTarget.z + dx * sin + dz * cos,
    );
    camera.lookAt(camTarget);
  }

  // tear down the cabin + restore the game's render state (NOT the iris, which the
  // transition removes once the scene is revealed)
  function teardown() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("keydown", onSelectKey);
    disposeSeated(-1);
    disposeSeated(1);
    selectEl.remove();
    scene.remove(group);
    scene.remove(menuLights);
    for (const [l, i] of dimmedLights) l.intensity = i; // restore game daylight
    renderer.toneMappingExposure = prevExposure;
    fx?.setBloom?.(); // reset bloom to default (the round's theme re-sets it anyway)
    fx?.setVignette?.(true); // restore the edge vignette for the game
    for (const [hel, d] of hiddenEls) hel.style.display = d; // restore HUD + panel
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose?.();
        m.dispose?.();
      }
    });
    if (actors?.group && prevActorsVisible !== null)
      actors.group.visible = prevActorsVisible;
    el.remove();
    style.remove();
  }

  function dispose() {
    teardown();
    iris.remove();
  }

  return {
    get active() {
      return active;
    },
    update,
    dispose,
  };
}
