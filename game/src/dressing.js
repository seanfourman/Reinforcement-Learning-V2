import * as THREE from 'three';
import { cellToWorld } from './layout.js';

// Set-decoration for the castle interior: instead of scattering loose props, the
// big empty hall is laid out as FURNISHED ZONES, like real castle rooms —
//   * a LIBRARY (walls of bookcases + a reading table)        — top-left of the hall
//   * a MUSIC corner with a grand PIANO + bench                — top-right
//   * a LOUNGE: sofas + coffee table around a FIREPLACE        — right side
//   * marble STATUES on pedestals flanking the central path
//   * elegant STANDING LAMPS (torchères) lighting the aisles
//   * a tiered stone FOUNTAIN as the courtyard centrepiece     — living room
//   * potted topiary trees + rugs tying each area together
//
// Everything here is purely visual (it never touches the RL grid), so it can sit
// anywhere; placements are hand-authored to dress the open floor while keeping the
// agents' lanes, the gold, the escape gate and the mechanics clear.

const FLOOR_Y = 0.16;
const BOOK_COLS = [0x8c3b3b, 0x36617a, 0x3f7050, 0xb08a3a, 0x6a4a7a, 0x9c5a2a, 0x456b8a];
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export function createDressing(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const geos = [];
  const mats = [];
  const flames = [];   // { mesh, light, phase }
  const fires = [];    // { light, phase }
  const waters = [];   // { mat, bob, phase }
  const G = (g) => { geos.push(g); return g; };
  const mk = (color, roughness = 0.9, metalness = 0, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    mats.push(m);
    return m;
  };

  // ---------------------------------------------------------------- materials
  const marble = mk(0xe4decd, 0.78);
  const stoneGrey = mk(0xb4a88f, 0.9);
  const stoneDark = mk(0x8d7f66, 0.92);
  const woodD = mk(0x553a22, 0.85);
  const woodM = mk(0x6f4a2c, 0.85);
  const woodL = mk(0x8a5e34, 0.8);
  const brass = mk(0xc6a24a, 0.4, 0.6);
  const iron = mk(0x39332b, 0.5, 0.5);
  const lacquer = mk(0x161418, 0.28, 0.2);
  const ivory = mk(0xeee6d2, 0.5);
  const blackKey = mk(0x121013, 0.4);
  const bark = mk(0x6a4a32, 0.9);
  const soil = mk(0x3a2c20, 1);
  const leafMats = [0x4f7a34, 0x5d8f3a, 0x6f9a44, 0x42692c].map((c) => mk(c, 0.82));
  const fabricMats = {
    rose: mk(0x7d4a52, 0.95), teal: mk(0x3f5f6a, 0.95), plum: mk(0x6a4f6e, 0.95), ochre: mk(0x8a6a3a, 0.95),
  };
  const cushion = mk(0xe7dcc6, 0.95);
  const bookMats = BOOK_COLS.map((c) => mk(c, 0.8));
  const emberMat = mk(0xff6a2a, 0.5, 0, { emissive: 0xff5a1e, emissiveIntensity: 1.0 });
  const flameMat = mk(0xffce86, 0.4, 0, { emissive: 0xff9a3c, emissiveIntensity: 1.7 });
  const waterMat = mk(0x5ab0e0, 0.2, 0.1, { transparent: true, opacity: 0.8, emissive: 0x2f7fae, emissiveIntensity: 0.3 });

  // ---------------------------------------------------------------- geometry
  const planterGeo = G(new THREE.BoxGeometry(0.34, 0.26, 0.34));
  const planterRimGeo = G(new THREE.BoxGeometry(0.4, 0.08, 0.4));
  const soilGeo = G(new THREE.BoxGeometry(0.32, 0.05, 0.32));
  const treeTrunkGeo = G(new THREE.CylinderGeometry(0.05, 0.075, 0.42, 7));
  const foliageGeo = G(new THREE.IcosahedronGeometry(0.25, 1));
  const pedBaseGeo = G(new THREE.BoxGeometry(0.5, 0.16, 0.5));
  const pedShaftGeo = G(new THREE.BoxGeometry(0.42, 0.46, 0.42));
  const pedCapGeo = G(new THREE.BoxGeometry(0.54, 0.1, 0.54));
  const robeGeo = G(new THREE.CylinderGeometry(0.12, 0.26, 0.6, 14));
  const shoulderGeo = G(new THREE.SphereGeometry(0.16, 14, 12));
  const headGeo = G(new THREE.SphereGeometry(0.12, 14, 12));
  const torchBaseGeo = G(new THREE.CylinderGeometry(0.13, 0.2, 0.1, 12));
  const torchKnopGeo = G(new THREE.SphereGeometry(0.06, 10, 8));
  const poleGeo = G(new THREE.CylinderGeometry(0.035, 0.05, 1.15, 8));
  const cupGeo = G(new THREE.CylinderGeometry(0.13, 0.05, 0.12, 12));
  const flameGeo = G(new THREE.ConeGeometry(0.1, 0.32, 8));
  const caseGeo = G(new THREE.BoxGeometry(0.8, 1.55, 0.32));
  const shelfGeo = G(new THREE.BoxGeometry(0.74, 0.04, 0.28));
  const bookGeo = G(new THREE.BoxGeometry(0.07, 1, 0.2));
  const sofaSeatGeo = G(new THREE.BoxGeometry(0.92, 0.2, 0.5));
  const sofaBackGeo = G(new THREE.BoxGeometry(0.92, 0.42, 0.13));
  const sofaArmGeo = G(new THREE.BoxGeometry(0.13, 0.34, 0.52));
  const cushGeo = G(new THREE.BoxGeometry(0.4, 0.14, 0.42));
  const chSeatGeo = G(new THREE.BoxGeometry(0.5, 0.2, 0.48));
  const chBackGeo = G(new THREE.BoxGeometry(0.5, 0.4, 0.12));
  const chArmGeo = G(new THREE.BoxGeometry(0.12, 0.3, 0.46));
  const ctTopGeo = G(new THREE.BoxGeometry(0.74, 0.08, 0.5));
  const ctLegGeo = G(new THREE.BoxGeometry(0.06, 0.32, 0.06));
  const rtTopGeo = G(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16));
  const rtLegGeo = G(new THREE.CylinderGeometry(0.05, 0.07, 0.34, 8));
  const rtFootGeo = G(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 12));
  const seatLegGeo = G(new THREE.BoxGeometry(0.05, 0.32, 0.05));
  const pianoBodyGeo = G(new THREE.BoxGeometry(1.15, 0.26, 0.78));
  const pianoWingGeo = G(new THREE.CylinderGeometry(0.39, 0.39, 0.26, 20, 1, false, 0, Math.PI));
  const pianoLidGeo = G(new THREE.BoxGeometry(1.12, 0.04, 0.5));
  const lidPropGeo = G(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6));
  const pianoLegGeo = G(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 8));
  const kbGeo = G(new THREE.BoxGeometry(0.92, 0.07, 0.15));
  const blackKeyGeo = G(new THREE.BoxGeometry(0.025, 0.022, 0.09));
  const benchSeatGeo = G(new THREE.BoxGeometry(0.5, 0.06, 0.2));
  const benchLegGeo = G(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 6));
  const fireSideGeo = G(new THREE.BoxGeometry(0.3, 1.02, 0.5));
  const fireLintelGeo = G(new THREE.BoxGeometry(1.4, 0.32, 0.5));
  const fireHearthGeo = G(new THREE.BoxGeometry(1.5, 0.14, 0.64));
  const fireInnerGeo = G(new THREE.BoxGeometry(0.82, 0.72, 0.18));
  const emberGeo = G(new THREE.IcosahedronGeometry(0.09, 0));
  const fnBasinGeo = G(new THREE.CylinderGeometry(1.08, 1.22, 0.32, 28));
  const fnStepGeo = G(new THREE.CylinderGeometry(1.18, 1.3, 0.12, 28));
  const fnWaterLoGeo = G(new THREE.CircleGeometry(0.98, 28));
  const fnPedGeo = G(new THREE.CylinderGeometry(0.2, 0.3, 0.55, 16));
  const fnBowlGeo = G(new THREE.CylinderGeometry(0.44, 0.26, 0.14, 20));
  const fnWaterHiGeo = G(new THREE.CircleGeometry(0.38, 20));
  const fnFinialGeo = G(new THREE.SphereGeometry(0.1, 12, 10));
  const fnStreamGeo = G(new THREE.CylinderGeometry(0.025, 0.04, 0.5, 8));

  const add = (g, geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const b = new THREE.Mesh(geo, m);
    b.position.set(x, y, z);
    b.scale.set(sx, sy, sz);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    return b;
  };
  const leafOf = (h) => leafMats[(h * leafMats.length) | 0];

  // ----------------------------------------------------------------- rugs
  const rug = (w, h, color, x, z, y = 0.115) => {
    const m = mk(color, 0.96);
    const mesh = new THREE.Mesh(G(new THREE.PlaneGeometry(w, h)), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  // The upper half is now a BARE MAZE (no rugs/props up there) — all decoration
  // lives in the PALACE on the bottom half, where the agents start.
  rug(6.6, 3.8, 0x6e4150, 9.5, 15.2, 0.113);   // central palace-hall rug
  rug(7, 3.0, 0x6a4a2c, 9.5, 18.2, 0.118);     // dining rug
  for (const spawn of [world.redSpawn, world.blueSpawn]) {
    if (!spawn) continue;
    const { x, z } = cellToWorld(spawn[0], spawn[1]);
    rug(1.6, 1.6, 0x3f5f86, x, z, 0.12);
  }
  for (const [r, c, col] of [[14, 2, 0x7a3b46], [18, 2, 0x4a5f7a], [14, 17, 0x7a3b46], [18, 17, 0x4a5f7a]]) {
    const { x, z } = cellToWorld(r, c);
    rug(2.4, 2.4, col, x, z, 0.114);
  }

  // ----------------------------------------------------------- prop builders
  function tree(g, h) {
    add(g, planterGeo, stoneGrey, 0, FLOOR_Y + 0.13, 0);
    add(g, planterRimGeo, stoneDark, 0, FLOOR_Y + 0.26, 0);
    add(g, soilGeo, soil, 0, FLOOR_Y + 0.27, 0);
    add(g, treeTrunkGeo, bark, 0, FLOOR_Y + 0.47, 0);
    add(g, foliageGeo, leafOf(h), 0, FLOOR_Y + 0.84, 0, 1.05, 1.1, 1.05);
    add(g, foliageGeo, leafOf(hash(h, 2)), 0.13, FLOOR_Y + 0.66, 0.04, 0.72, 0.72, 0.72);
    add(g, foliageGeo, leafOf(hash(h, 5)), -0.12, FLOOR_Y + 0.7, -0.08, 0.66, 0.66, 0.66);
  }

  function torchere(g, h, opt) {
    add(g, torchBaseGeo, iron, 0, FLOOR_Y + 0.05, 0);
    add(g, torchKnopGeo, brass, 0, FLOOR_Y + 0.12, 0);
    add(g, poleGeo, iron, 0, FLOOR_Y + 0.68, 0);
    add(g, cupGeo, brass, 0, FLOOR_Y + 1.24, 0);
    const fl = add(g, flameGeo, flameMat, 0, FLOOR_Y + 1.42, 0);
    fl.castShadow = false;
    fl.renderOrder = 4;
    let light = null;
    if (opt && opt.light) {
      light = new THREE.PointLight(0xffb060, 1.1, 5.5, 2);
      light.position.set(0, FLOOR_Y + 1.42, 0);
      g.add(light);
    }
    flames.push({ mesh: fl, light, phase: h * 6.28 });
  }

  function statue(g, h) {
    add(g, pedBaseGeo, stoneDark, 0, FLOOR_Y + 0.08, 0);
    add(g, pedShaftGeo, stoneGrey, 0, FLOOR_Y + 0.39, 0);
    add(g, pedCapGeo, stoneDark, 0, FLOOR_Y + 0.67, 0);
    const baseY = FLOOR_Y + 0.72;
    add(g, robeGeo, marble, 0, baseY + 0.3, 0);
    add(g, shoulderGeo, marble, 0, baseY + 0.58, 0.01, 1, 0.8, 0.85);
    add(g, headGeo, marble, 0, baseY + 0.78, 0.02);
  }

  function bookcase(g, h) {
    add(g, caseGeo, woodD, 0, FLOOR_Y + 0.78, 0);
    for (let i = 0; i < 4; i++) {
      const y = FLOOR_Y + 0.3 + i * 0.36;
      add(g, shelfGeo, woodM, 0, y, 0);
      for (let b = -0.33; b < 0.34; b += 0.082) {
        const bh = 0.2 + hash(b * 17, i) * 0.1;
        const bm = bookMats[Math.abs(Math.round(b * 50 + i * 11)) % bookMats.length];
        add(g, bookGeo, bm, b, y + 0.02 + bh / 2, 0.02, 1, bh, 1);
      }
    }
  }

  function sofa(g, h, opt) {
    const fab = fabricMats[(opt && opt.color) || 'teal'];
    add(g, sofaSeatGeo, fab, 0, FLOOR_Y + 0.22, 0);
    add(g, sofaBackGeo, fab, 0, FLOOR_Y + 0.43, -0.18);
    for (const sx of [-0.46, 0.46]) add(g, sofaArmGeo, fab, sx, FLOOR_Y + 0.34, 0);
    for (const sx of [-0.24, 0.24]) add(g, cushGeo, cushion, sx, FLOOR_Y + 0.34, 0.02);
    for (const sx of [-0.4, 0.4]) for (const sz of [-0.2, 0.2])
      add(g, seatLegGeo, woodD, sx, FLOOR_Y + 0.06, sz, 0.8, 0.4, 0.8);
  }

  function achair(g, h, opt) {
    const fab = fabricMats[(opt && opt.color) || 'rose'];
    add(g, chSeatGeo, fab, 0, FLOOR_Y + 0.22, 0);
    add(g, chBackGeo, fab, 0, FLOOR_Y + 0.42, -0.18);
    for (const sx of [-0.25, 0.25]) add(g, chArmGeo, fab, sx, FLOOR_Y + 0.32, 0);
    add(g, cushGeo, cushion, 0, FLOOR_Y + 0.34, 0.02, 0.9, 1, 0.9);
    for (const sx of [-0.2, 0.2]) for (const sz of [-0.18, 0.18])
      add(g, seatLegGeo, woodD, sx, FLOOR_Y + 0.06, sz, 0.8, 0.4, 0.8);
  }

  function chair(g, h) {
    add(g, chSeatGeo, woodM, 0, FLOOR_Y + 0.3, 0, 0.7, 0.6, 0.7);
    add(g, chBackGeo, woodM, 0, FLOOR_Y + 0.52, -0.13, 0.7, 1, 1);
    for (const sx of [-0.13, 0.13]) for (const sz of [-0.13, 0.13])
      add(g, seatLegGeo, woodD, sx, FLOOR_Y + 0.15, sz, 0.9, 0.95, 0.9);
  }

  function ctable(g, h) {
    add(g, ctTopGeo, woodL, 0, FLOOR_Y + 0.36, 0);
    for (const sx of [-0.3, 0.3]) for (const sz of [-0.18, 0.18])
      add(g, ctLegGeo, woodD, sx, FLOOR_Y + 0.18, sz);
  }

  function rtable(g, h) {
    add(g, rtFootGeo, woodD, 0, FLOOR_Y + 0.04, 0);
    add(g, rtLegGeo, woodM, 0, FLOOR_Y + 0.22, 0);
    add(g, rtTopGeo, woodL, 0, FLOOR_Y + 0.41, 0);
  }

  function bench(g, h) {
    add(g, benchSeatGeo, woodD, 0, FLOOR_Y + 0.4, 0);
    for (const sx of [-0.2, 0.2]) for (const sz of [-0.06, 0.06])
      add(g, benchLegGeo, woodM, sx, FLOOR_Y + 0.2, sz);
  }

  function piano(g, h) {
    add(g, pianoBodyGeo, lacquer, 0, FLOOR_Y + 0.55, 0);
    add(g, pianoWingGeo, lacquer, -0.575, FLOOR_Y + 0.55, 0).rotation.y = -Math.PI / 2;
    // open lid, propped at the back
    const lid = add(g, pianoLidGeo, lacquer, 0.05, FLOOR_Y + 0.72, -0.16);
    lid.rotation.x = -0.42;
    add(g, lidPropGeo, brass, -0.4, FLOOR_Y + 0.78, -0.28).rotation.x = 0.2;
    for (const [lx, lz] of [[-0.5, 0.32], [0.5, 0.32], [0.0, -0.3]])
      add(g, pianoLegGeo, lacquer, lx, FLOOR_Y + 0.27, lz);
    // keyboard
    add(g, kbGeo, ivory, 0, FLOOR_Y + 0.44, 0.45);
    for (let i = -5; i <= 5; i++) add(g, blackKeyGeo, blackKey, i * 0.08, FLOOR_Y + 0.49, 0.42);
  }

  function fire(g, h) {
    for (const sx of [-0.55, 0.55]) add(g, fireSideGeo, stoneGrey, sx, FLOOR_Y + 0.51, 0);
    add(g, fireLintelGeo, stoneGrey, 0, FLOOR_Y + 0.86, 0);
    add(g, fireHearthGeo, stoneDark, 0, FLOOR_Y + 0.07, 0.06);
    add(g, fireInnerGeo, mk(0x140f0c, 1), 0, FLOOR_Y + 0.46, -0.12);
    for (let i = 0; i < 5; i++)
      add(g, emberGeo, emberMat, (hash(i, h) - 0.5) * 0.55, FLOOR_Y + 0.16, 0.02, 1, 0.7, 1).castShadow = false;
    const light = new THREE.PointLight(0xff7a36, 1.2, 4.5, 2);
    light.position.set(0, FLOOR_Y + 0.4, 0.3);
    g.add(light);
    fires.push({ light, phase: h * 6.28 });
  }

  function fountain(g, h) {
    add(g, fnStepGeo, stoneDark, 0, FLOOR_Y + 0.06, 0);
    add(g, fnBasinGeo, stoneGrey, 0, FLOOR_Y + 0.28, 0);
    const w1 = add(g, fnWaterLoGeo, waterMat, 0, FLOOR_Y + 0.4, 0);
    w1.rotation.x = -Math.PI / 2;
    w1.castShadow = w1.receiveShadow = false;
    add(g, fnPedGeo, stoneGrey, 0, FLOOR_Y + 0.68, 0);
    add(g, fnBowlGeo, stoneDark, 0, FLOOR_Y + 0.95, 0);
    const w2 = add(g, fnWaterHiGeo, waterMat, 0, FLOOR_Y + 1.02, 0);
    w2.rotation.x = -Math.PI / 2;
    w2.castShadow = w2.receiveShadow = false;
    add(g, fnFinialGeo, brass, 0, FLOOR_Y + 1.14, 0);
    const stream = add(g, fnStreamGeo, waterMat, 0, FLOOR_Y + 0.74, 0);
    stream.castShadow = false;
    waters.push({ bob: stream, phase: h * 6.28 });
  }

  const BUILDERS = { tree, torchere, statue, bookcase, sofa, achair, chair, ctable, rtable, bench, piano, fire, fountain };

  // ----------------------------------------------------- authored placements
  // [type, x, z, rotationY, options?]   (x = west→east, z = north→south)
  const PI = Math.PI;
  const ITEMS = [
    // The furnished obstacle pieces (grand piano, library shelves, sofa, armchairs)
    // are real blockers and live in furniture.js. Here we only add the standing
    // lamps that light the palace hall and potted topiary in the corners.
    ['torchere', 6.6, 15.4, 0, { light: true }], ['torchere', 12.4, 15.4, 0, { light: true }],
    ['torchere', 6.6, 18.6, 0, { light: true }], ['torchere', 12.4, 18.6, 0, { light: true }],
    ['tree', 0.7, 15.4, 0], ['tree', 19.3, 15.4, 0], ['tree', 0.7, 17.7, 0], ['tree', 19.3, 17.7, 0],
  ];

  for (const [type, x, z, ry, opt] of ITEMS) {
    const g = new THREE.Group();
    BUILDERS[type](g, hash(x + 1, z + 1), opt);
    g.position.set(x, 0, z);
    g.rotation.y = ry || 0;
    if (opt && opt.s) g.scale.setScalar(opt.s);
    group.add(g);
  }

  // ----------------------------------------- wall hangings on the maze + palace
  // Paintings, woven tapestries and lit sconces mounted on the stone walls so the
  // maze and rooms read as real walls instead of bare plaster.
  const frameGeo = G(new THREE.BoxGeometry(0.5, 0.62, 0.04));
  const skyGeo = G(new THREE.PlaneGeometry(0.42, 0.34));
  const groundGeo = G(new THREE.PlaneGeometry(0.42, 0.22));
  const tapGeo = G(new THREE.PlaneGeometry(0.5, 1.0));
  const tapBandGeo = G(new THREE.PlaneGeometry(0.5, 0.1));
  const emblemGeo = G(new THREE.PlaneGeometry(0.14, 0.14));
  const bracketGeo = G(new THREE.BoxGeometry(0.1, 0.12, 0.14));
  const art = (c) => mk(c, 0.9, 0, { emissive: c, emissiveIntensity: 0.12 });
  const skyMats = [0x84a9d4, 0xcd9a63, 0x6f8fae, 0xb98f7a].map(art);
  const groundMats = [0x5d7a3a, 0x8a6a3a, 0x46707e, 0x6a5a3a].map(art);
  const tapMats = [0x7a2f3a, 0x2f4f7a, 0x3a6a4a, 0x6a3a6a].map(art);
  const mountY = FLOOR_Y + 0.85;
  const pick = (arr, h) => arr[(h * arr.length) | 0];

  function painting(parent, h) {
    add(parent, frameGeo, brass, 0, mountY, 0.03);
    const sky = new THREE.Mesh(skyGeo, pick(skyMats, h)); sky.position.set(0, mountY + 0.12, 0.056); parent.add(sky);
    const gnd = new THREE.Mesh(groundGeo, pick(groundMats, hash(h, 9))); gnd.position.set(0, mountY - 0.16, 0.056); parent.add(gnd);
  }
  function tapestry(parent, h) {
    const cloth = new THREE.Mesh(tapGeo, pick(tapMats, h)); cloth.position.set(0, FLOOR_Y + 0.78, 0.04); parent.add(cloth);
    const band = new THREE.Mesh(tapBandGeo, brass); band.position.set(0, FLOOR_Y + 1.06, 0.05); parent.add(band);
    const em = new THREE.Mesh(emblemGeo, brass); em.position.set(0, FLOOR_Y + 0.74, 0.05); em.rotation.z = Math.PI / 4; parent.add(em);
  }
  function sconce(parent, h) {
    add(parent, bracketGeo, iron, 0, FLOOR_Y + 0.92, 0.05);
    add(parent, cupGeo, brass, 0, FLOOR_Y + 1.0, 0.12, 0.7, 0.7, 0.7);
    const fl = add(parent, flameGeo, flameMat, 0, FLOOR_Y + 1.14, 0.12, 0.8, 0.8, 0.8);
    fl.castShadow = false; fl.renderOrder = 4;
    const light = new THREE.PointLight(0xffb060, 0.9, 4.2, 2);
    light.position.set(0, FLOOR_Y + 1.1, 0.28);
    parent.add(light);
    flames.push({ mesh: fl, light, phase: h * 6.28 });
  }

  {
    const wr = world.rows, WH = wr.length, WW = wr[0].length;
    const fset = new Set((world.furniture || []).map((f) => `${f.cell[0]},${f.cell[1]}`));
    const isWall = (r, c) => r >= 0 && c >= 0 && r < WH && c < WW && wr[r][c] === '#' && !fset.has(`${r},${c}`);
    const isFloor = (r, c) => r >= 0 && c >= 0 && r < WH && c < WW && wr[r][c] !== '#';
    let lights = 0;
    const MAX_SCONCE_LIGHTS = 6;
    for (let r = 0; r < WH; r++) for (let c = 0; c < WW; c++) {
      if (!isWall(r, c)) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (!isFloor(r + dr, c + dc)) continue;            // an exposed wall face
        const hv = hash(r * 23 + c * 7, dr * 11 + dc * 5 + 4);
        if (hv < 0.6) continue;                            // ~40% of faces decorated
        const g = new THREE.Group();
        g.position.set(c + 0.5 + dc * 0.49, 0, r + 0.5 + dr * 0.49);
        g.rotation.y = Math.atan2(dc, dr);                 // face the floor cell
        let kind = hv < 0.72 ? 'sconce' : hv < 0.87 ? 'painting' : 'tapestry';
        if (kind === 'sconce' && lights >= MAX_SCONCE_LIGHTS) kind = 'painting';
        if (kind === 'sconce') { sconce(g, hv); lights++; }
        else if (kind === 'painting') painting(g, hv);
        else tapestry(g, hv);
        group.add(g);
      }
    }
  }

  // -------------------------------------------------- the gold-dropping trap rune
  const runes = [];
  const runeRingGeo = G(new THREE.RingGeometry(0.26, 0.42, 24));
  const runeBarGeo = G(new THREE.BoxGeometry(0.5, 0.04, 0.07));
  const spikeGeo = G(new THREE.ConeGeometry(0.05, 0.16, 6));
  const runeMat = mk(0xff7a1e, 0.5, 0, { emissive: 0xff5a14, emissiveIntensity: 1.1 });
  const runeGlowMat = mk(0xff6a1e, 1, 0, { transparent: true, opacity: 0.4 });
  runeGlowMat.side = THREE.DoubleSide;
  runeGlowMat.blending = THREE.AdditiveBlending;
  runeGlowMat.depthWrite = false;
  for (const [r, c] of world.dropTraps || []) {
    const { x, z } = cellToWorld(r, c);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const ring = new THREE.Mesh(runeRingGeo, runeGlowMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.135; g.add(ring);
    const spin = new THREE.Group(); spin.position.y = 0.14;
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(runeBarGeo, runeMat); b.rotation.y = i * Math.PI / 4; b.castShadow = false; spin.add(b); }
    g.add(spin);
    const halo = new THREE.Group(); halo.position.y = 0.14;
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(spikeGeo, runeMat); const a = (i / 6) * Math.PI * 2; s.position.set(Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34); s.castShadow = false; halo.add(s); }
    g.add(halo);
    const light = new THREE.PointLight(0xff5a1e, 0.9, 3.2, 2); light.position.set(0, 0.5, 0); g.add(light);
    group.add(g);
    runes.push({ spin, halo, light });
  }

  // -------------------------------------------------------------- animation
  function update(t) {
    for (const fl of flames) {
      const f = 0.82 + 0.18 * Math.sin(t * 11 + fl.phase) + 0.1 * Math.sin(t * 23 + fl.phase * 1.7);
      fl.mesh.scale.set(0.9 + 0.2 * f, f, 0.9 + 0.2 * f);
      if (fl.light) fl.light.intensity = 0.8 + f * 0.7;
    }
    for (const fr of fires) {
      const f = 0.7 + 0.3 * Math.sin(t * 8 + fr.phase) + 0.14 * Math.sin(t * 19 + fr.phase * 1.5);
      fr.light.intensity = 0.7 + f * 0.9;
    }
    emberMat.emissiveIntensity = 0.8 + 0.3 * Math.sin(t * 7);
    waterMat.emissiveIntensity = 0.25 + 0.12 * Math.sin(t * 2.4);
    for (const w of waters) w.bob.scale.y = 0.85 + 0.18 * Math.sin(t * 3.5 + w.phase);
    for (const ru of runes) {
      ru.spin.rotation.y += 0.02;
      ru.halo.position.y = 0.14 + 0.04 * Math.sin(t * 3);
      ru.light.intensity = 0.5 + 0.4 * Math.sin(t * 4);
    }
    runeMat.emissiveIntensity = 0.9 + 0.4 * Math.sin(t * 5);
    runeGlowMat.opacity = 0.3 + 0.2 * Math.sin(t * 5);
  }

  function dispose() {
    scene.remove(group);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  }

  return { group, update, dispose };
}
