import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { CHARS, CHARACTERS, tuneChar, collectRig } from './startmenu.js';

// Load the chosen menu characters as the two board pieces, reusing the menu's
// EXACT tuneChar (matte materials, eyes, mustache + loose-limb stripping) and
// collectRig, so they look identical to the start screen. The board only adds
// what it needs on top: stand them feet-on-floor, scale to board height, and a
// walk / fly rig that characters.updateWalker drives.

const FLOOR_Y = 0.16;       // feet on the tile top (same as the procedural walkers)
const BOARD_HEIGHT = 1.2;   // model height in group-local units; live.js then scales x1.2

// per-character board tweaks (facing offset / scale) and special behaviour
const TWEAK = {
  // face/scale per character, plus armOut (how far the arms hang out from the body;
  // wider/rounder characters need more so the arms don't clip into the body).
  yoshi: { armOut: 0.5 },
  toadette: { armOut: 0.5 },
  toad: { armOut: 0.85 },
};
const CHAR_CONFIG = {
  parabones: { fly: true, hideLimbs: true },
};

const collada = new ColladaLoader();

// aim a bone so its limb (bone -> child direction) points DOWN, then bake. Uses the
// real world limb direction, so it works regardless of each rig's bone frame.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _cur = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _DOWN = new THREE.Vector3(0, -1, 0);
const _FWD = new THREE.Vector3(0, 0, 1);
// aim a bone's limb (bone -> child) toward a world-space target, then bake. Rig-
// agnostic (uses the real limb direction), same idea as the menu's bone aimer.
function aimTo(bone, child, target) {
  if (!bone || !child) return;
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _cur.copy(_b).sub(_a);
  if (_cur.lengthSq() < 1e-8) return;
  _cur.normalize();
  _q.setFromUnitVectors(_cur, target.clone().normalize());
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.clone().invert().multiply(_q).multiply(_pq).multiply(bone.quaternion));
  bone.updateMatrixWorld(true);
}

export async function loadBoardWalker(idx) {
  const def = CHARACTERS[idx] || CHARACTERS[0];
  const charKey = def.file.split('/')[0];
  const tweak = TWEAK[charKey] || {};
  const cfg = CHAR_CONFIG[charKey] || {};
  const asset = await collada.loadAsync(CHARS + def.file);
  const root = asset.scene;

  // axis-fix: undo a bad Z-up conversion if the model ended up tipped over
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  let s = box.getSize(new THREE.Vector3());
  if (charKey !== 'bowser' && s.y < Math.max(s.x, s.z) * 0.85) {
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    s = box.getSize(new THREE.Vector3());
  }

  tuneChar(root, charKey);                 // the menu's exact per-character treatment
  const rig = collectRig(root, charKey);

  // centre the hips over the origin and drop the feet to y=0 (native units)
  const anchor = (rig.hip || rig.spine1)?.getWorldPosition(new THREE.Vector3())
    ?? box.getCenter(new THREE.Vector3());
  root.position.set(-anchor.x, -box.min.y, -anchor.z);

  // inner: scale to board height + facing offset; outer (group): live.js owns it
  const inner = new THREE.Group();
  inner.add(root);
  inner.scale.setScalar((BOARD_HEIGHT * (tweak.scale ?? 1)) / (s.y || 1));
  inner.rotation.y = tweak.face ?? 0;
  const group = new THREE.Group();
  group.add(inner);
  group.updateMatrixWorld(true);

  let parts, fly = false, baseY = FLOOR_Y;
  if (cfg.fly) {
    // flying character (Parabones): hover low, flap wings; tuneChar already stripped
    // its loose limbs, this just collapses the bones too so nothing pokes out.
    fly = true;
    baseY = 0.35;
    if (cfg.hideLimbs) for (const bn of [rig.legL1, rig.legR1, rig.armL1, rig.armR1]) if (bn) bn.scale.setScalar(0.0001);
    parts = { wingL1: rig.wingL1, wingR1: rig.wingR1, wingL2: rig.wingL2, wingR2: rig.wingR2 };
  } else {
    // hang the arms down-and-slightly-out using the shoulder side-axis (like the
    // menu's seated aim), so they sit at the sides instead of clipping into the body,
    // then straighten the forearm. Capture rest from this pose; the walk swings it.
    const sl = rig.shoulderL || rig.armL1, sr = rig.shoulderR || rig.armR1;
    const sideAxis = (sl && sr)
      ? sl.getWorldPosition(new THREE.Vector3()).sub(sr.getWorldPosition(new THREE.Vector3())).normalize()
      : new THREE.Vector3(1, 0, 0);
    const out = tweak.armOut ?? 0.22;
    const armTgt = (sign) => new THREE.Vector3().copy(sideAxis).multiplyScalar(sign * out)
      .addScaledVector(_DOWN, 1.0).addScaledVector(_FWD, 0.07);
    const foreTgt = (sign) => new THREE.Vector3().copy(sideAxis).multiplyScalar(sign * 0.06).addScaledVector(_DOWN, 1.0);
    aimTo(rig.armL1, rig.armL2 || rig.handL, armTgt(1));
    aimTo(rig.armL2, rig.handL, foreTgt(1));
    aimTo(rig.armR1, rig.armR2 || rig.handR, armTgt(-1));
    aimTo(rig.armR2, rig.handR, foreTgt(-1));
    parts = { hipL: rig.legL1, hipR: rig.legR1, shL: rig.armL1, shR: rig.armR1 };
  }
  const rest = {};
  for (const key in parts) rest[key] = parts[key] ? parts[key].quaternion.clone() : null;

  // hand anchors for the carried gold key (attach to a hand bone if we found one)
  const mkAnchor = (bn) => { const a = new THREE.Object3D(); (bn || inner).add(a); return a; };
  const handAnchors = { L: mkAnchor(rig.handL), R: mkAnchor(rig.handR) };

  return {
    group, parts, rest, handAnchors,
    bones: true, fly,
    cadence: 9, legSwing: 1,
    phase: Math.random() * 6.28, moveAmt: 0,
    baseY, name: charKey,
  };
}

// load the player's (blue, slot -1) and the CPU's (red, slot 1) chosen characters
export async function loadBoardWalkers() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('rl-chars') || '{}'); } catch (e) {}
  const blueIdx = Number.isInteger(p['-1']) ? p['-1'] : 0;
  const redIdx = Number.isInteger(p['1']) ? p['1'] : 1;
  const [red, blue] = await Promise.all([loadBoardWalker(redIdx), loadBoardWalker(blueIdx)]);
  return { red, blue };
}
