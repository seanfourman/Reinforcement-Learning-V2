import * as THREE from 'three';

// Procedural royal characters built entirely from three.js primitives (no
// downloaded models - the project stays self-contained). Each character is a
// THREE.Group whose feet sit at local y = 0, with hip/shoulder PIVOT groups so
// a walk cycle is just swinging those pivots. A `hand` anchor marks where the
// carried gold key attaches.

const FLOOR_Y = 0.16; // top of a floor tile - characters stand here

function limb(geo, mat, y) {
  // a limb mesh hung BELOW a pivot, so rotating the pivot about x swings it
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

function pivotAt(x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  return p;
}

// A smooth, rounded shoe - replaces the old hard box "block" feet. Built from a
// capsule laid on its side, flattened and stretched so it reads as a boot toe.
function bootGeometry(s) {
  const g = new THREE.CapsuleGeometry(0.05, 0.1, 8, 18);
  g.rotateX(Math.PI / 2);                 // lay it along z, toe pointing forward
  g.scale(0.95 * s, 0.6 * s, 1.2 * s);    // narrow + flatten + lengthen
  g.translate(0, 0, 0.04 * s);            // nudge the toe ahead of the ankle
  return g;
}

// Shared biped skeleton; styling (robe/gown, head, crown, extras) is layered on
// top by the King/Princess builders.
function buildBiped(opts) {
  const {
    skin = 0xf0c4a0, robe, robeTrim, legColor, armColor = skin,
    robeTopR = 0.17, robeBotR = 0.34, robeTop = 0.7, robeBot = 0.06,
    shoulderW = 0.19, hipW = 0.1, cadence = 12,
    legR = 0.06, bootColor = 0x4a3526, bootScale = 1,
    showFeet = true, legSwing = 1,
  } = opts;

  const group = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const robeMat = new THREE.MeshStandardMaterial({ color: robe, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: robeTrim, roughness: 0.6, metalness: 0.2 });
  const legMat = new THREE.MeshStandardMaterial({ color: legColor, roughness: 0.8 });
  const armMat = new THREE.MeshStandardMaterial({ color: armColor, roughness: 0.75 });

  // --- legs on hip pivots (swing front/back) --------------------------------
  const legGeo = new THREE.CylinderGeometry(legR, legR * 0.82, 0.42, 16);
  const footGeo = showFeet ? bootGeometry(bootScale) : null;
  const footMat = new THREE.MeshStandardMaterial({ color: bootColor, roughness: 0.8 });
  const hipL = pivotAt(-hipW, 0.46, 0);
  const hipR = pivotAt(hipW, 0.46, 0);
  for (const hip of [hipL, hipR]) {
    hip.add(limb(legGeo, legMat, -0.21));
    if (footGeo) {
      const foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(0, -0.41, 0);
      foot.castShadow = true;
      hip.add(foot);
    }
  }
  group.add(hipL, hipR);

  // --- robe / gown (a tapered skirt that hides the upper legs) --------------
  const robeGeo = new THREE.CylinderGeometry(robeTopR, robeBotR, robeTop - robeBot, 32, 1, true);
  const robeMesh = new THREE.Mesh(robeGeo, robeMat);
  robeMesh.position.y = (robeTop + robeBot) / 2;
  robeMesh.castShadow = true;
  group.add(robeMesh);
  // hem trim
  const hem = new THREE.Mesh(new THREE.TorusGeometry(robeBotR, 0.03, 12, 32), trimMat);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = robeBot;
  group.add(hem);

  // --- torso + belt ---------------------------------------------------------
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, robeTopR, 0.26, 24), robeMat);
  torso.position.y = 0.82;
  torso.castShadow = true;
  group.add(torso);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(robeTopR + 0.005, 0.028, 12, 32), trimMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.7;
  group.add(belt);

  // --- arms on shoulder pivots ---------------------------------------------
  const armGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.38, 14);
  const handGeo = new THREE.SphereGeometry(0.05, 16, 12);
  const shL = pivotAt(-shoulderW, 0.92, 0);
  const shR = pivotAt(shoulderW, 0.92, 0);
  const handAnchors = {};
  for (const [side, sh] of [['L', shL], ['R', shR]]) {
    const sleeve = limb(armGeo, robeMat, -0.17);
    sh.add(sleeve);
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.position.y = -0.38;
    hand.castShadow = true;
    sh.add(hand);
    const anchor = new THREE.Object3D();
    anchor.position.set(0, -0.42, 0.06);
    sh.add(anchor);
    handAnchors[side] = anchor;
  }
  group.add(shL, shR);

  // --- head + neck ----------------------------------------------------------
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 16), skinMat);
  neck.position.y = 0.97;
  group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 20), skinMat);
  head.position.y = 1.08;
  head.castShadow = true;
  group.add(head);
  // simple face: two dark eyes facing +z (the model's forward)
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.5 });
  for (const ex of [-0.045, 0.045]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), eyeMat);
    eye.position.set(ex, 1.1, 0.122);
    group.add(eye);
  }

  group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });

  return {
    group,
    head,
    parts: { hipL, hipR, shL, shR },
    handAnchors,
    materials: { skinMat, robeMat, trimMat, legMat, armMat },
    cadence,
    legSwing,
    phase: Math.random() * 6.28,
    moveAmt: 0,
    baseY: FLOOR_Y,
  };
}

