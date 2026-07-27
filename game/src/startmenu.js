// Start menu - the Super Mario Odyssey ship cabin (HomeInside) used as a
// cinematic 3D background, with a title card + Start button. main.js shows this
// before booting the live match; clicking Start tears it down and starts the game.
//
// The cabin models are the vendored Odyssey "HomeInside" pack (Y-up, so no axis
// fix needed). They're loaded once and shown as-is (bind pose) - no cloning.

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";

const ASSETS = "./assets/models/home-inside/";
export const CHARS = "./assets/models/characters/";

// the cast copied into game/assets/models/characters/ (from the repo-root
// characters/ rips). Each is a single base-pose Collada model.
export const CHARACTERS = [
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

// CPU opponent data: Player 2 is the COMPUTER, playing the RED side. Each character
// brings its OWN algorithm per level (drawn from that level's family) plus a STRENGTH
// (1-5 pips) per level; the tier is the overall difficulty. The player picks their
// own algorithm from the cards, so the live matchup is the player's pick (Blue) vs
// THIS character's algorithm (Red). Mario is the easiest, Parabones the hardest.
// (Strength = hyperparameter quality; per-character tuning lands with the real envs.)
const opp = (tier, label, algos, strengths) => ({
  tier, label, picks: algos.map((a, i) => [a, strengths[i]]),
});
// per level: [DP, MC, TD, DQN(L4), PG(L5)] - each from that level's family, varied
// across characters so no two opponents feel the same. DP alternates VI/PI, MC
// every/first-visit, TD SARSA/Q/Expected, DQN/PG scale up with difficulty.
const OPPONENTS = [
  opp(1, "Rookie",   ["Value Iteration",  "Every-visit MC", "SARSA",          "DQN",         "REINFORCE"],    [1, 2, 1, 1, 2]), // Mario
  opp(1, "Rookie",   ["Policy Iteration", "First-visit MC", "Q-Learning",     "DQN",         "REINFORCE"],    [2, 2, 2, 2, 2]), // Luigi
  opp(2, "Amateur",  ["Value Iteration",  "Every-visit MC", "Expected-SARSA", "Double-DQN",  "REINFORCE"],    [2, 3, 2, 2, 2]), // Yoshi
  opp(2, "Amateur",  ["Policy Iteration", "First-visit MC", "SARSA",          "DQN",         "Actor-Critic"], [3, 3, 3, 2, 3]), // Toadette
  opp(3, "Skilled",  ["Value Iteration",  "Every-visit MC", "Q-Learning",     "Dueling-DQN", "Actor-Critic"], [3, 3, 3, 3, 3]), // Pauline
  opp(3, "Skilled",  ["Policy Iteration", "First-visit MC", "Expected-SARSA", "Double-DQN",  "Actor-Critic"], [4, 3, 4, 3, 3]), // Koopa
  opp(4, "Veteran",  ["Value Iteration",  "Every-visit MC", "SARSA",          "Dueling-DQN", "Actor-Critic"], [4, 4, 4, 4, 4]), // Bowser
  opp(4, "Veteran",  ["Policy Iteration", "First-visit MC", "Q-Learning",     "DQN",         "PPO"],          [4, 4, 4, 4, 4]), // Peach
  opp(5, "Master",   ["Value Iteration",  "Every-visit MC", "Expected-SARSA", "Double-DQN",  "PPO"],          [5, 4, 5, 5, 4]), // Toad
  opp(5, "Champion", ["Policy Iteration", "First-visit MC", "Q-Learning",     "Dueling-DQN", "PPO"],          [5, 5, 5, 5, 5]), // Parabones
];

// the CPU's difficulty tier (1=easiest .. 5=hardest) from whichever character sits
// in the Computer chair (slot "1" of the saved picks). main.js sends this to the
// trainer so Red's strength matches the chosen opponent.
export function getCpuTier() {
  try {
    const p = JSON.parse(localStorage.getItem("rl-chars") || "{}");
    const opp = OPPONENTS[p["1"]];
    return opp ? opp.tier : 1;
  } catch (e) {
    return 1;
  }
}

// the CPU's PER-CHARACTER hyperparameter LEVEL, 0 (Mario, easiest) .. 9 (Parabones,
// hardest) - the character's index. The 1-5 tier is only the display label; THIS picks
// which of the 10 RED_MODELS drives Red, so all 10 opponents are distinct + progressively
// harder to beat (better hyperparameters -> converges to the optimal policy faster).
export function getCpuLevel() {
  try {
    const i = JSON.parse(localStorage.getItem("rl-chars") || "{}")["1"];
    return Number.isInteger(i) ? Math.max(0, Math.min(CHARACTERS.length - 1, i)) : 0;
  } catch (e) {
    return 0;
  }
}

// the CPU (Computer chair, slot "1") character's display name, for the CPU panel
export function getCpuName() {
  try {
    const p = JSON.parse(localStorage.getItem("rl-chars") || "{}");
    const c = CHARACTERS[p["1"]];
    return c ? c.name : "";
  } catch (e) {
    return "";
  }
}

// display name (as shown on the cards / opponent legend) -> backend algorithm key
export const ALGO_NAME_TO_KEY = {
  "Value Iteration": "value_iteration", "Policy Iteration": "policy_iteration",
  "Every-visit MC": "monte_carlo", "First-visit MC": "first_visit_mc",
  "SARSA": "sarsa", "Q-Learning": "qlearning", "Expected-SARSA": "expected_sarsa",
  "DQN": "dqn", "Double-DQN": "double_dqn", "Dueling-DQN": "dueling_dqn",
  "REINFORCE": "reinforce", "Actor-Critic": "actor_critic", "PPO": "ppo",
};
// which family card each round draws its algorithm from (rounds 1..5): R1 is DP
// (Value/Policy Iteration), R4 deep VALUE (DQN), R5 deep POLICY (Policy Gradient).
const ROUND_FAMILY = ["dp", "mc", "td", "deep", "pg"];

// the chosen CPU character's algorithm KEY per round (Red side), for the backend.
export function getCpuAlgos() {
  try {
    const o = OPPONENTS[JSON.parse(localStorage.getItem("rl-chars") || "{}")["1"]];
    return o ? o.picks.map(([name]) => ALGO_NAME_TO_KEY[name] || null) : null;
  } catch (e) {
    return null;
  }
}
// the player's card pick KEY per round (Blue side). null where a family was not
// picked, so the backend keeps that round's default there.
export function getPlayerAlgos() {
  try {
    const ch = JSON.parse(localStorage.getItem("rl-algos") || "{}");
    return ROUND_FAMILY.map((fam) => ALGO_NAME_TO_KEY[ch[fam]] || null);
  } catch (e) {
    return null;
  }
}

export const JOINT_ALIASES = {
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
    // PeachSwimwear rig (83 joints) - beach look (towel/sarong, flower, sunglasses)
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
    // KaronWing rig - bones use their real names (legs/head/feet found directly);
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
  toad: { y: 0.25 }, // sits low - lift him onto the cushion
  peach: { scale: 1.25, y: -0.5, z: -0.2 }, // swimwear sits a touch high - drop her onto the cushion
  parabones: { y: 0.35 }, // winged - hovers above the seat
};

// seated pose is computed GEOMETRICALLY - the rip rigs name every bone joint0..N,
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

  const PARABONES_LOOSE_LIMB_SKIN_JOINTS = new Set([
    2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16,
  ]);
  function stripParabonesLooseLimbGeometry(mesh) {
    const geo = mesh.geometry;
    const pos = geo?.getAttribute?.("position");
    const skinIndex = geo?.getAttribute?.("skinIndex");
    const skinWeight = geo?.getAttribute?.("skinWeight");
    if (!pos || !skinIndex || !skinWeight) return;

    const drop = new Uint8Array(pos.count);
    const idxArray = skinIndex.array;
    const weightArray = skinWeight.array;
    const idxSize = skinIndex.itemSize;
    const weightSize = skinWeight.itemSize;
    for (let i = 0; i < pos.count; i++) {
      let limbWeight = 0;
      for (let j = 0; j < Math.min(idxSize, weightSize); j++) {
        const joint = idxArray[i * idxSize + j];
        if (PARABONES_LOOSE_LIMB_SKIN_JOINTS.has(joint)) {
          limbWeight += weightArray[i * weightSize + j] || 0;
        }
      }
      if (limbWeight > 0.2) drop[i] = 1;
    }

    const index = geo.getIndex?.();
    if (index) {
      const src = index.array;
      const kept = [];
      for (let i = 0; i < src.length; i += 3) {
        const a = src[i];
        const b = src[i + 1];
        const c = src[i + 2];
        if (!drop[a] && !drop[b] && !drop[c]) kept.push(a, b, c);
      }
      if (kept.length === src.length) return;
      const IndexArray = pos.count > 65535 ? Uint32Array : Uint16Array;
      geo.setIndex(new THREE.BufferAttribute(new IndexArray(kept), 1));
      geo.clearGroups();
      geo.addGroup(0, kept.length, 0);
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        if (!drop[i] && !drop[i + 1] && !drop[i + 2]) continue;
        pos.setXYZ(i, 0, 0, 0);
        pos.setXYZ(i + 1, 0, 0, 0);
        pos.setXYZ(i + 2, 0, 0, 0);
      }
      pos.needsUpdate = true;
    }
    geo.computeBoundingBox?.();
    geo.computeBoundingSphere?.();
  }

