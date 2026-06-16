import * as THREE from 'three';
import { cellToWorld } from './layout.js';

// Procedural storybook furniture that fills the bedroom mazes and the dining hall.
// Each blocked "furniture" cell (from world.furniture) gets a piece here; the
// architecture module renders the remaining structural cells as plaster walls.
//
// GLTF HOOK (the "hybrid" path): drop a model at game/textures/models/<type>.glb
// and register it below (registerModel('bed','textures/models/bed.glb')). If a
// model is registered it is loaded via GLTFLoader and swapped in for that type;
// otherwise the procedural mesh is used. Nothing is registered by default, so the
// game runs fully procedurally with no extra files.

const FLOOR_Y = 0.16;
const MODELS = {}; // type -> url (empty by default)
export function registerModel(type, url) { MODELS[type] = url; }

const WOOD_D = 0x5f4128, WOOD_M = 0x7d5230, WOOD_L = 0xa9794a;
const IRON = 0x3c352c;
const BOOK_COLS = [0x8c3b3b, 0x36617a, 0x3f7050, 0xb08a3a, 0x6a4a7a, 0x9c5a2a];

function mat(color, rough = 0.85, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

// ----------------------------------------------------------- piece builders
function box(g, geo, m, x, y, z, sx = 1, sy = 1, sz = 1) {
  const b = new THREE.Mesh(geo, m);
  b.position.set(x, y, z);
  b.scale.set(sx, sy, sz);
  b.castShadow = b.receiveShadow = true;
  g.add(b);
  return b;
}

export function createFurniture(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const geos = [];
  const mats = [];
  const G = (g) => { geos.push(g); return g; };
  const M = (c, r, m) => { const x = mat(c, r, m); mats.push(x); return x; };

  // shared materials
  const woodD = M(WOOD_D, 0.85), woodM = M(WOOD_M, 0.85), woodL = M(WOOD_L, 0.8);
  const iron = M(IRON, 0.5, 0.4);
  const sheet = M(0xe9e2d2, 0.9), pillow = M(0xf4eee2, 0.95);
  const cloth = M(0x9c4452, 0.9);

  const put = (g, geo, material, x, y, z, sx = 1, sy = 1, sz = 1) => box(g, geo, material, x, y, z, sx, sy, sz);

  function bed() {
    const g = new THREE.Group();
    put(g, G(new THREE.BoxGeometry(0.74, 0.18, 0.92)), woodM, 0, FLOOR_Y + 0.12, 0);       // frame
    put(g, G(new THREE.BoxGeometry(0.66, 0.12, 0.8)), sheet, 0, FLOOR_Y + 0.27, 0.03);     // mattress
    put(g, G(new THREE.BoxGeometry(0.6, 0.08, 0.22)), pillow, 0, FLOOR_Y + 0.32, -0.3);    // pillow
    put(g, G(new THREE.BoxGeometry(0.62, 0.16, 0.5)), cloth, 0, FLOOR_Y + 0.29, 0.18);     // blanket
    put(g, G(new THREE.BoxGeometry(0.78, 0.5, 0.1)), woodD, 0, FLOOR_Y + 0.35, -0.44);     // headboard
    for (const sx of [-0.34, 0.34]) for (const sz of [-0.42, 0.42])
      put(g, G(new THREE.BoxGeometry(0.08, 0.2, 0.08)), woodD, sx, FLOOR_Y + 0.04, sz);    // legs
    return g;
  }
  function wardrobe() {
    const g = new THREE.Group();
    put(g, G(new THREE.BoxGeometry(0.74, 1.0, 0.42)), woodM, 0, FLOOR_Y + 0.5, 0);         // body
    put(g, G(new THREE.BoxGeometry(0.8, 0.1, 0.48)), woodD, 0, FLOOR_Y + 1.02, 0);         // cornice
    for (const sx of [-0.18, 0.18])
      put(g, G(new THREE.BoxGeometry(0.32, 0.86, 0.03)), woodL, sx, FLOOR_Y + 0.5, 0.22);  // doors
    for (const sx of [-0.05, 0.05])
      put(g, G(new THREE.SphereGeometry(0.03, 8, 6)), iron, sx, FLOOR_Y + 0.5, 0.25);      // knobs
    return g;
  }
  function bookshelf() {
    const g = new THREE.Group();
    put(g, G(new THREE.BoxGeometry(0.78, 1.05, 0.34)), woodD, 0, FLOOR_Y + 0.52, 0);       // case
    for (let i = 0; i < 3; i++) {
      const y = FLOOR_Y + 0.28 + i * 0.3;
      put(g, G(new THREE.BoxGeometry(0.72, 0.04, 0.3)), woodM, 0, y, 0);                   // shelf
      for (let b = -0.3; b < 0.32; b += 0.08) {                                            // books
        const h = 0.16 + (Math.abs((b * 13) % 1)) * 0.08;
        const bm = M(BOOK_COLS[Math.abs(Math.round(b * 50 + i * 7)) % BOOK_COLS.length], 0.8);
        put(g, G(new THREE.BoxGeometry(0.06, h, 0.22)), bm, b, y + 0.02 + h / 2, 0.02);
      }
    }
    return g;
  }
  function chest() {
    const g = new THREE.Group();
    put(g, G(new THREE.BoxGeometry(0.6, 0.34, 0.42)), woodM, 0, FLOOR_Y + 0.17, 0);        // body
    put(g, G(new THREE.BoxGeometry(0.62, 0.16, 0.44)), woodL, 0, FLOOR_Y + 0.4, 0);        // lid
    for (const sx of [-0.22, 0.22])
      put(g, G(new THREE.BoxGeometry(0.05, 0.5, 0.46)), iron, sx, FLOOR_Y + 0.26, 0);      // bands
    return g;
  }
  function chair() {
    const g = new THREE.Group();
    put(g, G(new THREE.BoxGeometry(0.34, 0.06, 0.34)), woodM, 0, FLOOR_Y + 0.34, 0);       // seat
    put(g, G(new THREE.BoxGeometry(0.34, 0.4, 0.05)), woodM, 0, FLOOR_Y + 0.55, -0.15);    // back
    for (const sx of [-0.13, 0.13]) for (const sz of [-0.13, 0.13])
      put(g, G(new THREE.BoxGeometry(0.05, 0.34, 0.05)), woodD, sx, FLOOR_Y + 0.17, sz);   // legs
    return g;
  }
  function table() {
    const g = new THREE.Group();
    put(g, G(new THREE.BoxGeometry(0.98, 0.1, 0.86)), woodL, 0, FLOOR_Y + 0.56, 0);        // top (spans cell)
    for (const sx of [-0.4, 0.4]) for (const sz of [-0.34, 0.34])
      put(g, G(new THREE.BoxGeometry(0.08, 0.56, 0.08)), woodD, sx, FLOOR_Y + 0.28, sz);   // legs
    // a little dining dressing
    put(g, G(new THREE.CylinderGeometry(0.12, 0.14, 0.03, 12)), M(0xd9cdb6, 0.6), 0.18, FLOOR_Y + 0.63, 0.12); // plate
    put(g, G(new THREE.CylinderGeometry(0.03, 0.035, 0.16, 8)), M(0xeae0c8, 0.5), -0.2, FLOOR_Y + 0.66, -0.1); // candle
    put(g, G(new THREE.SphereGeometry(0.03, 8, 6)), M(0xffcf6b, 0.4, 0).clone(), -0.2, FLOOR_Y + 0.75, -0.1);   // flame
    return g;
  }

  const BUILDERS = { bed, wardrobe, bookshelf, chest, chair, table };

  // place every piece
  const pieces = [];
  for (const f of world.furniture || []) {
    const builder = BUILDERS[f.type] || chest;
    const piece = builder();
    const { x, z } = cellToWorld(f.cell[0], f.cell[1]);
    piece.position.set(x, 0, z);
    piece.rotation.y = (f.rot || 0) * (Math.PI / 2);
    group.add(piece);
    pieces.push({ piece, type: f.type, x, z, rot: f.rot || 0 });
  }

  // GLTF hook: swap in any registered models asynchronously (none by default)
  (async () => {
    const need = pieces.filter((p) => MODELS[p.type]);
    if (!need.length) return;
    let GLTFLoader;
    try { ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')); }
    catch (e) { console.warn('GLTFLoader unavailable; keeping procedural furniture'); return; }
    const loader = new GLTFLoader();
    for (const p of need) {
      loader.load(MODELS[p.type], (gltf) => {
        const m = gltf.scene;
        m.position.set(p.x, FLOOR_Y, p.z);
        m.rotation.y = p.rot * (Math.PI / 2);
        m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        group.remove(p.piece);
        group.add(m);
      }, undefined, () => {/* keep procedural on error */});
    }
  })();

  function dispose() {
    scene.remove(group);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  }
  return { group, dispose };
}