// swing an imported bone around a WORLD axis, relative to its rest pose. Using a
// world (character left-right) axis works no matter how each rig's local bone
// frame is oriented, so all the different character rips walk the same way.
const _wq = new THREE.Quaternion();
const _sw = new THREE.Quaternion();
const _out = new THREE.Quaternion();
function swingBone(bone, restQ, axisWorld, angle) {
  if (!bone || !restQ) return;
  bone.parent.getWorldQuaternion(_wq);            // parent orientation (1 frame stale, fine)
  _sw.setFromAxisAngle(axisWorld, angle);
  _out.copy(_wq).invert().multiply(_sw).multiply(_wq).multiply(restQ);
  bone.quaternion.copy(_out);
}
const _ax = new THREE.Vector3();

// flap a wing bone around its LOCAL Y axis, relative to rest (matches the menu's
// applyIdle: bone.quaternion = rest * euler(0, y, 0)).
const _e = new THREE.Euler();
const _fq = new THREE.Quaternion();
function flapWing(bone, restQ, y) {
  if (!bone || !restQ) return;
  _e.set(0, y, 0, 'XYZ');
  _fq.setFromEuler(_e);
  bone.quaternion.copy(restQ).multiply(_fq);
}

// Advance the walk cycle. `moving` ramps the swing amplitude up/down so starts
// and stops ease instead of snapping.
export function updateWalker(w, dt, moving) {
  w.moveAmt += ((moving ? 1 : 0) - w.moveAmt) * Math.min(1, dt * 10);
  if (moving) w.phase += dt * w.cadence;
  const amp = 0.6 * w.moveAmt;
  const s = Math.sin(w.phase);
  if (w.fly) {
    // flying character (e.g. Parabones): hover + beat the wings (no legs/arms). Same
    // flap as the menu: local-Y swing of each wing bone, the outer tips lagging.
    const tt = performance.now() * 0.001;
    const flap = (Math.sin(tt * 6.5) + 1) * 0.5;
    const flapTip = (Math.sin(tt * 6.5 - 0.6) + 1) * 0.5;
    flapWing(w.parts.wingL1, w.rest.wingL1, -flap * 0.5);
    flapWing(w.parts.wingR1, w.rest.wingR1, flap * 0.5);
    flapWing(w.parts.wingL2, w.rest.wingL2, -flapTip * 0.34);
    flapWing(w.parts.wingR2, w.rest.wingR2, flapTip * 0.34);
    w.group.position.y = w.baseY + Math.sin(tt * 1.7) * 0.06;
    return;
  }
  if (w.bones) {
    // imported character rig: swing the leg/arm bones about the character's local
    // left-right axis (in world), so legs/arms pivot forward-back as it faces.
    const hy = w.group.rotation.y;
    _ax.set(Math.cos(hy), 0, -Math.sin(hy));
    const la = amp * 0.9, aa = amp * 0.6;
    swingBone(w.parts.hipL, w.rest.hipL, _ax, s * la);
    swingBone(w.parts.hipR, w.rest.hipR, _ax, -s * la);
    swingBone(w.parts.shL, w.rest.shL, _ax, -s * aa);
    swingBone(w.parts.shR, w.rest.shR, _ax, s * aa);
  } else {
    const legAmp = amp * (w.legSwing ?? 1); // a floor-length gown swings its legs less
    w.parts.hipL.rotation.x = s * legAmp;
    w.parts.hipR.rotation.x = -s * legAmp;
    w.parts.shL.rotation.x = -s * amp * 0.85;
    w.parts.shR.rotation.x = s * amp * 0.85;
  }
  // a subtle bob + breathing so an idle character isn't frozen
  const bob = Math.abs(Math.sin(w.phase)) * 0.045 * w.moveAmt;
  const breathe = Math.sin(performance.now() * 0.002) * 0.004 * (1 - w.moveAmt);
  w.group.position.y = w.baseY + bob + breathe;
}