export function tuneChar(root, charKey, maxAniso = 8) {
    const face = { eyelids: [], eyes: [] };
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name || "";
      const lower = n.toLowerCase();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const meshSignature = [
        n,
        o.geometry?.name,
        ...mats.flatMap((m) => [m?.name, m?.map?.name, m?.map?.image?.src]),
      ]
        .filter(Boolean)
        .join(" ");
      const isParabonesWingMesh =
        charKey === "parabones" &&
        /(?:KaronWing__WingMT|WingMT|BodyWing)/i.test(meshSignature);
      if (charKey === "parabones" && !isParabonesWingMesh) {
        stripParabonesLooseLimbGeometry(o);
      }
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
        // stray blue Mario-pupil overlay sits over his real KoopaEye - hide it here
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
        // the model ships 4 overlapping hand-pose meshes per side (HandL00..03) -
        // keep only the 00 pose so the hand doesn't render doubled
        if (/^Hand[LR]0[1-9]/i.test(n)) o.visible = false;
      } else if (charKey === "yoshi") {
        if (/^(?:YoshiTongue|Mustache)__/.test(n)) o.visible = false;
        if (/^Hand[LR]0[1-9]/i.test(n)) o.visible = false;
      } else if (
        charKey === "mario" &&
        (/mario_(?:tongue|tooth)/i.test(n) || /^Hair__/i.test(n) || /^CaptainCap/i.test(n))
      ) {
        // hide the full hair (it pokes through the cap) and the spare Captain cap
        // (the model ships two hats); the "cap-on" hair (CapHair__HairMT) and the
        // regular Cap stay, so he keeps one hat and isn't bald under it
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
      for (const m of mats) {
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

export function collectRig(root, charKey) {
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
      fingerL: bone("FingerL"),
      fingerR: bone("FingerR"),
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
  for (const id of ["rl-hud", "rl-panel", "rl-cpanel", "rl-tab", "rl-keys"]) {
    const el = document.getElementById(id);
    if (el) {
      hiddenEls.push([el, el.style.display]);
      el.style.display = "none";
    }
  }
  fx?.setVignette?.(false);

  // turn OFF the game's bright daylight while the menu's warm interior is up -
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
  // brightest background (the window) blooms a little - books never glow. Reset in
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
        if (side === "L") {
          // Pauline LEFT hand
          lowerTarget = out
            .clone()
            .multiplyScalar(-0.52)
            .addScaledVector(down, 0.2)
            .addScaledVector(forward, 0.72);
        } else {
          // Pauline RIGHT hand
          lowerTarget = out
            .clone()
            .multiplyScalar(-0.52)
            .addScaledVector(down, 0.05)
            .addScaledVector(forward, 0.54);
        }
      } else if (charKey === "peach") {
        // out/in = multiplyScalar (toward 0/positive = further OUT), down = height
        // (bigger = lower), forward = toward the camera
        upperTarget = out
          .clone()
          .multiplyScalar(0.14)
          .addScaledVector(down, 0.86)
          .addScaledVector(forward, 0.25);
        if (side === "L") {
          // Peach LEFT hand
          lowerTarget = out
            .clone()
            .multiplyScalar(-0.2)
            .addScaledVector(down, 0.25)
            .addScaledVector(forward, 0.72);
        } else {
          // Peach RIGHT hand
          lowerTarget = out
            .clone()
            .multiplyScalar(-0.2)
            .addScaledVector(down, 0.22)
            .addScaledVector(forward, 0.54);
        }
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
    // Parabones' thin skeletal arms get tucked into the body by the seated aim -
    // rotate the bind T-pose arms down to the sides with a simple local roll instead
    if (charKey !== "parabones") {
      arm("L", -1);
      arm("R", 1);
    } else {
      // remove the arms - collapse the arm bones so the geometry shrinks into the body
      [
        rig.armL1,
        rig.armL2,
        rig.handL,
        rig.fingerL,
        rig.armR1,
        rig.armR2,
        rig.handR,
        rig.fingerR,
      ].forEach((b) => b?.scale.setScalar(0.0001));
    }
    if (charKey === "pauline") {
      addLocalPose(rig.handL, -1.5, 0, 0);
      addLocalPose(rig.handR, -1.5, 0, 0);
    } else if (charKey === "peach") {
      addLocalPose(rig.handL, 1.64, 0, 0); // Peach LEFT hand rotation (palm down)
      addLocalPose(rig.handR, -1.5, 0, 0); // Peach RIGHT hand rotation
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
        // (which would tip him onto his back) - so skip the undo for him.
        root.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(root);
        let s = box.getSize(new THREE.Vector3());
        if (charKey !== "bowser" && s.y < Math.max(s.x, s.z) * 0.85) {
          root.rotation.set(0, 0, 0);
        }
        const rig = poseSeated(root, charKey); // bend the legs into a sit
        const face = tuneChar(root, charKey, maxAniso); // matte materials + neutral face parts
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
      tuneChar(root, def.file.split("/")[0], maxAniso);
      const ctr = box.getCenter(new THREE.Vector3());
      // the face is on the +Z or -Z side - find it from the eye meshes
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

  // ===== Live 3D Cappy: the presenter on the How-It-Works wizard. He lives in his own
  // small transparent WebGL canvas (own scene + lights + animation loop) inside the panel,
  // spinning & nodding in real time. The loop runs only while the wizard is open. =====
  let cappy3D = null; // {renderer,scene,camera,pivot,ready,running,raf,t0}
  function initCappy3D() {
    if (cappy3D || disposed) return;
    const canvas = howtoEl.querySelector("canvas.hw-mascot");
    if (!canvas) return;
    // framing/lighting knobs - tweak live if he's mis-angled/too big/small/dark
    const DIST = 2.05, LIFT = 0.04, SWAY = 0.14, NOD = 0.05, SPIN = 0.8;
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    r.setClearColor(0x000000, 0);
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const w = canvas.clientWidth || 248, h = canvas.clientHeight || 296;
    r.setSize(w, h, false);
    if (THREE.SRGBColorSpace && "outputColorSpace" in r) r.outputColorSpace = THREE.SRGBColorSpace;
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xffffff, 0x59606e, 3.0));
    const dl = new THREE.DirectionalLight(0xfff3e6, 2.4);
    dl.position.set(2, 4, 3);
    sc.add(dl);
    const cam = new THREE.PerspectiveCamera(30, w / h, 0.01, 100);
    const pivot = new THREE.Group();
    sc.add(pivot);
    cappy3D = { renderer: r, scene: sc, camera: cam, pivot, ready: false, running: false, raf: 0, t0: 0, SWAY, NOD, SPIN };
    collada
      .loadAsync(CHARS + "cappy/cappy.dae")
      .then((asset) => {
        if (disposed) return;
        const root = asset.scene;
        // the rip bundles every eye state (open / half-shut / closed) as overlapping
        // meshes. Group them so cappyTick can blink (open→half→closed→open); pupils ride
        // with the open eyes. Start wide-eyed.
        const eyes = { open: [], half1: [], half2: [], half3: [], close: [] };
        root.traverse((o) => {
          if (!o.isMesh) return;
          const n = o.name + " " + (o.parent ? o.parent.name : "");
          if (/EyeClose/i.test(n)) eyes.close.push(o);
          else if (/EyeHalf1/i.test(n)) eyes.half1.push(o);
          else if (/EyeHalf2/i.test(n)) eyes.half2.push(o);
          else if (/EyeHalf3/i.test(n)) eyes.half3.push(o);
          else if (/EyeOpen/i.test(n) || /EyePupil/i.test(n)) eyes.open.push(o);
        });
        for (const k in eyes) for (const m of eyes[k]) m.visible = k === "open";
        cappy3D.eyes = eyes;
        cappy3D.eyeState = "open";
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const s = box.getSize(new THREE.Vector3());
        const ctr = box.getCenter(new THREE.Vector3());
        // which way does he face? (eyes sit on the ±Z side)
        let ez = 0, en = 0;
        root.traverse((o) => {
          if (o.isMesh && /eye/i.test(o.name) && !/lid|brow/i.test(o.name)) {
            ez += new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).z;
            en++;
          }
        });
        const dir = en ? Math.sign(ez / en - ctr.z) || 1 : 1;
        root.position.sub(ctr); // centre him on the spin pivot
        pivot.add(root);
        const reach = Math.max(s.x, s.y, s.z);
        cam.position.set(0, reach * LIFT, dir * reach * DIST);
        cam.lookAt(0, 0, 0);
        cappy3D.ready = true;
      })
      .catch((e) => console.warn("cappy 3D load failed:", e));
  }
  const CAPPY_RISE_MS = 1500, CAPPY_EXIT_MS = 780;
  function cappyTick() {
    if (!cappy3D || !cappy3D.running) return;
    cappy3D.raf = requestAnimationFrame(cappyTick);
    if (!cappy3D.ready) return; // don't start the entrance until he's actually drawable
    const now = performance.now();
    const css = cappy3D.renderer.domElement.style;
    // ----- exit: the fly-in, MIRRORED - sent straight up and off the top, with the same
    // side-to-side wave and a full flip, but accelerating away (the entrance eased in) and
    // the wave growing as he leaves (it faded as he arrived). -----
    if (cappy3D.exiting) {
      const p = Math.min(1, (now - cappy3D.exitT0) / CAPPY_EXIT_MS);
      const acc = p * p; // easeIn - mirror of the entrance's easeOut
      const wig = Math.sin(p * Math.PI * 5); // same weave as the entrance
      const x = wig * 15 * p; // wavy around a straight-up path, growing as he leaves
      const y = 7 + (-window.innerHeight * 0.85 - 7) * acc; // up and off the top
      const rot = -5 - 17 * acc; // mirror of the entrance lean (-22 → -5)
      css.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
      const t = (now - cappy3D.t0) / 1000;
      cappy3D.pivot.rotation.y = Math.sin(t * cappy3D.SPIN) * cappy3D.SWAY + acc * Math.PI * 2; // one flip
      cappy3D.renderer.render(cappy3D.scene, cappy3D.camera);
      if (p >= 1) { cappy3D.running = false; cancelAnimationFrame(cappy3D.raf); }
      return;
    }
    // begin the fly-in on the first frame he can be drawn; stash the off-screen start
    // (just below-left of the viewport) so the whole arc is one interpolation, in px
    if (!cappy3D.entranceT0) {
      cappy3D.entranceT0 = now;
      cappy3D.sx = -window.innerWidth * 0.05; // smaller horizontal offset = more vertical
      cappy3D.sy = window.innerHeight * 0.72; // start fully below the bottom edge, off-screen
    }
    const e = Math.min(1, (now - cappy3D.entranceT0) / CAPPY_RISE_MS); // 0..1
    const ease = e < 1 ? 1 - Math.pow(1 - e, 3) : 1; // easeOutCubic - shared by move + spin
    if (e < 1) {
      // glide up (easeOutCubic) along a WAVY path - the trajectory weaves side-to-side,
      // but Cappy himself just keeps a steady, smoothly-levelling tilt (no per-wiggle bank).
      // the weave decays to 0 as he arrives so it settles cleanly into the hover.
      const decay = 1 - e;
      const wig = Math.sin(e * Math.PI * 5); // ~2.5 side-to-side cycles on the way up
      const x = cappy3D.sx * (1 - ease) + wig * 15 * decay;
      const y = cappy3D.sy + (7 - cappy3D.sy) * ease;
      const rot = -22 + 17 * ease; // steady, smooth lean to rest - no wiggle on HIM
      css.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
    } else {
      // continuous hover, phase-locked to the entrance end (sin starts at 0 → no jump)
      const ht = (now - cappy3D.entranceT0 - CAPPY_RISE_MS) / 1000;
      const bob = Math.sin(ht * 1.85) * 9, tilt = Math.sin(ht * 1.85) * 4;
      css.transform = `translate(0px,${(7 - bob).toFixed(1)}px) rotate(${(-5 + tilt).toFixed(2)}deg)`;
    }
    // gentle 3D life: sway around Y + a small nod. During the fly-in he also spins like a
    // thrown cap, unwinding into the idle sway as he lands.
    const t = (now - cappy3D.t0) / 1000;
    let yaw = Math.sin(t * cappy3D.SPIN) * cappy3D.SWAY;
    if (e < 1) yaw += (1 - ease) * Math.PI * 2; // entrance spin, eased like his flight
    cappy3D.pivot.rotation.y = yaw;
    cappy3D.pivot.rotation.x = Math.sin(t * 0.6) * cappy3D.NOD;
    // blink: a quick close→open every few seconds, stepping through the half states
    if (cappy3D.eyes) {
      const BLINK_PERIOD = 3.6, BLINK_DUR = 0.16;
      const since = (t + 1.2) % BLINK_PERIOD; // offset so he doesn't blink the instant he loads
      let eye = "open";
      if (since < BLINK_DUR) {
        const p = since / BLINK_DUR;
        const f = p < 0.5 ? p * 2 : (1 - p) * 2; // 0(open) → 1(closed) → 0(open)
        eye = f < 0.2 ? "open" : f < 0.45 ? "half1" : f < 0.7 ? "half2" : f < 0.9 ? "half3" : "close";
      }
      if (eye !== cappy3D.eyeState) {
        const E = cappy3D.eyes;
        for (const k in E) { const v = k === eye; for (const m of E[k]) m.visible = v; }
        cappy3D.eyeState = eye;
      }
    }
    cappy3D.renderer.render(cappy3D.scene, cappy3D.camera);
  }
  function startCappy3D() {
    initCappy3D();
    if (!cappy3D) return;
    cappy3D.exiting = false; // clear any in-progress exit (e.g. reopened mid-fly-off)
    cappy3D.entranceT0 = 0; // replay the fly-in from the start on (re)open
    cappy3D.t0 = performance.now();
    if (!cappy3D.running) {
      cappy3D.running = true;
      cappyTick();
    }
  }
  function stopCappy3D() {
    if (cappy3D) {
      cappy3D.running = false;
      cappy3D.exiting = false;
      cancelAnimationFrame(cappy3D.raf);
    }
  }
  // trigger the fly-off; the loop keeps running and stops itself when he's off-screen
  function exitCappy3D() {
    if (cappy3D && cappy3D.running) {
      cappy3D.exiting = true;
      cappy3D.exitT0 = performance.now();
    }
  }

  load("HomeInside.dae", (room) => frame(room));
  load("HomeChairL.dae", () => showInChair(-1, picks[-1]), -1);
  load("HomeChairR.dae", () => showInChair(1, picks[1]), +1);

  // ---- DOM overlay -----------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    /* ===== ONE responsive knob for the whole start-menu UI =====
       --ui  scales the menu, character select, how-it-works + screen titles.
       --card scales the fanned algorithm deck, which is wider so it shrinks a
       little more to stay on screen. Both are driven from this single block,
       so every part of the UI grows/shrinks together instead of one-by-one. */
    :root{--ui:.95;--card:1;}
    @media (max-width:1800px){:root{--ui:.9;--card:.92;}}
    @media (max-width:1650px){:root{--ui:.84;--card:.84;}}
    @media (max-width:1500px){:root{--ui:.78;--card:.76;}}
    @media (max-width:1380px){:root{--ui:.72;--card:.7;}}
    @media (max-width:1260px){:root{--ui:.67;--card:.63;}}
    @media (max-width:1140px){:root{--ui:.62;--card:.56;}}
    @media (max-width:1024px){:root{--ui:.58;--card:.5;}}
    @media (max-width:900px){:root{--ui:.54;--card:.44;}}
    @media (max-width:780px){:root{--ui:.5;--card:.38;}}
    @media (max-width:660px){:root{--ui:.46;--card:.32;}}
    @media (max-width:540px){:root{--ui:.42;--card:.27;}}
    @media (max-width:440px){:root{--ui:.38;--card:.22;}}
    @media (max-width:360px){:root{--ui:.34;--card:.18;}}
    /* the CPU stat sheet is a fixed-px panel pinned to the right edge, so it needs
       its OWN knob: --cpu-w tracks the window width (keep it in step with the
       character tiles) and --cpu-h the height (a short laptop screen is what makes
       it crowd the tile grid) - the smaller of the two wins. --cpu-y rides the card
       higher on short screens so its bottom stays clear of the tiles. Both are 1 /
       50% on a full desktop window, so nothing there moves. */
    :root{--cpu-w:1;--cpu-h:1;--cpu:min(var(--cpu-w),var(--cpu-h));--cpu-y:50%;}
    @media (max-width:1650px){:root{--cpu-w:.88;}}
    @media (max-width:1400px){:root{--cpu-w:.8;}}
    @media (max-width:1200px){:root{--cpu-w:.72;}}
    @media (max-width:1000px){:root{--cpu-w:.62;}}
    @media (max-height:900px){:root{--cpu-h:.86;--cpu-y:46%;}}
    @media (max-height:800px){:root{--cpu-h:.78;--cpu-y:44%;}}
    @media (max-height:700px){:root{--cpu-h:.68;--cpu-y:42%;}}
    @media (max-height:600px){:root{--cpu-h:.58;--cpu-y:40%;}}
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
    #rl-menu .brand{position:absolute;top:2vh;left:2vw;margin:0;
      transform:scale(var(--ui));transform-origin:top left;}
    #rl-menu .brand img{display:block;width:250px;height:auto;
      filter:drop-shadow(0 8px 20px rgba(0,0,0,.55));}
    #rl-menu .items{display:flex;flex-direction:column;align-items:flex-start;gap:13px;
      transform:scale(var(--ui));transform-origin:left bottom;}
    #rl-menu .item{pointer-events:auto;cursor:pointer;border:none;background:none;text-align:left;
      display:flex;align-items:center;gap:16px;padding:9px 12px;opacity:.9;
      font:800 40px "Segoe UI",system-ui,sans-serif;color:#fff;
      text-shadow:0 2px 12px rgba(0,0,0,.55);transition:transform .16s ease,opacity .16s ease;}
    #rl-menu .item:nth-child(n+2){font-size:33px;opacity:.8;}
    #rl-menu .item .cap{width:0;height:38px;flex:none;transition:width .18s ease;
      transform-origin:50% 90%;background-color:#e8352b;
      -webkit-mask:url(./assets/icons/Mushroom-Super-icon.png) no-repeat center/contain;
      mask:url(./assets/icons/Mushroom-Super-icon.png) no-repeat center/contain;}
    #rl-menu .item.sel{background:#fff;color:#3a3a3a;border-radius:3px;min-width:560px;
      box-sizing:border-box;padding:16px 96px 16px 20px;transform:rotate(-1.7deg);opacity:1;
      text-shadow:none;box-shadow:0 16px 40px rgba(0,0,0,.34);font-size:44px;
      position:relative;overflow:visible;}
    #rl-menu .item.sel .cap{width:62px;animation:rl-cap-idle 1.5s ease-in-out infinite;}
    /* idle: the mushroom bounces with a springy squash-and-stretch while selected */
    @keyframes rl-cap-idle{
      0%{transform:translateY(0) scaleX(1) scaleY(1);}
      9%{transform:translateY(0) scaleX(1.22) scaleY(.76);}   /* crouch */
      28%{transform:translateY(-11px) scaleX(.85) scaleY(1.2);} /* spring up + stretch */
      46%{transform:translateY(0) scaleX(1.16) scaleY(.86);}   /* land squash */
      60%{transform:translateY(-4px) scaleX(.96) scaleY(1.05);} /* small rebound */
      72%,100%{transform:translateY(0) scaleX(1) scaleY(1);}}  /* settle + a beat */
    /* ---- confirm sweep (Odyssey CONFIRM WIPE) when a menu item is clicked ----
       the white pill dithers to gray L->R, the label recolours to white in the
       same sweep, and the mushroom shoots off to the right, squashing as it goes */
    #rl-menu .item{position:relative;}
    #rl-menu .item .cap,#rl-menu .item .lblwrap{position:relative;z-index:1;}
    #rl-menu .item .lblwrap{display:inline-block;}
    #rl-menu .item .lbl.w{position:absolute;left:0;top:0;color:#fff;visibility:hidden;
      white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.5);}
    /* the gray bleeds 2px past the pill (overflow is visible) so no white edge is
       left peeking around it once it's filled */
    #rl-menu .item .wipe{position:absolute;inset:-2px;z-index:0;border-radius:4px;
      background:#4f4f4f;visibility:hidden;pointer-events:none;
      -webkit-mask:url(./assets/ui/confirm-wipe.png) -768px 0 / auto repeat-y;
      mask:url(./assets/ui/confirm-wipe.png) -768px 0 / auto repeat-y;}
    #rl-menu .item.confirm .wipe,#rl-menu .item.confirm .lbl.w{visibility:visible;
      animation:rl-confirm-wipe .5s ease-out forwards;}
    #rl-menu .item.confirm .lbl.w{
      -webkit-mask:url(./assets/ui/confirm-wipe.png) -768px 0 / auto repeat-y;
      mask:url(./assets/ui/confirm-wipe.png) -768px 0 / auto repeat-y;
      animation-delay:.06s;} /* the label sits ~90px in, so trail the gray front */
    #rl-menu .item.confirm .cap{animation:rl-confirm-cap .23s cubic-bezier(.5,0,.9,.4) forwards;}
    @keyframes rl-confirm-wipe{
      from{-webkit-mask-position:-768px 0;mask-position:-768px 0;}
      to{-webkit-mask-position:0 0;mask-position:0 0;}}
    @keyframes rl-confirm-cap{
      0%{transform:translateX(0) scale(1,1);}
      32%{transform:translateX(16%) scaleX(1.75) scaleY(.7);}
      100%{transform:translateX(560%) scaleX(2.6) scaleY(.46);opacity:0;}}
    /* character selector - slides up from the bottom; Player 1 on the left, Player 2
       on the right, the cabin fully visible between them (no backdrop) */
    #rl-select{position:fixed;left:0;right:0;bottom:0;z-index:55;padding:0 0 10vh;
      display:flex;flex-direction:row;justify-content:center;align-items:flex-end;
      pointer-events:none;font-family:"Segoe UI",system-ui,sans-serif;
      transform:translateY(118%);transition:transform .45s cubic-bezier(.4,0,.2,1);}
    #rl-select.open{transform:translateY(0);}
    #rl-select .rows{display:flex;flex-direction:row;justify-content:center;align-items:flex-end;
      gap:5vw;transform:scale(var(--ui));transform-origin:bottom center;}
    #rl-select .side{display:flex;flex-direction:column;align-items:center;gap:10px;pointer-events:auto;}
    #rl-select .plab{display:inline-flex;align-items:center;gap:9px;
      padding:6px 20px;border-radius:999px;font-weight:900;
      text-transform:uppercase;color:#fff;border:2px solid rgba(255,255,255,.3);
      position:relative;overflow:hidden;}
    /* recurring light "glint" sweeping across each pill */
    #rl-select .plab::after{content:"";position:absolute;top:0;left:-60%;width:45%;
      height:100%;pointer-events:none;transform:skewX(-22deg);
      background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);
;}
    #rl-select.open .plab::after{animation:rl-plab-shine 3.6s ease-in-out infinite;}
    #rl-select.open .side.right .plab::after{animation-delay:1.8s;}
    @keyframes rl-plab-shine{0%{left:-60%;}22%{left:140%;}100%{left:140%;}}
    /* bouncy pop-in when the selector opens (P1 from the left, P2 from the right) */
    #rl-select.open .side.left .plab{
      animation:rl-plab-in-l .55s cubic-bezier(.34,1.56,.64,1) .08s both;}
    #rl-select.open .side.right .plab{
      animation:rl-plab-in-r .55s cubic-bezier(.34,1.56,.64,1) .08s both;}
    @keyframes rl-plab-in-l{0%{transform:translateX(-46px) scale(.8);opacity:0;}
      100%{transform:none;opacity:1;}}
    @keyframes rl-plab-in-r{0%{transform:translateX(46px) scale(.8);opacity:0;}
      100%{transform:none;opacity:1;}}
    #rl-select .plab .ptxt{font-size:17px;letter-spacing:3px;}
    #rl-select .plab .pnum{display:grid;place-items:center;width:30px;height:30px;
      box-sizing:border-box;padding-bottom:2px;border-radius:50%;font-size:19px;background:#fff;}
    #rl-select .side.left .plab{background:#3360e6;}
    #rl-select .side.left .pnum{color:#2b54dc;}
    #rl-select .side.right .plab{background:#e23333;}
    #rl-select .side.right .pnum{color:#dc2b2b;}
    #rl-select .plab.cpu{padding:6px 20px;}
    /* the computer's static stat sheet - its OWN Mario-style panel pinned right */
    #rl-cpu{position:fixed;right:2.5vw;top:var(--cpu-y);z-index:58;width:330px;box-sizing:border-box;pointer-events:none;
      transform:translate(calc(100% + 6vw),-50%) scale(calc(var(--cpu) * .96));transform-origin:right center;
      background:linear-gradient(180deg,#fff7e6 0%,#f3e3c0 100%);
      border:4px solid #000;border-radius:22px;padding:16px 18px 18px;color:#3a2a14;
      box-shadow:2px 2px 0 #000,4px 4px 0 #000,6px 6px 0 #000,8px 8px 0 #000,
        9px 11px 0 #000,9px 22px 34px rgba(0,0,0,.45);
      font-family:"Segoe UI",system-ui,sans-serif;opacity:1;
      transition:none;}
    #rl-cpu.show{transform:translate(0,-50%) scale(var(--cpu));animation:rl-cpu-in .8s .06s both;}
    /* exit (.leaving added on close): small wind-up, then launches off the right edge */
    #rl-cpu.leaving{animation:rl-cpu-out .5s both;}
    @keyframes rl-cpu-out{
      0%{transform:translate(0,-50%) scale(var(--cpu));animation-timing-function:cubic-bezier(.3,0,.5,1);}
      22%{transform:translate(-24px,-50%) scale(calc(var(--cpu) * 1.02));animation-timing-function:cubic-bezier(.55,0,.75,.2);}
      100%{transform:translate(calc(100% + 7vw),-50%) scale(calc(var(--cpu) * .94));}}
    /* slides in from off the right edge, slams into its resting "wall" and bounces
       a couple of times with decreasing recoil - mirrors the title's rl-title-drop */
    @keyframes rl-cpu-in{
      0%{transform:translate(calc(100% + 6vw),-50%) scale(calc(var(--cpu) * .96));animation-timing-function:cubic-bezier(.5,.02,.9,.3);}
      46%{transform:translate(0,-50%) scale(var(--cpu));animation-timing-function:ease-out;}
      62%{transform:translate(34px,-50%) scale(var(--cpu));animation-timing-function:ease-in;}
      78%{transform:translate(0,-50%) scale(var(--cpu));animation-timing-function:ease-out;}
      89%{transform:translate(13px,-50%) scale(var(--cpu));animation-timing-function:ease-in;}
      100%{transform:translate(0,-50%) scale(var(--cpu));}}
    #rl-cpu .cpu-badge{position:absolute;top:-16px;left:18px;background:#e23333;color:#fff;
      font-weight:900;font-size:13px;letter-spacing:2px;padding:4px 13px;border-radius:999px;
      border:3px solid #000;box-shadow:0 3px 0 #000;}
    #rl-cpu .cpu-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:4px 0 11px;margin-bottom:10px;border-bottom:3px solid rgba(42,28,12,.22);}
    #rl-cpu .cpu-name{font-weight:900;font-size:22px;letter-spacing:.2px;color:#000;}
    #rl-cpu .cpu-tier{display:flex;flex-direction:column;align-items:flex-end;line-height:1.25;
      font-size:10px;font-weight:900;letter-spacing:1.3px;text-transform:uppercase;color:#9a6a25;}
    #rl-cpu .cpu-stars{font-size:16px;letter-spacing:1px;paint-order:stroke fill;margin-top:-3px;}
    #rl-cpu .cpu-stars .sf{color:#f6b21b;-webkit-text-stroke:.6px #000;}
    #rl-cpu .cpu-stars .se{color:rgba(42,28,12,.17);-webkit-text-stroke:0;}
    #rl-cpu .cpu-row{display:flex;align-items:center;gap:10px;margin:8px 0;}
    #rl-cpu .cpu-algo{flex:1;font-size:13px;font-weight:800;color:#3a2a14;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #rl-cpu .cpu-pips{flex:none;display:flex;gap:5px;}
    #rl-cpu .pip{width:14px;height:14px;border-radius:4px;border:2px solid #000;
      background:#e7d4a8;box-shadow:inset 0 -2px 0 rgba(0,0,0,.1);}
    #rl-cpu .pip.on{background:linear-gradient(180deg,#ff8a4d,#e8352b);}
    /* slim "pick your algorithms first" sign */
    #rl-gate{position:fixed;left:50%;bottom:10vh;z-index:64;display:flex;align-items:center;gap:9px;
      transform:translateX(-50%) translateY(22px) scale(.85);transform-origin:bottom center;
      background:linear-gradient(180deg,#ff5d4e 0%,#e22f22 100%);
      border:2.5px solid #3a1410;border-radius:13px;padding:8px 16px;
      box-shadow:0 3px 0 #3a1410,0 10px 20px rgba(0,0,0,.38);
      font-family:"Segoe UI",system-ui,sans-serif;font-weight:800;color:#fff;
      font-size:15px;line-height:1;letter-spacing:.2px;text-shadow:0 1px 2px rgba(0,0,0,.35);
      opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease;}
    #rl-gate.show{opacity:1;animation:rl-gate-pop .45s cubic-bezier(.34,1.6,.5,1) both;}
    @keyframes rl-gate-pop{0%{transform:translateX(-50%) translateY(22px) scale(.72);opacity:0;}
      55%{opacity:1;}100%{transform:translateX(-50%) translateY(0) scale(1);opacity:1;}}
    /* leaving: a small anticipation hop, then it falls away and shrinks out.
       per-keyframe easings (the animation itself is linear): the hop eases OUT,
       the drop eases IN, so it lifts softly and then accelerates off-screen */
    #rl-gate.hide{animation:rl-gate-out .42s linear both;}
    @keyframes rl-gate-out{
      0%{transform:translateX(-50%) translateY(0) scale(1);opacity:1;
        animation-timing-function:cubic-bezier(.2,.8,.35,1);}
      30%{transform:translateX(-50%) translateY(-7px) scale(1.05);opacity:1;
        animation-timing-function:cubic-bezier(.45,0,.75,.5);}
      100%{transform:translateX(-50%) translateY(26px) scale(.66);opacity:0;}}
    #rl-gate .gate-ico{flex:none;width:24px;height:24px;display:grid;place-items:center;border-radius:50%;
      background:radial-gradient(circle at 38% 32%,#ffe27a,#f6b21b);border:2px solid #3a1410;
      color:#3a1410;font-weight:900;font-size:15px;box-shadow:inset 0 -2px 0 rgba(0,0,0,.18);}
    #rl-select .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:28px 34px;}
    #rl-select .tile{width:96px;height:112px;cursor:pointer;position:relative;}
    #rl-select.open .tile{transform-origin:28% 72%;
      animation:rl-tile-pop .5s cubic-bezier(.34,1.56,.64,1) both;
      animation-delay:calc(0.15s + var(--i,0) * 45ms);}
    @keyframes rl-tile-pop{
      0%{transform:translate(-22px,22px) scale(.2) rotate(-12deg);opacity:0;}
      100%{transform:none;opacity:1;}}
    #rl-select .tile .pic{position:absolute;inset:0;background-size:contain;background-position:center;
      background-repeat:no-repeat;}
    /* 4 corner-bracket cursors on the selected tile, pulsing out and in */
    #rl-select .tile .cursor{position:absolute;inset:0;display:none;pointer-events:none;z-index:4;}
    #rl-select .tile.preview .cursor{display:block;}
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
  // one menu row: a dither-wipe layer, the mushroom, and the label (twice - a
  // black base + a white copy the confirm sweep reveals over it, L->R)
  const ITEM = (cls, attr, label) =>
    `<button class="item ${cls}" type="button" ${attr}>` +
    `<span class="wipe"></span>${CAP}` +
    `<span class="lblwrap"><span class="lbl">${label}</span>` +
    `<span class="lbl w" aria-hidden="true">${label}</span></span></button>`;

  const el = document.createElement("div");
  el.id = "rl-menu";
  el.innerHTML = `
    <div class="brand"><img src="./assets/ui/rival-minds-logo-2.png" alt="Rival Minds"></div>
    <div class="panel">
      <div class="items">
        ${ITEM("sel", 'data-go="1"', "Start")}
        ${ITEM("", 'data-algos="1"', "Algorithms")}
        ${ITEM("", 'data-open="1"', "Characters")}
        ${ITEM("", 'data-howto="1"', "How It Works?")}
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  // ---- character selector: a bottom panel with a Player 1 + Player 2 row, both
  // shown at once. Opened from the "Characters" menu item; the menu slides left.
  const selectEl = document.createElement("div");
  selectEl.id = "rl-select";
  selectEl.innerHTML =
    `<div class="rows">` +
    `<div class="side left"><div class="plab"><span class="ptxt">Player</span></div>` +
    `<div class="grid" data-side="-1"></div></div>` +
    `<div class="side right"><div class="plab cpu"><span class="ptxt">Computer</span></div>` +
    `<div class="grid" data-side="1"></div></div>` +
    `</div>` +
    `<div class="back"><span class="key">ESC</span><span class="txt">Back</span></div>`;
  document.body.appendChild(selectEl);

  // a row of tiles per side; each uses the character's icon + the 4 animated
  // corner-bracket cursors (shown on the selected tile)
  const CURSOR =
    `<div class="cursor">` +
    `<div class="cc tl"></div><div class="cc tr"></div>` +
    `<div class="cc bl"></div><div class="cc br"></div></div>`;
  const sideTiles = { "-1": [], 1: [] };
  // which character each chair currently shows. Hovering a tile previews that
  // character in the chair; leaving reverts to the locked pick. Deduped so the
  // same model isn't reloaded.
  const shownIdx = { "-1": null, 1: null };
  function showInChair(side, idx) {
    if (side === 1) renderCpuStats(idx); // the computer's stat sheet follows the preview
    if (shownIdx[side] === idx) return;
    shownIdx[side] = idx;
    seatCharacter(side, idx);
    // the cursor brackets follow whatever the chair is showing (the hover preview,
    // or the locked pick when not hovering) -> stays put across the inter-tile gaps
    sideTiles[side].forEach((t, i) => t.classList.toggle("preview", i === idx));
  }
  // the computer is a static, pre-trained opponent - show its difficulty + how
  // strong each of its 5 algorithms is (the player has to beat this)
  // the computer's stat sheet is its OWN fixed panel pinned to the right of the
  // screen (kept out of the selector layout), shown only while the selector is up
  const cpuStatsEl = document.createElement("div");
  cpuStatsEl.id = "rl-cpu";
  document.body.appendChild(cpuStatsEl);
  function renderCpuStats(idx) {
    const opp = OPPONENTS[idx];
    if (!cpuStatsEl || !opp) return;
    const stars =
      `<span class="sf">${"★".repeat(opp.tier)}</span>` +
      `<span class="se">${"☆".repeat(5 - opp.tier)}</span>`;
    cpuStatsEl.innerHTML =
      `<div class="cpu-badge">CPU</div>` +
      `<div class="cpu-head"><span class="cpu-name">${CHARACTERS[idx].name}</span>` +
      `<span class="cpu-tier"><span class="cpu-stars">${stars}</span>${opp.label}</span></div>` +
      opp.picks
        .map(
          ([algo, s]) =>
            `<div class="cpu-row"><span class="cpu-algo">${algo}</span>` +
            `<span class="cpu-pips">` +
            [1, 2, 3, 4, 5].map((n) => `<span class="pip${n <= s ? " on" : ""}"></span>`).join("") +
            `</span></div>`,
        )
        .join("");
  }
  for (const side of [-1, 1]) {
    const strip = selectEl.querySelector(`.grid[data-side="${side}"]`);
    // revert to the pick only when the mouse leaves the WHOLE grid, so crossing the
    // gaps between tiles doesn't briefly flip back to the selected character
    strip.addEventListener("mouseleave", () => showInChair(side, picks[side]));
    CHARACTERS.forEach((def, idx) => {
      const key = def.file.split("/")[0];
      const t = document.createElement("div");
      t.className = "tile";
      t.style.setProperty("--i", idx); // stagger index for the swing-in
      t.innerHTML =
        `<div class="pic" style="background-image:url(./assets/icons/${key}.png)"></div>` +
        CURSOR;
      t.addEventListener("mouseenter", () => showInChair(side, idx));
      t.addEventListener("click", () => {
        picks[side] = idx;
        savePicks();
        showInChair(side, idx);
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
    cpuStatsEl.classList.remove("show");
    cpuStatsEl.classList.add("leaving"); // fly the CPU card off to the right
    el.classList.remove("shift"); // bring the main menu back
    fallTitle(titleChars);
  }
  function openSelect() {
    if (starting) return;
    selectEl.classList.add("open");
    el.classList.add("shift"); // slide the main menu off to the left
    dropTitle(titleChars);
    refreshSelect();
    renderCpuStats(picks[1]); // computer stat sheet for the current opponent
    cpuStatsEl.classList.remove("leaving"); // clear any in-progress fly-out
    cpuStatsEl.classList.add("show");
  }

  // ===== "How It Works" + "Algorithms" info screens (Nintendo flash-card style) =====
  const screenCSS = document.createElement("style");
  screenCSS.textContent = `
    @font-face{font-family:"SuperMario256";
      src:url("./assets/fonts/SuperMario256.ttf") format("truetype");font-display:swap;}
    #rl-algos,#rl-howto{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:24px;padding:30px;box-sizing:border-box;
      overflow:hidden;opacity:0;pointer-events:none;}
    #rl-algos.open,#rl-howto.open{opacity:1;pointer-events:auto;}
    #rl-algos .scr-head{text-align:center;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.5);}
    #rl-algos .scr-title{font-size:34px;font-weight:900;letter-spacing:1px;}
    #rl-algos .scr-sub{font-size:15px;opacity:.85;margin-top:3px;}
    #rl-algos .arow{display:flex;gap:0;flex-wrap:nowrap;justify-content:center;
      transform-origin:center center;transform:translateY(7vh) scale(var(--card));transition:transform .25s ease;}
        /* ===== algorithm POSTCARDS (rounded, airmail frame, fanned deck) ===== */
    /* stationary hover anchor: the slot never moves, the card inside animates */
    .acard-slot{position:relative;display:flex;flex:none;width:340px;height:432px;perspective:1700px;z-index:calc(20 - var(--i,0));}
    .acard-slot:not(:first-child){margin-left:-85px;}
    .acard-flip{position:relative;flex:1;width:100%;height:100%;transform-style:preserve-3d;
      transform:rotate(var(--rot,0deg));transition:transform .5s cubic-bezier(.4,0,.2,1),opacity .4s ease;}
    .acard{position:absolute;inset:0;display:flex;flex-direction:column;box-sizing:border-box;border-radius:21px;overflow:hidden;
      backface-visibility:hidden;-webkit-backface-visibility:hidden;
      padding:9px;color:#5e564a;
      background:repeating-linear-gradient(45deg,var(--c) 0 14px,#fbf8f0 14px 28px);}
    .acard.pc-back{transform:rotateY(180deg);}
    /* retired family (DP: No.00): view-only + GREYED OUT (disabled look) but fully
       OPAQUE, not transparent. The red RETIRED stamp keeps its colour so it pops on
       the grey card. Its algorithm bands cannot be selected (blocked in the handler). */
    .acard-slot.disabled .pc-algo{cursor:default;}
    .acard-slot.disabled .pc-front > .pc-paper,
    .acard-slot.disabled .pc-front > .pc-postmark,
    .acard-slot.disabled .pc-front > .pc-stamp,
    .acard-slot.disabled .pc-back{filter:grayscale(1);}
    .pc-retired{position:absolute;top:53%;left:50%;z-index:7;pointer-events:none;
      transform:translate(-50%,-50%) rotate(-15deg);
      font-family:Georgia,"Times New Roman",serif;font-weight:900;font-size:33px;
      letter-spacing:5px;text-transform:uppercase;color:#b23528;
      padding:5px 16px 7px;border:3.5px solid #b23528;border-radius:9px;
      box-shadow:0 0 0 2px #b23528 inset;opacity:.66;mix-blend-mode:multiply;
      text-shadow:0 1px 0 rgba(255,255,255,.22);}
    #rl-algos .acard-slot.lift .acard-flip{animation:rl-card-pull .4s ease-in-out forwards;}
    #rl-algos .acard-slot.lower .acard-flip{animation:rl-card-return .4s ease-in-out forwards;}
    #rl-algos .acard-slot:first-child.lift .acard-flip{animation:rl-card-rise .35s ease-in-out forwards;}
    #rl-algos .acard-slot:first-child.lower .acard-flip{animation:rl-card-sink .35s ease-in-out forwards;}
    @keyframes rl-card-pull{
      0%{transform:translateX(0) translateY(0) rotate(var(--rot,0deg)) scale(1);}
      50%{transform:translateX(122px) translateY(-17px) rotate(0deg) scale(1.06);}
      100%{transform:translateX(0) translateY(-7px) rotate(0deg) scale(1.05);}}
    @keyframes rl-card-return{
      0%{transform:translateX(0) translateY(-7px) rotate(0deg) scale(1.05);}
      50%{transform:translateX(122px) translateY(-17px) rotate(0deg) scale(1.06);}
      100%{transform:translateX(0) translateY(0) rotate(var(--rot,0deg)) scale(1);}}
    @keyframes rl-card-rise{
      0%{transform:translateY(0) rotate(var(--rot,0deg)) scale(1);}
      100%{transform:translateY(-9px) rotate(0deg) scale(1.05);}}
    @keyframes rl-card-sink{
      0%{transform:translateY(-9px) rotate(0deg) scale(1.05);}
      100%{transform:translateY(0) rotate(var(--rot,0deg)) scale(1);}}
    .acard .pc-paper{position:relative;flex:1;width:100%;border-radius:13px;padding:0 0 20px;
      display:flex;flex-direction:column;
      background:repeating-linear-gradient(0deg,rgba(120,100,60,.045) 0 1px,transparent 1px 32px),#f6f1e4;}
    .acard .pc-head{display:flex;justify-content:flex-start;align-items:baseline;
      padding:12px 19px 7px;margin-bottom:13px;border-bottom:1.5px solid rgba(120,100,60,.3);}
    .acard .pc-series{font-size:13px;font-weight:800;letter-spacing:1.5px;color:#a99c80;
      text-transform:uppercase;}
    .acard .pc-stamp{position:absolute;top:21px;right:21px;z-index:5;width:66px;height:79px;
      display:grid;place-items:center;font-weight:900;font-size:22px;color:#fff;background:var(--c);
      border:3px solid #fbf8f0;outline:2px dashed rgba(255,255,255,.85);outline-offset:-4px;
      transform:rotate(6deg);box-shadow:0 3px 9px rgba(0,0,0,.24);}
    .acard .pc-postmark{position:absolute;top:calc(16px + var(--pmy,0px));right:calc(75px + var(--pmx,0px));z-index:4;width:62px;height:62px;
      border:2.5px solid rgba(55,48,40,.4);border-radius:50%;transform:rotate(calc(-14deg + var(--pmr,0deg)));
      display:grid;place-items:center;color:rgba(55,48,40,.5);}
    .acard .pc-postmark svg{width:37px;height:37px;}
    .acard .pc-name{padding:0 20px;font-family:Georgia,"Times New Roman",serif;font-weight:800;
      font-size:33px;line-height:1.03;color:#2c2722;letter-spacing:-.3px;padding-right:85px;
      min-height:2.06em;}
    .acard .pc-type{padding:0 20px;margin-top:12px;font-size:14px;font-weight:800;letter-spacing:2px;
      text-transform:uppercase;color:var(--c);}
    .acard .pc-tag{padding:0 20px;margin-top:17px;font-family:Georgia,serif;font-style:italic;
      font-size:21px;color:#4a443b;}
    .acard .pc-msg{padding:0 20px;margin:14px 0 0;font-size:16.5px;line-height:1.5;flex:1;}
    .acard .pc-rule{margin:16px 20px 13px;height:0;border-top:1.5px dashed rgba(120,100,60,.42);}
    .acard .pc-good{padding:0 20px;font-size:16px;line-height:1.5;}
    .acard .pc-good-lbl{display:block;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;
      font-size:13px;color:var(--c);margin-bottom:5px;}
    .acard .pc-good-names{display:block;white-space:nowrap;font-size:13.5px;letter-spacing:-.1px;}
    /* --- drill-in: click a type -> centre + flip, neighbours clear off --- */
    #rl-algos.drilled .acard-slot{cursor:default;}
    .acard-slot.expanded{z-index:90;}
    .acard-slot.expanded .acard-flip{transform:translate(var(--dx,0px),var(--dy,0px)) scale(1.16) rotateY(180deg);}
    /* neighbours slide fully off-screen (no fade) when a card is opened; the
       distance is divided by --card so they clear the edge at any deck scale. */
    .acard-slot.off-left .acard-flip{transform:translateX(calc(-90vw / var(--card))) rotate(-7deg);}
    .acard-slot.off-right .acard-flip{transform:translateX(calc(90vw / var(--card))) rotate(7deg);}
    .acard-slot.off-left,.acard-slot.off-right{pointer-events:none;}
    .acard-flip{cursor:pointer;}
    /* --- back face: algorithm pick-list --- */
    .acard .pc-back-paper{padding:0;border-radius:13px;overflow:hidden;}
    /* bold coloured header banner with a title + subtitle */
    .acard .pc-back-head{display:flex;flex-direction:column;gap:4px;padding:16px 18px;
      background:linear-gradient(135deg,color-mix(in srgb,var(--c) 86%,#000) 0%,var(--c) 100%);color:#fff;}
    .acard .pc-back-htext{display:flex;flex-direction:column;gap:3px;min-width:0;}
    .acard .pc-back-title{font-family:Georgia,"Times New Roman",serif;font-weight:800;
      font-size:24px;line-height:1;color:#fff;letter-spacing:-.2px;}
    .acard .pc-back-sub{font-size:11px;font-weight:800;letter-spacing:1.7px;text-transform:uppercase;color:rgba(255,255,255,.85);}
    /* the algorithms fill the whole card as full-width paper bands, divided by
       ragged "tear here" rip lines (the SVG zig-zag is generated in JS) */
    .acard .pc-algos{display:flex;flex-direction:column;flex:1;padding:0;}
    .acard .pc-back-foot{padding:6px 16px 13px;font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#a99c80;text-align:center;}
    .acard .pc-algo{flex:1;display:flex;flex-direction:row;align-items:center;gap:16px;
      width:100%;box-sizing:border-box;text-align:left;font:inherit;color:inherit;cursor:pointer;position:relative;
      border:none;padding:12px 20px;background:transparent;}
    /* the "you picked this" tint - torn to the rip lines, sits behind the text */
    .acard .pc-sel-tint{position:absolute;left:0;right:0;z-index:0;pointer-events:none;}
    .acard .pc-algo-no{flex:none;min-width:46px;text-align:center;position:relative;z-index:1;font-family:Georgia,serif;font-weight:800;
      font-size:46px;line-height:.9;color:var(--c);opacity:.4;}
    .acard .pc-algo-txt{display:flex;flex-direction:column;gap:4px;min-width:0;position:relative;z-index:1;}
    .acard .pc-algo-name{font-weight:900;font-size:18px;color:#2c2722;letter-spacing:-.2px;}
    .acard .pc-algo-blurb{font-size:12.5px;line-height:1.4;color:#6a6253;}
    .acard .pc-rip{position:relative;flex:none;height:12px;margin:0;line-height:0;pointer-events:none;}
    .acard .pc-rip svg{display:block;width:100%;height:12px;}
    /* a torn-off chunk of the card, flying during the rip animation */
    .rl-tear-piece{overflow:visible;will-change:transform;}
    #rl-howto .howto-wrap{transform:scale(calc(var(--ui) * 1.12));transform-origin:center center;}
    /* the animated flex row: presenter + panel slide in together */
    #rl-howto .howto-card{display:flex;align-items:center;justify-content:center;}
    /* ---- presenter: Cappy, free-floating and hovering on the left ---- */
    #rl-howto .hw-mascot{flex:none;width:248px;height:296px;margin-right:-36px;z-index:3;
      background-position:center;background-repeat:no-repeat;background-size:contain;
      filter:drop-shadow(0 16px 11px rgba(0,0,0,.32));}
    /* NOTE: the fly-in arc + hover are driven from JS (cappyTick), in lockstep with the 3D
       render, so the canvas position can never get out of sync with what's drawn - no CSS
       animation here on purpose. */
    /* ---- main panel ---- */
    #rl-howto .hw-panel{position:relative;width:min(720px,88vw);min-height:392px;box-sizing:border-box;
      background:#fffdf6;border:4px solid #000;border-radius:22px;padding:26px 30px 18px;
      color:#000;font-family:"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;
      box-shadow:2px 2px 0 #000,4px 4px 0 #000,6px 6px 0 #000,8px 8px 0 #000,
        9px 11px 0 #000,9px 22px 34px rgba(0,0,0,.45);}
    /* ---- tilted step banner ---- */
    #rl-howto .hw-banner{align-self:flex-start;display:inline-flex;align-items:baseline;gap:11px;
      background:linear-gradient(180deg,#8a6bff,#5b3df2);color:#fff;border:3px solid #000;
      border-radius:11px;padding:8px 17px 9px;transform:rotate(-2.2deg);box-shadow:0 4px 0 #000;
      margin:-2px 0 14px;font-family:"SuperMario256","Arial Black",sans-serif;}
    #rl-howto .hw-step{font-size:22px;letter-spacing:1px;color:#d9ccff;}
    #rl-howto .hw-title{font-size:22px;letter-spacing:1.5px;text-transform:uppercase;
      -webkit-text-stroke:.6px #000;paint-order:stroke fill;}
    /* ---- paragraph (clean + readable) ---- */
    #rl-howto .hw-para{font-family:"Segoe UI",system-ui,sans-serif;
      font-size:17.5px;line-height:1.5;color:#33240f;margin:0 0 6px;font-weight:600;}
    /* ---- illustration stage + marker annotations ---- */
    #rl-howto .hw-stage{position:relative;flex:1;display:flex;align-items:center;justify-content:center;
      padding-top:30px;min-height:150px;width:min(100%,440px);align-self:center;}
    #rl-howto .hw-anno{position:absolute;top:-2px;width:150px;display:flex;flex-direction:column;
      align-items:center;gap:1px;font-family:"Segoe Print","Bradley Hand","Ink Free","Comic Sans MS",cursive;
      color:#6a3df0;font-weight:700;font-size:15px;line-height:1.14;text-align:center;
      letter-spacing:.2px;text-transform:uppercase;pointer-events:none;}
    #rl-howto .hw-anno.tl{left:2px;}
    #rl-howto .hw-anno.tr{right:2px;}
    /* tighter placement for narrow illustrations - pulls the callouts in next to the content */
    #rl-howto .hw-anno.tight{top:34px;}
    #rl-howto .hw-anno.tight.tl{left:calc(50% - 172px);}
    #rl-howto .hw-anno.tight.tr{right:calc(50% - 172px);}
    #rl-howto .hw-arrow{width:50px;height:36px;stroke:#6a3df0;fill:none;stroke-width:3.4;}
    #rl-howto .hw-anno.tr .hw-arrow{transform:scaleX(-1);}
    /* ---- nav: dots + prev/next ---- */
    #rl-howto .hw-nav{display:flex;align-items:center;gap:12px;margin-top:auto;padding-top:12px;
      border-top:2px solid rgba(42,28,12,.12);}
    #rl-howto .hw-dots{display:flex;gap:7px;}
    #rl-howto .hw-dot{width:10px;height:10px;border-radius:50%;background:#e7d9ba;border:2px solid #000;}
    #rl-howto .hw-dot.on{background:#5b3df2;}
    #rl-howto .hw-prev,#rl-howto .hw-next{cursor:pointer;font-weight:900;font-size:13.5px;letter-spacing:1px;
      text-transform:uppercase;border:3px solid #000;border-radius:11px;padding:8px 16px;
      box-shadow:0 3px 0 #000;font-family:"Segoe UI",system-ui,sans-serif;}
    #rl-howto .hw-next{margin-left:auto;background:#000;color:#fff;}
    #rl-howto .hw-prev{background:#fff3d6;color:#000;}
    #rl-howto .hw-prev[hidden]{display:none;}
    #rl-howto .hw-next:active,#rl-howto .hw-prev:active{transform:translateY(2px);box-shadow:0 1px 0 #000;}
    /* ---- page-1: algorithm family chips ---- */
    #rl-howto .hw-chips{display:flex;gap:9px;}
    #rl-howto .hw-chip{display:flex;flex-direction:column;align-items:center;gap:4px;width:64px;
      background:#fffaf0;border:2.5px solid #000;border-radius:12px;padding:9px 4px;box-shadow:0 3px 0 #000;}
    #rl-howto .hw-chip .ci{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;
      font-size:17px;color:#fff;font-weight:900;border:2px solid #000;}
    #rl-howto .hw-chip .ci svg{width:20px;height:20px;}
    #rl-howto .hw-chip b{font-size:11px;color:#000;}
    /* ---- page-2: opponent ladder ---- */
    #rl-howto .hw-ladder{display:flex;align-items:flex-end;gap:16px;}
    #rl-howto .hw-opp{display:flex;flex-direction:column;align-items:center;gap:5px;}
    #rl-howto .hw-opp .oa{width:52px;height:52px;border-radius:50%;border:3px solid #000;
      background-color:#fffaf0;background-size:cover;background-position:center;box-shadow:0 3px 0 #000;}
    #rl-howto .hw-opp:nth-child(2) .oa{width:60px;height:60px;}
    #rl-howto .hw-opp:nth-child(3) .oa{width:70px;height:70px;}
    #rl-howto .hw-opp .ostars{font-size:12px;color:#f6b21b;-webkit-text-stroke:.4px #000;letter-spacing:1px;}
    /* ---- page-3: VS arena ---- */
    #rl-howto .vs-arena{position:relative;display:flex;align-items:stretch;justify-content:center;
      width:330px;border:3px solid #000;border-radius:16px;overflow:hidden;
      background:linear-gradient(100deg,#d9e3ff 0 46%,#f6ead0 46% 54%,#ffdfda 54% 100%);
      box-shadow:inset 0 3px 0 rgba(255,255,255,.45),inset 0 -5px 0 rgba(0,0,0,.07);}
    #rl-howto .vs-fighter{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:13px 10px;}
    #rl-howto .vs-ava{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;
      font-size:27px;border:3px solid #000;box-shadow:0 4px 0 #000;}
    #rl-howto .vs-fighter.blue .vs-ava{background:radial-gradient(circle at 38% 30%,#7e9dff,#2348c0);}
    #rl-howto .vs-fighter.red .vs-ava{background:radial-gradient(circle at 38% 30%,#ff7164,#b81f1f);}
    #rl-howto .vs-name{font-weight:900;font-size:16px;letter-spacing:1px;}
    #rl-howto .vs-fighter.blue .vs-name{color:#2348c0;}
    #rl-howto .vs-fighter.red .vs-name{color:#b81f1f;}
    #rl-howto .vs-tag{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#7b6240;}
    #rl-howto .vs-clash{flex:none;width:0;display:flex;align-items:center;justify-content:center;z-index:2;}
    #rl-howto .vs-word{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;
      background:#000;color:#fff;font-weight:900;font-size:17px;font-style:italic;letter-spacing:1px;
      box-shadow:0 0 0 4px #fffdf6,0 0 0 7px #000,0 5px 0 rgba(0,0,0,.3);transform:rotate(-9deg);}
    /* ---- page-4: champion podium ---- */
    #rl-howto .hw-podium{display:flex;align-items:flex-end;gap:8px;}
    #rl-howto .pod{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
      border:2.5px solid #000;border-radius:9px 9px 0 0;box-shadow:0 3px 0 #000;color:#3a2a14;font-weight:900;}
    #rl-howto .pod .pn{font-size:19px;padding-bottom:4px;}
    #rl-howto .pod.p1{width:82px;height:96px;background:linear-gradient(180deg,#ffdc5c,#f6b21b);}
    #rl-howto .pod.p2{width:66px;height:66px;background:linear-gradient(180deg,#eef1f6,#bcc6d4);}
    #rl-howto .pod.p3{width:66px;height:48px;background:linear-gradient(180deg,#f3b483,#cd7f32);}
    #rl-howto .pod .ptrophy{position:absolute;top:-46px;font-size:48px;filter:drop-shadow(0 4px 0 rgba(0,0,0,.2));}
    /* TEMP placeholder box for pages whose visual isn't built yet */
    #rl-howto .hw-ph{display:grid;place-items:center;width:300px;height:118px;box-sizing:border-box;
      border:3px dashed rgba(0,0,0,.3);border-radius:16px;background:rgba(0,0,0,.035);
      color:rgba(0,0,0,.42);font-weight:800;font-size:15px;letter-spacing:2px;text-transform:uppercase;}
    /* "Face off" stage: the 4 round boards fanned in a stack - R2 + R3 prominent in
       front, R1 + R4 dimmed behind the top corners (art in game/assets/arenas/) */
    #rl-howto .hw-arenas{position:absolute;inset:0;pointer-events:none;}
    #rl-howto .hw-arenas .ar{position:absolute;left:50%;top:50%;width:33%;border-radius:5px;transform-origin:center;}
    #rl-howto .hw-arenas .a1{transform:translate(-116%,-62%) rotate(-15deg) scale(.64);z-index:1;filter:brightness(.63) drop-shadow(0 4px 7px rgba(0,0,0,.5));}
    #rl-howto .hw-arenas .a4{transform:translate(16%,-62%) rotate(15deg) scale(.64);z-index:2;filter:brightness(.63) drop-shadow(0 4px 7px rgba(0,0,0,.5));}
    #rl-howto .hw-arenas .a3{transform:translate(-72%,-44%) rotate(-6deg) scale(1);z-index:3;filter:drop-shadow(0 8px 12px rgba(0,0,0,.45));}
    #rl-howto .hw-arenas .a2{transform:translate(-28%,-42%) rotate(6deg) scale(1.04);z-index:4;filter:drop-shadow(0 9px 14px rgba(0,0,0,.45));}
    /* "Take the crown" stage: the wide head-to-head scoreboard banner. It's
       allowed to spill past the 440px stage and use the wider panel. */
    #rl-howto .hw-versus{width:min(600px,86vw);max-width:none;height:auto;filter:drop-shadow(0 6px 12px rgba(0,0,0,.28));}
    #rl-scr-back{position:fixed;left:1.5vw;bottom:3vh;z-index:63;display:flex;align-items:center;
      gap:11px;cursor:pointer;color:#fff;pointer-events:none;
      transform:translateY(220%);transition:transform .45s cubic-bezier(.4,0,.2,1);}
    #rl-scr-back.show{transform:translateY(0);pointer-events:auto;}
    #rl-scr-back .key{display:inline-flex;align-items:center;justify-content:center;width:40px;
      height:38px;border-radius:9px;background:#fff;color:#222;font-weight:800;font-size:13px;
      letter-spacing:.5px;box-shadow:0 3px 12px rgba(0,0,0,.5);}
    #rl-scr-back .txt{font-weight:800;font-size:21px;text-shadow:0 2px 12px rgba(0,0,0,.75);}
    #rl-scr-back:hover{opacity:.85;}
    /* cards fly IN/OUT with NO fade. Distances are divided by the deck/UI scale so
       they start & end fully off-screen at any size (no opacity needed to hide). */
    @keyframes rl-deal-in{0%{transform:translateX(calc(118vw / var(--card))) rotate(var(--rot,0deg)) scale(.96);}
      100%{transform:translateX(0) rotate(var(--rot,0deg)) scale(1);}}
    @keyframes rl-deal-out{0%{transform:translateX(0) rotate(var(--rot,0deg));}
      100%{transform:translateX(calc(-118vw / var(--card))) rotate(var(--rot,0deg));}}
    #rl-algos.dealing .acard-flip{animation:rl-deal-in .55s cubic-bezier(.3,1.25,.5,1) backwards;
      animation-delay:calc(var(--i,0) * .09s);}
    #rl-algos.closing .acard-flip{animation:rl-deal-out .45s cubic-bezier(.5,0,.9,.35) forwards;
      animation-delay:calc(var(--i,0) * .05s);}
    @keyframes rl-howto-in{0%{transform:translateX(calc(118vw / var(--ui))) scale(.96);}
      100%{transform:translateX(0) scale(1);}}
    #rl-howto.open .hw-panel{animation:rl-howto-in .55s cubic-bezier(.3,1.25,.5,1) backwards;}
    /* on close: throw the panel back out to the right (mirror of the entry) */
    @keyframes rl-howto-out{0%{transform:translateX(0) scale(1);}
      100%{transform:translateX(calc(118vw / var(--ui))) scale(.94);}}
    #rl-howto.closing .hw-panel{animation:rl-howto-out .5s cubic-bezier(.5,0,.85,.3) forwards;}
    .big-title{position:fixed;top:11vh;left:0;right:0;text-align:center;z-index:62;pointer-events:none;
      font-family:"SuperMario256","Arial Black",sans-serif;font-weight:normal;
      font-size:calc(96px * var(--ui));color:#fff;
      -webkit-text-stroke:max(3px,calc(7px * var(--ui))) #1f1f1f;paint-order:stroke fill;
      /* diagonal 3D extrusion - stacked dark copies down-and-right, same look as the CPU card */
      text-shadow:calc(1px * var(--ui)) calc(1px * var(--ui)) 0 #1f1f1f,
        calc(2px * var(--ui)) calc(2px * var(--ui)) 0 #1f1f1f,
        calc(3px * var(--ui)) calc(3px * var(--ui)) 0 #1f1f1f,
        calc(4px * var(--ui)) calc(4px * var(--ui)) 0 #1f1f1f,
        calc(5px * var(--ui)) calc(5px * var(--ui)) 0 #1f1f1f,
        calc(6px * var(--ui)) calc(6px * var(--ui)) 0 #1f1f1f,
        calc(7px * var(--ui)) calc(7px * var(--ui)) 0 #1f1f1f,
        calc(8px * var(--ui)) calc(8px * var(--ui)) 0 #1f1f1f,
        calc(9px * var(--ui)) calc(12px * var(--ui)) calc(10px * var(--ui)) rgba(0,0,0,.4);
      transform:translateY(calc(-100% - 13vh));}
    .big-title.show{animation:rl-title-drop .9s .1s both;}
    @keyframes rl-title-drop{
      0%{transform:translateY(calc(-100% - 13vh)) rotate(3deg);animation-timing-function:cubic-bezier(.55,.02,.9,.26);}
      44%{transform:translateY(0) rotate(-7deg);animation-timing-function:ease-out;}
      62%{transform:translateY(-54px) rotate(0deg);animation-timing-function:ease-in;}
      78%{transform:translateY(0) rotate(-5deg);animation-timing-function:ease-out;}
      89%{transform:translateY(-22px) rotate(-2deg);animation-timing-function:ease-in;}
      100%{transform:translateY(0) rotate(-3deg);}}
    .big-title.fall{animation:rl-title-fall .6s cubic-bezier(.5,0,.9,.3) forwards;}
    @keyframes rl-title-fall{0%{transform:translateY(0) rotate(-3deg);}
      100%{transform:translateY(120vh) rotate(11deg);}}`;
  document.head.appendChild(screenCSS);

  const TYPES = [
    {
      key: "dp",
      badge: "DP",
      series: "01",
      name: "Dynamic Programming",
      type: "Model-known / Planning",
      color: "#f59e0b",
      tag: '"The all-knowing planner"',
      desc: "Given the full map, it plans the optimal route by iterating - the faster it converges, the sooner it beelines to the goal.",
      algos: [
        {
          name: "Value Iteration",
          blurb: "Bellman optimality sweeps until V converges.",
        },
        {
          name: "Policy Iteration",
          blurb: "Evaluate, improve, repeat until the policy is stable.",
        },
      ],
    },
    {
      key: "mc",
      badge: "MC",
      series: "02",
      name: "Monte Carlo",
      type: "Model-free / Episodic",
      color: "#a855f7",
      tag: '"The patient gambler"',
      desc: "Plays whole episodes out to the end, then learns from the real final score - no model, no mid-game guessing.",
      algos: [
        {
          name: "Every-visit MC",
          blurb: "Averages returns from EVERY visit to a state-action.",
        },
        {
          name: "First-visit MC",
          blurb: "Uses only the FIRST visit to each state per episode.",
        },
      ],
    },
    {
      key: "td",
      badge: "TD",
      series: "03",
      name: "Temporal Difference",
      type: "Model-free / Bootstrapping",
      color: "#22c55e",
      tag: '"Learns on every step"',
      desc: "Updates its estimates from the very next step instead of waiting for the episode to end - the bridge between MC and DP.",
      algos: [
        {
          name: "SARSA",
          blurb: "On-policy: learns the path it actually walks.",
        },
        {
          name: "Q-Learning",
          blurb: "Off-policy: always learns the value of the best move.",
        },
        {
          name: "Expected-SARSA",
          blurb: "Averages over next actions - same idea, lower variance.",
        },
      ],
    },
    {
      key: "deep",
      badge: "DRL",
      series: "04",
      name: "Deep Value Based",
      type: "Function Approximation",
      color: "#ef4444",
      tag: '"Q-Learning, supersized"',
      desc: "Swaps the lookup table for a neural network so value-based RL can scale to huge or pixel-based worlds.",
      algos: [
        {
          name: "DQN",
          blurb: "Neural Q with experience replay + a target network.",
        },
        {
          name: "Double-DQN",
          blurb: "Decouples the action pick from its value - less overestimation.",
        },
        {
          name: "Dueling-DQN",
          blurb: "Splits the head into state-value + advantage streams.",
        },
      ],
    },
    {
      key: "pg",
      badge: "PG",
      series: "05",
      name: "Policy Gradient",
      type: "Policy-based",
      color: "#3b82f6",
      tag: '"Tunes the policy itself"',
      desc: "Skips value tables and nudges the policy's own parameters directly toward higher expected return.",
      algos: [
        {
          name: "REINFORCE",
          blurb: "The basic policy gradient - simple, but high variance.",
        },
        {
          name: "Actor-Critic",
          blurb: "An actor acts while a critic judges via the advantage.",
        },
        {
          name: "PPO",
          blurb: "Clipped, stable policy steps. The modern workhorse.",
        },
      ],
    },
  ];
  const PMICONS = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><g fill="currentColor" stroke="none"><circle cx="8" cy="8" r="1.4"/><circle cx="16" cy="8" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="8" cy="16" r="1.4"/><circle cx="16" cy="16" r="1.4"/></g></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.4 2.2"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="6" y1="6" x2="12.5" y2="12"/><line x1="6" y1="18" x2="12.5" y2="12"/><line x1="12.5" y1="12" x2="19" y2="12"/><circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="12.5" cy="12" r="2.3"/><circle cx="19" cy="12" r="2.3"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16.5l5.5-5.5 3.5 3.5 8.5-8.5"/><path d="M20.5 6v5M20.5 6h-5"/></svg>',
  ];
  const algosEl = document.createElement("div");
  algosEl.id = "rl-algos";
  algosEl.innerHTML =
    `<div class="arow">` +
    TYPES.map(
      (t, i) =>
        `<div class="acard-slot${t.disabled ? ' disabled' : ''}" style="--c:${t.disabled ? "#9a958c" : t.color};--i:${i};--rot:${[-3, 2, -2.5, 2.5, -2, 3][i] ?? 0}deg;--pmx:${[0, -7, 6, -5, 9, -4][i] ?? 0}px;--pmy:${[0, 6, 4, 9, 3, 7][i] ?? 0}px;--pmr:${[0, 10, -12, 6, -8, 11][i] ?? 0}deg">` +
        `<div class="acard-flip">` +
        `<div class="acard pc-front">` +
        `<span class="pc-postmark">${PMICONS[i] ?? ""}</span>` +
        `<div class="pc-stamp">${t.badge}</div>` +
        (t.disabled ? `<div class="pc-retired">Retired</div>` : "") +
        `<div class="pc-paper">` +
        `<div class="pc-head"><span class="pc-series">No.${t.series}</span></div>` +
        `<div class="pc-name">${t.name}</div>` +
        `<div class="pc-type">${t.type}</div>` +
        `<div class="pc-tag">${t.tag}</div>` +
        `<p class="pc-msg">${t.desc}</p>` +
        `<div class="pc-rule"></div>` +
        `<div class="pc-good"><span class="pc-good-lbl">Inside</span><span class="pc-good-names">${t.algos.map((x) => x.name).join(" &middot; ")}</span></div>` +
        `</div></div>` +
        `<div class="acard pc-back">` +
        `<div class="pc-paper pc-back-paper">` +
        `<div class="pc-back-head">` +
        `<span class="pc-back-htext"><span class="pc-back-title">${t.name}</span><span class="pc-back-sub">${t.type}</span></span></div>` +
        `<div class="pc-algos">` +
        t.algos
          .map(
            (x, k) =>
              (k ? `<div class="pc-rip"></div>` : ``) +
              `<button class="pc-algo"><span class="pc-algo-no">${k + 1}</span>` +
              `<span class="pc-algo-txt"><span class="pc-algo-name">${x.name}</span><span class="pc-algo-blurb">${x.blurb}</span></span>` +
              `</button>`,
          )
          .join("") +
        `</div>` +
        `</div></div>` +
        `</div></div>`,
    ).join("") +
    `</div>`;
  document.body.appendChild(algosEl);
  // draw a ragged "tear here" line into every rip divider (full card width)
  algosEl.querySelectorAll(".pc-rip").forEach((rip) => {
    const W = 240,
      mid = 6,
      segs = 16;
    let d = "M0 " + mid;
    const zig = [[0, mid]]; // remembered so the selection tint can tear along the same line
    for (let i = 1; i <= segs; i++) {
      const x = (W / segs) * i;
      const y =
        mid +
        (Math.random() * 2 - 1) * 3 +
        (Math.random() < 0.22 ? (Math.random() * 2 - 1) * 4 : 0);
      d += " L" + x.toFixed(1) + " " + y.toFixed(1);
      zig.push([x, y]);
    }
    rip._zig = zig;
    rip.innerHTML =
      '<svg viewBox="0 0 ' +
      W +
      ' 12" preserveAspectRatio="none">' +
      '<path d="' +
      d +
      '" fill="none" stroke="rgba(120,100,60,.5)" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="' +
      d +
      '" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1" stroke-linejoin="round" transform="translate(0,1.4)"/>' +
      "</svg>";
  });
  const algoSlots = [...algosEl.querySelectorAll(".acard-slot")];
  let upCard = null; // the card brought to the top (null = in the stack)
  let flipped = false; // upCard card is centred + flipped to its algorithms
  let busy = false; // an animation is mid-flight
  let animTimer = 0;
  let pending = null; // a card queued to come up once the current animation ends

  function runPending() {
    if (!pending || busy) return;
    if (upCard) {
      lowerCard(upCard);
      return;
    }
    const p = pending;
    pending = null;
    liftCard(p);
  }
  function liftCard(slot) {
    busy = true;
    upCard = slot;
    slot.classList.remove("lower");
    slot.classList.add("lift");
    clearTimeout(slot._z);
    slot._z = setTimeout(() => {
      slot.style.zIndex = "50";
    }, 160);
    clearTimeout(animTimer);
    animTimer = setTimeout(() => {
      busy = false;
      runPending();
    }, 400);
  }
  function lowerCard(slot) {
    busy = true;
    if (upCard === slot) upCard = null;
    slot.classList.remove("lift");
    slot.classList.add("lower");
    clearTimeout(slot._z);
    slot._z = setTimeout(() => {
      slot.style.zIndex = "";
    }, 200);
    clearTimeout(animTimer);
    animTimer = setTimeout(() => {
      slot.classList.remove("lower");
      busy = false;
      runPending();
    }, 400);
  }
  // second click: centre the card + flip it to its algorithms, sweep the neighbours off
  function flipCard(slot) {
    flipped = true;
    paintSelection(slot); // show the current pick (if any) on this card's back
    const flip = slot.querySelector(".acard-flip");
    const arow = algosEl.querySelector(".arow");
    // the deck (.arow) may be scaled down on small screens; the slot's transforms
    // live inside that scaled space, so convert viewport offsets back into it.
    let ds = 1;
    try {
      ds = new DOMMatrixReadOnly(getComputedStyle(arow).transform).a || 1;
    } catch (e) {
      ds = 1;
    }
    const r = slot.getBoundingClientRect();
    const winW = window.innerWidth,
      winH = window.innerHeight;
    // the card opens centred, but must clear the title at the top. Measure the
    // title's bottom edge and only push the card down if it would overlap it.
    let titleBottom = winH * 0.06;
    try {
      const tr = titleAlgos.getBoundingClientRect();
      if (tr.bottom > 0) titleBottom = tr.bottom + winH * 0.02;
    } catch (e) {
      /* title not measured yet */
    }
    const bandBottom = winH - winH * 0.04;
    // size to fit the band below the title, capped at a readable absolute scale
    const fit = Math.min(
      1.16,
      (winW * 0.92) / 340,
      (bandBottom - titleBottom) / 432,
    );
    const cardH = 432 * fit;
    // keep it vertically centred; nudge down only if it would touch the title
    let targetY = winH / 2;
    if (targetY - cardH / 2 < titleBottom) targetY = titleBottom + cardH / 2;
    const targetX = winW / 2;
    const dx = Math.round((targetX - (r.left + r.width / 2)) / ds);
    const dy = Math.round((targetY - (r.top + r.height / 2)) / ds);
    const scale = +(fit / ds).toFixed(3);
    const cur = getComputedStyle(flip).transform;
    flip.style.transform = cur && cur !== "none" ? cur : "";
    const idx = algoSlots.indexOf(slot);
    algoSlots.forEach((s, i) => {
      s.classList.remove("lift", "lower");
      if (s !== slot) s.classList.add(i < idx ? "off-left" : "off-right");
    });
    algosEl.classList.add("drilled");
    slot.classList.add("expanded");
    void flip.offsetWidth; // commit the frozen start value
    flip.style.transform =
      "translate(" +
      dx +
      "px," +
      dy +
      "px) scale(" +
      scale +
      ") rotateY(180deg)";
  }
  function unflip() {
    const slot = upCard;
    flipped = false;
    upCard = null;
    algoSlots.forEach((s) =>
      s.classList.remove("expanded", "off-left", "off-right", "lift", "lower"),
    );
    algosEl.classList.remove("drilled");
    if (slot) {
      const flip = slot.querySelector(".acard-flip");
      if (flip) flip.style.transform = "";
      slot.style.zIndex = "";
    }
  }
  function goBack() {
    pending = null;
    if (flipped) unflip();
    else if (upCard && !busy) lowerCard(upCard);
  }
  // ---- pick an algorithm: actually TEAR the card along the ragged rip lines
  // above & below the chosen band. The torn-off chunks peel away and fall, the
  // chosen algorithm lifts to the centre and stays, then the deck re-deals. ---
  function ripSelectReset() {
    document.querySelectorAll(".rl-tear-piece").forEach((p) => p.remove());
    algoSlots.forEach((s) => {
      s.getAnimations().forEach((a) => a.cancel());
      const f = s.querySelector(".acard-flip");
      if (f) {
        f.getAnimations().forEach((a) => a.cancel());
        f.style.transition = "none";
        f.style.transform = "";
        f.style.visibility = "";
      }
      s.classList.remove("expanded", "off-left", "off-right", "lift", "lower");
      s.style.zIndex = "";
      s.style.transform = "";
    });
    algosEl.classList.remove("drilled");
    void algosEl.offsetWidth; // commit the instant reset before re-dealing
    algoSlots.forEach((s) => {
      const f = s.querySelector(".acard-flip");
      if (f) f.style.transition = "";
    });
    flipped = false;
    upCard = null;
    algosEl.classList.add("dealing"); // fly all five cards back in
    const dtok = ++algosDealTok;
    setTimeout(() => {
      if (dtok === algosDealTok) algosEl.classList.remove("dealing");
    }, 1100);
    busy = false;
  }
  // persist the player's algorithm picks (one per family) so the game knows what
  // they chose to play with. Stored as { typeKey: algoName } under "rl-algos".
  function readAlgoChoices() {
    try {
      const o = JSON.parse(localStorage.getItem("rl-algos") || "{}");
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  function saveAlgoChoice(type, algo) {
    const o = readAlgoChoices();
    o[type.key] = algo.name;
    try {
      localStorage.setItem("rl-algos", JSON.stringify(o));
    } catch {
      /* ignore */
    }
  }
  // paint the current selection on a card's back: tint the chosen algorithm's
  // band, torn to the rip lines above & below it (not a rectangle).
  function paintSelection(slot) {
    const type = TYPES[algoSlots.indexOf(slot)];
    const back = slot && slot.querySelector(".acard.pc-back");
    if (!type || !back) return;
    const chosen = readAlgoChoices()[type.key];
    back.querySelectorAll(".pc-algo").forEach((band, i) => {
      const old = band.querySelector(".pc-sel-tint");
      if (old) old.remove();
      if (!chosen || !type.algos[i] || type.algos[i].name !== chosen) return;
      const h = band.offsetHeight || 70;
      const prev = band.previousElementSibling;
      const next = band.nextElementSibling;
      const pz = prev && prev.classList.contains("pc-rip") ? prev._zig : null;
      const nz = next && next.classList.contains("pc-rip") ? next._zig : null;
      const top = pz
        ? pz.map(
            ([x, y]) => `${((x / 240) * 100).toFixed(2)}% ${y.toFixed(1)}px`,
          )
        : ["0% 12px", "100% 12px"];
      const bot = nz
        ? nz
            .slice()
            .reverse()
            .map(
              ([x, y]) =>
                `${((x / 240) * 100).toFixed(2)}% ${(h + 12 + y).toFixed(1)}px`,
            )
        : [`100% ${h + 12}px`, `0% ${h + 12}px`];
      const poly = "polygon(" + [...top, ...bot].join(",") + ")";
      const tint = document.createElement("span");
      tint.className = "pc-sel-tint";
      tint.style.cssText =
        `top:-12px;bottom:-12px;background:color-mix(in srgb,${type.color} 26%,transparent);` +
        `clip-path:${poly};-webkit-clip-path:${poly};`;
      band.insertBefore(tint, band.firstChild);
    });
  }
  async function ripSelect(ticketEl) {
    const slot = upCard;
    if (!slot || busy) return;
    busy = true;
    flipped = false;
    const flip = slot.querySelector(".acard-flip");
    const srcCard = slot.querySelector(".acard.pc-back");
    if (!srcCard) {
      busy = false;
      return;
    }
    const winW = window.innerWidth,
      winH = window.innerHeight;
    const W = 340,
      H = 432; // the unscaled .acard size

    const cardR = srcCard.getBoundingClientRect();
    const bandR = ticketEl.getBoundingClientRect();
    const ts = cardR.width / W; // how much the card is scaled on screen
    const cardColor =
      getComputedStyle(slot).getPropertyValue("--c").trim() || "#f59e0b";

    // which algorithm is this? (saved only AFTER the torn paper is gone)
    const chosenType = TYPES[algoSlots.indexOf(slot)] || null;
    const ai = [...slot.querySelectorAll(".pc-algo")].indexOf(ticketEl);
    const chosenAlgo = chosenType && ai >= 0 ? chosenType.algos[ai] : null;

    // rip-line Y positions (unscaled card space), with a shared ragged edge so
    // the torn edges of neighbouring pieces match exactly
    const topY = (bandR.top - cardR.top) / ts;
    const botY = (bandR.bottom - cardR.top) / ts;
    const ragged = (y) => {
      const pts = [],
        n = 22;
      for (let i = 0; i <= n; i++) {
        const x = Math.min((W / n) * i, W);
        const j =
          (Math.random() * 2 - 1) * 5 +
          (Math.random() < 0.2 ? (Math.random() * 2 - 1) * 7 : 0);
        pts.push([x, Math.max(0, Math.min(H, y + j))]);
      }
      return pts;
    };
    const topLine =
      topY < 6
        ? [
            [0, 0],
            [W, 0],
          ]
        : ragged(topY);
    const botLine =
      botY > H - 6
        ? [
            [0, H],
            [W, H],
          ]
        : ragged(botY);
    const rev = (a) => a.slice().reverse();
    const P = (a) =>
      a.map(([x, y]) => x.toFixed(1) + "px " + y.toFixed(1) + "px").join(",");
    const topClip = P([[0, 0], [W, 0], ...rev(topLine)]); // header + bands above
    const midClip = P([...topLine, ...rev(botLine)]); // the chosen band
    const botClip = P([...botLine, [W, H], [0, H]]); // bands below

    // each piece = a world-space "mover" (for tilt-pivot translate / fall / fly)
    // wrapping a "tilter" (rotate + scale around the card centre) wrapping the
    // clipped card clone. Splitting the layers keeps the maths clean.
    function piece(clip) {
      const mover = document.createElement("div");
      mover.className = "rl-tear-piece";
      mover.style.cssText =
        `position:fixed;left:${cardR.left}px;top:${cardR.top}px;width:${cardR.width}px;height:${cardR.height}px;` +
        `z-index:97;pointer-events:none;perspective:1000px;`;
      const outer = document.createElement("div");
      outer.style.cssText = `position:absolute;inset:0;transform-origin:${cardR.width / 2}px ${cardR.height / 2}px;`;
      const inner = srcCard.cloneNode(true);
      inner.style.cssText =
        `position:absolute;left:0;top:0;width:${W}px;height:${H}px;margin:0;` +
        `transform:scale(${ts});transform-origin:top left;` +
        `clip-path:polygon(${clip});-webkit-clip-path:polygon(${clip});` +
        `filter:drop-shadow(0 3px 3px rgba(0,0,0,.32));`;
      inner.style.setProperty("--c", cardColor); // the airmail stripes need it
      outer.appendChild(inner);
      mover.appendChild(outer);
      document.body.appendChild(mover);
      return { mover, outer };
    }
    const pcTop = piece(topClip),
      pcMid = piece(midClip),
      pcBot = piece(botClip);
    flip.style.visibility = "hidden"; // hide the real card; only the torn pieces show

    const ANG = -20; // the whole card leans like "\"
    const REST = -8; // chosen band keeps a little angle at centre
    const Ox = cardR.width / 2,
      Oy = cardR.height / 2;
    const sep = Math.max(46, cardR.height * 0.18); // how far the torn chunks pull apart
    const T1 = 320,
      T2 = 380,
      T3 = 700; // tilt / rip-apart / fly-away
    const total = T1 + T2 + T3,
      o1 = T1 / total,
      o2 = (T1 + T2) / total;
    const tiltEase = "cubic-bezier(.3,.65,.3,1)";

    // TOP chunk: leans with the card, tears UP along the tilted axis, then tumbles off in 3D
    pcTop.outer.animate(
      [
        { transform: "rotateZ(0deg) rotateY(0deg) translateY(0px)" },
        {
          transform: `rotateZ(${ANG}deg) rotateY(0deg) translateY(0px)`,
          offset: o1,
          easing: tiltEase,
        },
        {
          transform: `rotateZ(${ANG - 6}deg) rotateY(0deg) translateY(${-sep}px)`,
          offset: o2,
          easing: "ease-out",
        },
        {
          transform: `rotateZ(${ANG - 26}deg) rotateY(46deg) translateY(${-sep}px)`,
        },
      ],
      { duration: total, fill: "forwards" },
    );
    pcTop.mover.animate(
      [
        { transform: "translate(0px,0px)" },
        { transform: "translate(0px,0px)", offset: o2 },
        { transform: `translate(-80px,${winH * 1.3}px)` },
      ],
      {
        duration: total,
        easing: "cubic-bezier(.5,.05,.95,.5)",
        fill: "forwards",
      },
    );

    // BOTTOM chunk: mirror - tears DOWN, tumbles off in 3D
    pcBot.outer.animate(
      [
        { transform: "rotateZ(0deg) rotateY(0deg) translateY(0px)" },
        {
          transform: `rotateZ(${ANG}deg) rotateY(0deg) translateY(0px)`,
          offset: o1,
          easing: tiltEase,
        },
        {
          transform: `rotateZ(${ANG + 6}deg) rotateY(0deg) translateY(${sep}px)`,
          offset: o2,
          easing: "ease-out",
        },
        {
          transform: `rotateZ(${ANG + 28}deg) rotateY(-46deg) translateY(${sep}px)`,
        },
      ],
      { duration: total, fill: "forwards" },
    );
    pcBot.mover.animate(
      [
        { transform: "translate(0px,0px)" },
        { transform: "translate(0px,0px)", offset: o2 },
        { transform: `translate(80px,${winH * 1.3}px)` },
      ],
      {
        duration: total,
        easing: "cubic-bezier(.5,.05,.95,.5)",
        fill: "forwards",
      },
    );

    // MIDDLE (chosen algorithm): leans with the card, holds while the others tear
    // away, then un-tilts + scales up as it flies to the centre, and stays there
    const bandCx = bandR.left + bandR.width / 2 - cardR.left;
    const bandCy = bandR.top + bandR.height / 2 - cardR.top;
    const S = Math.min(
      1.32,
      (winW * 0.72) / cardR.width,
      (winH * 0.5) / bandR.height,
    );
    // land the band centre at screen centre given the final tilt (REST) + scale
    const ra = (REST * Math.PI) / 180;
    const vx = S * (bandCx - Ox),
      vy = S * (bandCy - Oy);
    const mtx = Math.round(
      winW / 2 - cardR.left - Ox - (vx * Math.cos(ra) - vy * Math.sin(ra)),
    );
    const mty = Math.round(
      winH / 2 - cardR.top - Oy - (vx * Math.sin(ra) + vy * Math.cos(ra)),
    );
    const midRest = `rotateZ(${REST}deg) rotateX(0deg) rotateY(0deg) scale(${S.toFixed(3)})`;
    pcMid.outer.animate(
      [
        { transform: "rotateZ(0deg) rotateX(0deg) rotateY(0deg) scale(1)" },
        {
          transform: `rotateZ(${ANG}deg) rotateX(0deg) rotateY(0deg) scale(1)`,
          offset: o1,
          easing: tiltEase,
        },
        {
          transform: `rotateZ(${ANG}deg) rotateX(-48deg) rotateY(22deg) scale(1.05)`,
          offset: o2,
          easing: "ease-in-out",
        },
        { transform: midRest },
      ],
      { duration: total, easing: "cubic-bezier(.4,0,.3,1)", fill: "forwards" },
    );
    pcMid.mover.animate(
      [
        { transform: "translate(0px,0px)" },
        { transform: "translate(0px,0px)", offset: o2 },
        { transform: `translate(${mtx}px,${mty}px)` },
      ],
      {
        duration: total,
        easing: "cubic-bezier(.34,1.25,.5,1)",
        fill: "forwards",
      },
    );

    await wait(total + 1250); // the chosen algorithm hangs on screen ~1.25s
    // then it DROPS out of view (not a pop) before the deck returns
    pcMid.outer.animate(
      [
        { transform: midRest },
        {
          transform: `rotateZ(${REST + 15}deg) rotateX(0deg) rotateY(0deg) scale(${S.toFixed(3)})`,
        },
      ],
      { duration: 640, easing: "cubic-bezier(.5,.05,.9,.4)", fill: "forwards" },
    );
    const drop = pcMid.mover.animate(
      [
        { transform: `translate(${mtx}px,${mty}px)` },
        { transform: `translate(${mtx + 40}px,${mty + winH * 1.35}px)` },
      ],
      { duration: 640, easing: "cubic-bezier(.5,.05,.9,.4)", fill: "forwards" },
    );
    await drop.finished.catch(() => {});
    if (chosenType && chosenAlgo) saveAlgoChoice(chosenType, chosenAlgo); // selection changes only now (paper gone)
    ripSelectReset(); // back to the full deck
  }
  algoSlots.forEach((slot) => {
    slot.addEventListener("click", () => {
      if (flipped) {
        goBack();
        return;
      } // click the open card to go back
      if (slot === upCard) {
        if (!busy) flipCard(slot);
        return;
      } // 2nd click -> flip
      pending = slot;
      if (busy) return; // it will come up once the running animation ends
      if (upCard)
        lowerCard(upCard); // a different card was up: lower it, then lift this
      else {
        pending = null;
        liftCard(slot);
      } // 1st click -> bring on top
    });
  });
  algosEl.querySelectorAll(".pc-algo").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (b.closest(".acard-slot")?.classList.contains("disabled")) return; // view-only
      if (flipped && !busy) ripSelect(b);
    });
  });
  // click anywhere off a card -> go back
  algosEl.addEventListener("click", (e) => {
    if (!e.target.closest(".acard-slot") && (flipped || upCard)) goBack();
  });

  const howtoEl = document.createElement("div");
  howtoEl.id = "rl-howto";
  howtoEl.innerHTML =
    `<div class="howto-wrap"><div class="howto-card">` +
    `<canvas class="hw-mascot"></canvas>` +
    `<div class="hw-panel">` +
    `<div class="hw-banner"><span class="hw-step">1/4</span><span class="hw-title">Build your team</span></div>` +
    `<p class="hw-para"></p>` +
    `<div class="hw-stage"></div>` +
    `<div class="hw-nav"><div class="hw-dots"></div>` +
    `<button class="hw-prev" type="button" hidden>&#9664; Back</button>` +
    `<button class="hw-next" type="button">Next &#9654;</button></div>` +
    `</div></div></div>`;
  document.body.appendChild(howtoEl);

  // ===== How-It-Works wizard: paginated pages, each with a marker-annotated illustration =====
  const HW_ARROW =
    `<svg class="hw-arrow" viewBox="0 0 50 36" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M5 5 C 22 7, 33 15, 43 30"/><path d="M43 30 L 34 29"/><path d="M43 30 L 41 21"/></svg>`;
  const hwAnno = (cls, text) => `<div class="hw-anno ${cls}"><span>${text}</span>${HW_ARROW}</div>`;
  // page 1 - the five algorithm families
  // labels here, but colors + icons come straight from the algorithm tab (TYPES + PMICONS,
  // same order: DP, MC, TD, Deep, PG) so they stay in sync with it
  const HW_FAM = ["DP", "MC", "TD", "Deep", "PG"];
  const hwChips = `<div class="hw-chips">` +
    HW_FAM.map((n, i) => `<div class="hw-chip"><div class="ci" style="background:${TYPES[i].color}">${PMICONS[i] ?? ""}</div><b>${n}</b></div>`).join("") +
    `</div>`;
  // page 2 - opponents getting tougher
  const hwOpp = (key, stars) =>
    `<div class="hw-opp"><div class="oa" style="background-image:url(./assets/icons/${key}.png)"></div>` +
    `<div class="ostars">${"★".repeat(stars)}${"☆".repeat(5 - stars)}</div></div>`;
  const hwLadder = `<div class="hw-ladder">${hwOpp("toad", 1)}${hwOpp("yoshi", 3)}${hwOpp("bowser", 5)}</div>`;
  // page 3 - the red-vs-blue duel
  const hwArena = `<div class="vs-arena">` +
    `<div class="vs-fighter blue"><div class="vs-ava">🧠</div><div class="vs-name">YOU</div><div class="vs-tag">your team</div></div>` +
    `<div class="vs-clash"><span class="vs-word">VS</span></div>` +
    `<div class="vs-fighter red"><div class="vs-ava">🧠</div><div class="vs-name">RIVAL</div><div class="vs-tag">computer</div></div>` +
    `</div>`;
  // page 4 - the crown
  const hwPodium = `<div class="hw-podium">` +
    `<div class="pod p2"><span class="pn">2</span></div>` +
    `<div class="pod p1"><span class="ptrophy">🏆</span><span class="pn">1</span></div>` +
    `<div class="pod p3"><span class="pn">3</span></div>` +
    `</div>`;
  // TEMP: placeholder for the face-off + champion visuals (real designs coming later;
  // hwArena / hwPodium above are kept for when we wire the real thing back in)
  const hwPlaceholder = `<div class="hw-ph">Placeholder</div>`;
  // the "Face off" visual: the 4 round boards fanned in a stack (R2 + R3 in front)
  const hwArenaStack =
    `<div class="hw-arenas">` +
    `<img class="ar a1" src="./assets/arenas/arena-round1.png" alt="Peach's Castle board">` +
    `<img class="ar a4" src="./assets/arenas/arena-round4.png" alt="Ruined Kingdom arena">` +
    `<img class="ar a3" src="./assets/arenas/arena-round3.png" alt="Fossil Falls board">` +
    `<img class="ar a2" src="./assets/arenas/arena-round2.png" alt="New Donk City board">` +
    `</div>`;
  // "Take the crown" visual: the head-to-head scoreboard banner
  const hwVersus = `<img class="hw-versus" src="./assets/ui/versus.png" alt="Round scoreboard - you versus the CPU">`;

  const HOWTO_PAGES = [
    { frac: "1/4", title: "Build your team",
      para: "First, draft your line-up of RL algorithms, one brain from each family. Value Iteration, SARSA, Q-Learning, DQN and more, each learns its own way.",
      stage: hwAnno("tl", "Five families") + hwChips + hwAnno("tr", "Pick one each") },
    { frac: "2/4", title: "Pick your rival",
      para: "Then choose a computer character to battle. Work up the roster: every opponent you face is stronger and harder to beat than the last.",
      stage: hwAnno("tl", "Climb the roster") + hwLadder + hwAnno("tr", "Tougher each time") },
    { frac: "3/4", title: "Face off",
      para: "Now the duel: your algorithm and the rival's tackle the very same map at once, one Red and one Blue, a fair head-to-head test of who learned better.",
      stage: hwArenaStack },
    { frac: "4/4", title: "Take the crown",
      para: "Out-score your rival (faster, safer, higher reward) to take the round. Win the most rounds across the bracket to be crowned champion of Rival Minds.",
      stage: hwVersus },
  ];

  const hwStepEl = howtoEl.querySelector(".hw-step");
  const hwTitleEl = howtoEl.querySelector(".hw-title");
  const hwParaEl = howtoEl.querySelector(".hw-para");
  const hwStageEl = howtoEl.querySelector(".hw-stage");
  const hwDotsEl = howtoEl.querySelector(".hw-dots");
  const hwPrevBtn = howtoEl.querySelector(".hw-prev");
  const hwNextBtn = howtoEl.querySelector(".hw-next");
  let hwPage = 0;
  hwDotsEl.innerHTML = HOWTO_PAGES.map(() => `<span class="hw-dot"></span>`).join("");
  function renderHowto() {
    const p = HOWTO_PAGES[hwPage];
    hwStepEl.textContent = p.frac;
    hwTitleEl.textContent = p.title;
    hwParaEl.textContent = p.para;
    hwStageEl.innerHTML = p.stage;
    hwDotsEl.querySelectorAll(".hw-dot").forEach((d, i) => d.classList.toggle("on", i === hwPage));
    hwPrevBtn.hidden = hwPage === 0;
    hwNextBtn.innerHTML = hwPage === HOWTO_PAGES.length - 1 ? "Got it &#10003;" : "Next &#9654;";
  }
  function hwGo(d) {
    const next = hwPage + d;
    if (next < 0) return;
    if (next >= HOWTO_PAGES.length) { closeScreens(); return; }
    hwPage = next;
    renderHowto();
  }
  hwNextBtn.addEventListener("click", () => hwGo(1));
  hwPrevBtn.addEventListener("click", () => hwGo(-1));
  const onHowtoKeys = (e) => {
    if (!howtoEl.classList.contains("open")) return;
    if (e.key === "ArrowRight") hwGo(1);
    else if (e.key === "ArrowLeft") hwGo(-1);
  };
  window.addEventListener("keydown", onHowtoKeys);
  // pre-load Cappy in the background so he's ready before the wizard opens and flies the
  // FULL arc instead of snapping in late
  setTimeout(() => initCappy3D(), 400);

  const titleAlgos = document.createElement("div");
  titleAlgos.className = "big-title";
  titleAlgos.textContent = "Algorithms";
  document.body.appendChild(titleAlgos);
  const titleChars = document.createElement("div");
  titleChars.className = "big-title";
  titleChars.textContent = "Characters";
  document.body.appendChild(titleChars);
  const titleHowto = document.createElement("div");
  titleHowto.className = "big-title";
  titleHowto.textContent = "How It Works?";
  document.body.appendChild(titleHowto);
  let algosCloseTok = 0;
  let algosDealTok = 0;
  let howtoCloseTok = 0;
  function dropTitle(t) {
    t._fallTok = (t._fallTok || 0) + 1; // cancel any pending fall-cleanup
    t.classList.remove("show", "fall");
    void t.offsetWidth; // force reflow so the drop replays each open
    t.classList.add("show");
  }
  function fallTitle(t) {
    if (!t.classList.contains("show")) return;
    t.classList.add("fall"); // tumble it off the bottom, then hide
    const tok = (t._fallTok = (t._fallTok || 0) + 1);
    setTimeout(() => {
      if (t._fallTok === tok) t.classList.remove("show", "fall");
    }, 600);
  }
  const scrBack = document.createElement("div");
  scrBack.id = "rl-scr-back";
  scrBack.innerHTML = `<span class="key">ESC</span><span class="txt">Back</span>`;
  document.body.appendChild(scrBack);

  function closeScreens() {
    if (algosEl.classList.contains("open")) {
      algosEl.classList.add("closing"); // let the cards fly out left, then hide
      const tok = ++algosCloseTok;
      setTimeout(() => {
        if (tok === algosCloseTok)
          algosEl.classList.remove("open", "closing", "dealing");
      }, 650);
    }
    if (howtoEl.classList.contains("open")) {
      exitCappy3D(); // Cappy flips off the top
      howtoEl.classList.add("closing"); // panel throws back out to the right
      const tok = ++howtoCloseTok;
      setTimeout(() => {
        if (tok === howtoCloseTok) {
          howtoEl.classList.remove("open", "closing");
          stopCappy3D();
        }
      }, CAPPY_EXIT_MS);
    } else {
      stopCappy3D();
    }
    el.classList.remove("shift");
    fallTitle(titleAlgos);
    fallTitle(titleHowto);
    scrBack.classList.remove("show");
  }
  function openAlgos() {
    closeScreens();
    algosCloseTok++; // cancel any pending close cleanup
    algosEl.classList.remove("closing");
    algosEl.classList.add("open", "dealing");
    const dtok = ++algosDealTok;
    setTimeout(() => {
      if (dtok === algosDealTok) algosEl.classList.remove("dealing");
    }, 1100);
    el.classList.add("shift"); // slide the main menu off to the left
    dropTitle(titleAlgos);
    scrBack.classList.add("show");
  }
  function openHowto() {
    closeScreens();
    howtoCloseTok++; // cancel any pending deferred close from a quick re-open
    howtoEl.classList.remove("closing"); // clear any in-progress throw-out
    hwPage = 0;
    renderHowto();
    howtoEl.classList.add("open");
    el.classList.add("shift");
    dropTitle(titleHowto);
    scrBack.classList.add("show");
    startCappy3D(); // spin up the live 3D presenter
  }
  scrBack.addEventListener("click", () => {
    if (flipped || upCard) goBack();
    else closeScreens();
  });
  const onEscKey = (e) => {
    if (e.key !== "Escape") return;
    if (flipped || upCard) {
      goBack();
      return;
    }
    if (
      algosEl.classList.contains("open") ||
      howtoEl.classList.contains("open")
    )
      closeScreens();
  };
  window.addEventListener("keydown", onEscKey);

  // ---- Mario-style iris wipe: a circular transparent hole in a full-screen black
  // (a big box-shadow). Shrinking the circle to 0 = fades to black; growing it back
  // = reveals the scene. Starts fully open (no black).
  const iris = document.createElement("div");
  // "fully open" hole diameter: big enough that the black ring sits off-screen. Read
  // from the CURRENT viewport each time (not frozen at boot) so growing the window
  // can't let the black creep back into the corners while the menu is idle.
  const fullDiag = () =>
    Math.ceil(Math.hypot(window.innerWidth, window.innerHeight) * 1.3);
  const setIris = (dpx) => {
    iris.style.width = iris.style.height = dpx + "px";
    iris.style.margin = `${-dpx / 2}px 0 0 ${-dpx / 2}px`;
  };
  const openIris = () => {
    const d = fullDiag();
    iris.style.boxShadow = `0 0 0 ${d}px #000`;
    setIris(d);
  };
  let irisIdle = true; // true while the hole sits fully open (menu shown, pre-Start)
  iris.style.cssText =
    "position:fixed;top:50%;left:50%;border-radius:50%;pointer-events:none;z-index:100;" +
    "transition:width 1s cubic-bezier(.66,0,.34,1),height 1s cubic-bezier(.66,0,.34,1),margin 1s cubic-bezier(.66,0,.34,1);";
  openIris(); // start fully open (no black)
  document.body.appendChild(iris);
  // re-fit the reveal if the window is resized while the menu sits idle-open, so it
  // always clears the corners (instant, no animation - a resize drag fires many events).
  const onIrisResize = () => {
    if (!irisIdle) return;
    const prev = iris.style.transition;
    iris.style.transition = "none";
    openIris();
    void iris.offsetWidth;
    iris.style.transition = prev;
  };
  window.addEventListener("resize", onIrisResize);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let starting = false;
  async function runStart() {
    if (starting) return;
    starting = true;
    irisIdle = false; // we're about to close to black - stop the resize re-fit
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

    // 4) iris-open onto the finished game (recompute for the CURRENT window size in
    // case it was resized during the black)
    openIris();
    await wait(1020);
    window.removeEventListener("resize", onIrisResize);
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
  // at the midpoint between items - the selection heads to the next one as soon as
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
  // can't start until an algorithm is chosen on every family card (one per level)
  function selectionReady() {
    const ch = readAlgoChoices();
    // disabled families (DP) are view-only and never required to start
    return TYPES.filter((t) => !t.disabled).every((t) => ch[t.key]);
  }
  const gateMsg = document.createElement("div");
  gateMsg.id = "rl-gate";
  gateMsg.innerHTML = `<span class="gate-ico">!</span><span class="gate-txt">Pick your 5 algorithms first!</span>`;
  document.body.appendChild(gateMsg);
  let gateTok = 0;
  function warnStart() {
    // if it's still sliding out (or already up), restart the pop from scratch
    gateMsg.classList.remove("hide", "show");
    void gateMsg.offsetWidth;
    gateMsg.classList.add("show");
    const tok = ++gateTok;
    setTimeout(() => {
      if (tok !== gateTok) return;
      // hand off to the exit animation: drop .show only once .hide is on, so the
      // transform never snaps back to the resting (off-screen) state mid-way
      gateMsg.classList.add("hide");
      gateMsg.classList.remove("show");
      setTimeout(() => {
        if (tok === gateTok) gateMsg.classList.remove("hide");
      }, 420); // matches rl-gate-out
    }, 2600);
  }
  // play the Odyssey CONFIRM WIPE on the pill, then run the item's action. keep=
  // true leaves it in its swept (gray) state (the Start path tears the menu down,
  // so there's no point resetting); otherwise it resets once the sub-menu covers
  // it, so it's clean when you come back.
  function confirmPick(it, done, keep) {
    it.classList.remove("confirm");
    void it.offsetWidth; // restart the sweep if the same item is re-clicked
    it.classList.add("confirm");
    setTimeout(() => done && done(), 360); // let the sweep read, then fire
    if (!keep) setTimeout(() => it.classList.remove("confirm"), 760);
  }
  for (const it of items) {
    it.addEventListener("click", () => {
      select(it);
      if (it.dataset.go) {
        if (selectionReady()) confirmPick(it, runStart, true);
        else warnStart();
      } else if (it.dataset.open) confirmPick(it, openSelect);
      else if (it.dataset.howto) confirmPick(it, openHowto);
      else if (it.dataset.algos) confirmPick(it, openAlgos);
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
    window.removeEventListener("keydown", onHowtoKeys);
    window.removeEventListener("keydown", onEscKey);
    disposeSeated(-1);
    disposeSeated(1);
    stopCappy3D();
    cappy3D?.renderer?.dispose?.(); // free the presenter's WebGL context
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
    gateMsg.remove();
    cpuStatsEl.remove();
    style.remove();
    // the sub-screens + their shared chrome (created once per menu instance):
    // without these a second createStartMenu (Play Again) duplicates their ids,
    // and getElementById then finds the DEAD first instance
    algosEl.remove();
    howtoEl.remove();
    scrBack.remove();
    titleAlgos.remove();
    titleChars.remove();
    titleHowto.remove();
    screenCSS.remove();
  }

  function dispose() {
    teardown();
    window.removeEventListener("resize", onIrisResize);
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