// ----------------------------------------------------------------- the King
export function makeKing() {
  // a SHORT belted tunic (not a gown) over dark trousers + big boots, with
  // broad shoulders - clearly a king, not a dress.
  const w = buildBiped({
    skin: 0xe6b48c,
    robe: 0x8f2a2a, robeTrim: 0xe8c168,
    legColor: 0x2c2e3c, bootColor: 0x3a281a, bootScale: 1.3, legR: 0.078,
    robeTopR: 0.2, robeBotR: 0.27, robeTop: 0.92, robeBot: 0.5,
    shoulderW: 0.24, hipW: 0.12, cadence: 10,
  });
  const { group } = w;
  const gold = new THREE.MeshStandardMaterial({ color: 0xe8c168, roughness: 0.4, metalness: 0.45 });
  const fur = new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.95 });

  // big crown with points
  const crown = new THREE.Group();
  crown.position.y = 1.2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.08, 24, 1, true), gold);
  crown.add(band);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 12), gold);
    spike.position.set(Math.cos(a) * 0.12, 0.08, Math.sin(a) * 0.12);
    crown.add(spike);
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xc0392b, emissive: 0x5a1410, emissiveIntensity: 0.5, roughness: 0.3 }));
    jewel.position.set(Math.cos(a) * 0.12, 0.05, Math.sin(a) * 0.12);
    crown.add(jewel);
  }
  group.add(crown);

  // white beard
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 18), fur);
  beard.position.set(0, 1.0, 0.07);
  beard.rotation.x = 0.15;
  group.add(beard);

  // fur collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 14, 32), fur);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.93;
  group.add(collar);

  w.name = 'king';
  return w;
}

// -------------------------------------------------------------- the Princess
export function makePrincess() {
  // a full floor-length gown: the skirt reaches the tiles and the legs/feet are
  // hidden beneath it (and don't swing), so nothing pokes out from under the hem.
  const w = buildBiped({
    skin: 0xf3cdab,
    robe: 0x3f6fd6, robeTrim: 0xbfe0ff,
    legColor: 0xf0e2ea, legR: 0.05,
    robeTopR: 0.15, robeBotR: 0.38, robeTop: 0.7, robeBot: 0.02,
    shoulderW: 0.16, hipW: 0.09, cadence: 12.5,
    showFeet: false, legSwing: 0,
  });
  const { group } = w;
  const gold = new THREE.MeshStandardMaterial({ color: 0xf0d060, roughness: 0.4, metalness: 0.45 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x6b3d1f, roughness: 0.85 });

  // long flowing hair: a back panel + two side locks
  const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.34, 8, 16), hairMat);
  back.position.set(0, 0.96, -0.07);
  back.scale.set(1, 1, 0.5);
  back.castShadow = true;
  group.add(back);
  // a rounded crown of hair that stops at a hairline ABOVE the brows, so it
  // frames the face instead of covering it (the back panel keeps the volume)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.158, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2.3), hairMat);
  cap.position.set(0, 1.115, -0.012);
  cap.scale.set(1.0, 1.12, 1.04);
  group.add(cap);
  for (const sx of [-0.12, 0.12]) {
    const lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.3, 6, 12), hairMat);
    lock.position.set(sx, 0.95, 0.02);
    group.add(lock);
  }

  // dainty tiara
  const tiara = new THREE.Group();
  tiara.position.y = 1.16;
  const tband = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 10, 32, Math.PI), gold);
  tband.rotation.set(Math.PI / 2, 0, 0);
  tiara.add(tband);
  const peak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 12), gold);
  peak.position.set(0, 0.03, 0.12);
  tiara.add(peak);
  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xff5ea8, emissive: 0x7a1a44, emissiveIntensity: 0.5, roughness: 0.3 }));
  gem.position.set(0, 0.0, 0.13);
  tiara.add(gem);
  group.add(tiara);

  // puff sleeves + bodice trim
  for (const sx of [-0.16, 0.16]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), w.materials.robeMat);
    puff.position.set(sx, 0.88, 0);
    group.add(puff);
  }
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 12, 32), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.5, metalness: 0.2 }));
  sash.rotation.x = Math.PI / 2;
  sash.position.y = 0.74;
  group.add(sash);

  w.name = 'princess';
  return w;
}
