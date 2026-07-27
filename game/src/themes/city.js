// Round 2 — New Donk City, built as a Manhattan park block.
//
// The 20x20 RL grid is a central GREEN PLAZA (lawn + hedges + trees) sitting on
// the y=0 board plane where the actors, keys, gold and value heatmap live (see
// live.js / heatmap.js). Going outward from the board: a stone curb, a sidewalk
// ring (street trees + lamps), a ring road (lane lines + crosswalks), an outer
// sidewalk, then a dense tall NYC skyline wrapping all four sides.
//
// Nothing may cover the y=0 board surface: greenery only stands on wall ('#')
// cells, and every gameplay marker is a thin decal/low pedestal. Models come
// from the vendored New Donk City Collada pack in assets/models/city-newdonk
// (DJ_Fox11 / The Models Resource).

import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const GRID = 20;
const CTR = GRID / 2;
const ASSETS = './assets/models/city-newdonk/';
const MK_TEXTURES = './assets/textures/mushroom-kingdom/';

// Zone half-extents measured from the board centre (CTR,CTR). The board is
// [0,20] => half 10; each ring stacks outward from there.
const PARK_H = 10;     // board edge
const ISW_H = 11.0;    // inner sidewalk (1.0 wide)
const ROAD_H = 15.0;   // ring road outer edge (tight, 4-wide road)
const OSW_H = 16.0;    // outer sidewalk (1.0 wide)
const LAWN_TOP = 0.04; // raised park cell surface, kept below decals/heatmap
const LAWN_THICK = 0.055;

// Buildings used for the surrounding skyline (hashed). NOTE: this pack mislabels
// most models as Z_UP though they're authored Y-up, so prepare() resets the
// loader's auto rotation. Buildings 003 and 023 are the genuine Z-up facades and
// would tip over under that reset, so they're deliberately excluded.
const BUILDINGS = [
  'CityWorldHomeBuilding001.dae',
  'CityWorldHomeBuilding008.dae',
  'CityWorldHomeBuilding010.dae',
  'CityWorldHomeBuilding011.dae',
  'CityWorldHomeBuilding012.dae',
  'CityWorldHomeBuilding019.dae',
  'CityWorldHomeBuilding020.dae',
  'CityWorldHomeBuilding021.dae',
  'CityWorldHomeBuilding022.dae',
  'CityWorldHomeBuilding024.dae',
  'CityWorldHomeBuilding026.dae',
];

function hash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

export const city = {
  name: 'city',
  title: 'New Donk City',
  subtitle: 'Bustling Downtown Streets',
  // bright, saturated "New Donk City" sunny look: warm sun vs cool blue fill,
  // vivid sky, a gentle game-y bloom, punchy ACES exposure
  sky: ['#2f74d6', '#6fb0f3', '#cfe8ff'],
  fog: 0xccdff5,
  fogNear: 55,
  fogFar: 240,
  // ONE dominant sun + low ambient = real shadows and a lit/shadow side on
  // everything (the cure for "flat"). High ambient washes all of that out.
  hemi: [0x9fccff, 0xb59868, 0.55],
  sun: 0xfff0c6,
  sunIntensity: 3.3,
  fill: 0x88b0ff,
  fillIntensity: 0.22,
  exposure: 1.02,
  bloom: { strength: 0.0, radius: 0.3, threshold: 0.95 }, // no bloom/glow
  env: './assets/hdri/qwantani_noon_2k.hdr',
  envIntensity: 0.45,
  envBlur: 0.0,
  bgIntensity: 1.02,
  redName: 'Crimson',
  blueName: 'Cobalt',

  buildScene(scene, world, { renderer } = {}) {
    const group = new THREE.Group();
    scene.add(group);

    // ---- resource bookkeeping --------------------------------------------
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

    const rows = world.rows;
    const collada = new ColladaLoader();
    const texLoader = new THREE.TextureLoader();
    const protos = new Map();
    const maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
    let disposed = false;

    // ---- shared asset / material helpers ---------------------------------
    function assetTexture(name, repeatX = 1, repeatY = 1, color = true) {
      const tex = trackTexture(texLoader.load(ASSETS + name));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = maxAnisotropy;
      if (color) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    function textureAt(url, repeatX = 1, repeatY = 1, color = true) {
      const tex = trackTexture(texLoader.load(url));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = maxAnisotropy;
      if (color) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function pbr(prefix, repeatX, repeatY, fallbackColor) {
      return track(new THREE.MeshStandardMaterial({
        color: fallbackColor,
        map: assetTexture(`${prefix}_alb.png`, repeatX, repeatY),
        normalMap: assetTexture(`${prefix}_nrm.png`, repeatX, repeatY, false),
        roughnessMap: assetTexture(`${prefix}_rgh.png`, repeatX, repeatY, false),
        roughness: 0.92,
        metalness: 0,
      }));
    }

    const solid = (color, opts = {}) =>
      track(new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...opts }));

    const hashFloat = (a, b, salt = 0) =>
      ((hash(a * 97 + salt * 37, b * 131 + salt * 53) >>> 0) % 10000) / 10000;

    function disposeTree(root) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          for (const value of Object.values(mat)) {
            if (value?.isTexture) value.dispose();
          }
          mat.dispose?.();
        }
      });
    }

    function tuneMaterial(mat) {
      if (!mat) return track(new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.85 }));
      const m = mat.clone();
      if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace;
        m.map.anisotropy = maxAnisotropy;
        trackTexture(m.map);
      }
      if (m.normalMap) trackTexture(m.normalMap);
      if (m.roughnessMap) trackTexture(m.roughnessMap);
      if (m.alphaMap) {
        trackTexture(m.alphaMap);
        m.transparent = true;
        m.alphaTest = 0.18;
      }
      if (/leaf|flag|wire|fence|poster|graffiti/i.test(m.name || '')) {
        m.side = THREE.DoubleSide;
        m.transparent = true;
        m.alphaTest = Math.max(m.alphaTest || 0, 0.12);
      }
      if ('emissiveIntensity' in m) m.emissiveIntensity = Math.min(m.emissiveIntensity || 0, 0.4);
      if ('shininess' in m) m.shininess = Math.min(m.shininess || 30, 8);
      track(m);
      return m;
    }

    function prepare(asset, keepRotation) {
      const root = asset.scene;
      // This pack tags files Z_UP but authors MOST geometry Y-up, so the loader's
      // automatic Z_UP->Y_UP rotation tips them over; undo it. The taxi is a
      // genuine Z_UP model, so it passes keepRotation to keep the loader's upright.
      if (!keepRotation) root.rotation.set(0, 0, 0);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        track(o.geometry);
        o.material = Array.isArray(o.material)
          ? o.material.map(tuneMaterial)
          : tuneMaterial(o.material);
      });
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      root.userData.bounds = {
        cx: (box.min.x + box.max.x) * 0.5,
        cz: (box.min.z + box.max.z) * 0.5,
        minY: box.min.y,
        h: Math.max(0.001, box.max.y - box.min.y),
        w: Math.max(0.001, box.max.x - box.min.x),
        d: Math.max(0.001, box.max.z - box.min.z),
      };
      return root;
    }

    function loadModel(name, keepRotation) {
      if (!protos.has(name)) {
        protos.set(name, collada.loadAsync(ASSETS + name).then((asset) => {
          const proto = prepare(asset, keepRotation);
          if (disposed) disposeTree(proto);
          return proto;
        }).catch((err) => {
          console.warn(`Could not load ${name}`, err);
          return null;
        }));
      }
      return protos.get(name);
    }

    // Clone a model to (x,z), its base sitting on baseY. footprint fits the
    // larger XZ side (keeps proportions); height, when given, scales Y to size.
    function place(name, x, z, opts = {}) {
      loadModel(name).then((proto) => {
        if (disposed || !proto) return;
        const b = proto.userData.bounds;
        const inner = cloneSkinned(proto);
        inner.position.set(-b.cx, -b.minY, -b.cz);

        let sx, sy, sz;
        if (opts.footprint != null) {
          sx = sz = opts.footprint / Math.max(b.w, b.d);
          sy = opts.height != null ? opts.height / b.h : sx;
        } else if (opts.fitXZ != null) {
          sx = opts.fitXZ / b.w;
          sz = opts.fitXZ / b.d;
          sy = opts.height != null ? opts.height / b.h : Math.min(sx, sz);
        } else if (opts.height != null) {
          sx = sy = sz = opts.height / b.h;
        } else {
          sx = sy = sz = opts.scale ?? 1;
        }

        const wrap = new THREE.Group();
        wrap.add(inner);
        wrap.scale.set(sx, sy, sz);
        wrap.rotation.y = opts.ry ?? 0;
        wrap.position.set(x, opts.baseY ?? 0, z);
        group.add(wrap);
      });
    }

    // ---- materials -------------------------------------------------------
    const asphaltMat = pbr('BaseAsphaltRoad01', 16, 16, 0x3a3c40);
    const apronMat = pbr('BaseAsphaltRoad01', 50, 50, 0x2b2d31);
    // Textured paver sidewalk (SideWalk01 albedo + normal, constant roughness so
    // the pack's glossy roughness map doesn't catch the sun as a sheen). repX/repZ
    // are set PER PIECE so the paver tiles stay one consistent square size on
    // every walk — inner ring and outer band match instead of stretching.
    const WALK_TILE = 2.0;   // world size of one paver tile
    const walkMat = (repX, repZ) => track(new THREE.MeshStandardMaterial({
      map: assetTexture('SideWalk01_alb.png', repX, repZ),
      normalMap: assetTexture('SideWalk01_nrm.png', repX, repZ, false),
      roughness: 1.0, metalness: 0,
    }));
    // grass-tile board (the green squares) — Mushroom-Kingdom soil in the seams,
    // GroundLawn tops with per-cell green tints
    const soilMat = track(new THREE.MeshStandardMaterial({
      map: textureAt(`${MK_TEXTURES}groundbasesoil02_alb.png`, 7, 7),
      normalMap: textureAt(`${MK_TEXTURES}groundbasesoil02_nrm.png`, 7, 7, false),
      color: 0xc6a279, roughness: 1, metalness: 0,
    }));
    const lawnTileTex = assetTexture('GroundLawn00_alb.png', 1.25, 1.25);
    const lawnTopMats = [
      0xb7df7e, 0xaed76f, 0xc2e78d, 0xa4cf67, 0xbce287, 0x9fca62,
    ].map((color) => track(new THREE.MeshStandardMaterial({
      map: lawnTileTex, color, roughness: 1, metalness: 0,
    })));
    const lawnEdgeMats = [
      0x638a39, 0x587f33, 0x6f9342, 0x4f7530,
    ].map((color) => solid(color, { roughness: 1 }));

    // Rounded hedge masses for wall cells. The old repeated cone-bush model read
    // like a stamp grid from the fixed camera, so the hedge is built from varied
    // ellipsoid leaf lobes instead.
    const shrubTex = textureAt(`${MK_TEXTURES}shrubberyplants00_alb.png`, 1.8, 1.8);
    const shrubNrm = textureAt(`${MK_TEXTURES}shrubberyplants00_nrm.png`, 1.8, 1.8, false);
    const shrubRgh = textureAt(`${MK_TEXTURES}shrubberyplants00_rgh.png`, 1.8, 1.8, false);
    const shrubMaterial = (color, roughness = 0.94) => track(new THREE.MeshStandardMaterial({
      map: shrubTex,
      normalMap: shrubNrm,
      roughnessMap: shrubRgh,
      color,
      roughness,
      metalness: 0,
    }));
    const shrubMats = [
      shrubMaterial(0x65b947, 0.94),
      shrubMaterial(0x72c851, 0.92),
      shrubMaterial(0x568f3e, 0.97),
    ];

    // 3D cartoon water for slippery cells: the generated puddle blob EXTRUDED into
    // a low rounded bulge that stands out of the grass, skinned with a bright glossy
    // reflective water material (the cartoon look from the first version). Ripple
    // normals scroll in update().
    const waterNrm = textureAt(`${MK_TEXTURES}water00_nrm.png`, 2.2, 2.2, false);
    // a generated, seamless SOFT TURQUOISE water texture matched to the reference:
    // smooth, LOW-contrast turquoise with gentle diagonal ripples (two low-frequency
    // sines, smoothly blended — no busy banding). Tiled + slowly scrolled in update().
    function waterCanvas() {
      const S = 256;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = S;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(S, S);
      const d = img.data;
      const lo = [24, 78, 140], hi = [58, 128, 190];     // darker blue: base -> soft ripple
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const u = x / S, v = y / S;
          let n = 0.5
            + 0.30 * Math.sin(2 * Math.PI * (u + v))
            + 0.20 * Math.sin(2 * Math.PI * (2 * u - v) + 1.3);
          n = Math.max(0, Math.min(1, 0.5 + (n - 0.5) * 0.7));   // gentle, low contrast
          const i = (y * S + x) * 4;
          d[i] = lo[0] + (hi[0] - lo[0]) * n;
          d[i + 1] = lo[1] + (hi[1] - lo[1]) * n;
          d[i + 2] = lo[2] + (hi[2] - lo[2]) * n;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas;
    }
    const waterTex = trackTexture(new THREE.CanvasTexture(waterCanvas()));
    waterTex.colorSpace = THREE.SRGBColorSpace;
    waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
    waterTex.repeat.set(1.6, 1.6);
    waterTex.anisotropy = maxAnisotropy;
    const waterMat = track(new THREE.MeshStandardMaterial({
      color: 0xffffff, map: waterTex, transparent: true, opacity: 0.92,
      roughness: 0.3, metalness: 0.1, envMapIntensity: 0.5,
      emissive: 0x123a66, emissiveIntensity: 0.06,
      normalMap: waterNrm, normalScale: new THREE.Vector2(0.14, 0.14),
      depthWrite: false,
    }));
    // a smooth, generated puddle outline (gentle wobble — "the shape is good")
    function puddleShape(seed, scale = 1) {
      const s = new THREE.Shape();
      const rnd = (salt) => hashFloat(seed, salt, 211);
      const ph1 = rnd(1) * 6.283, ph2 = rnd(2) * 6.283;
      const radius = (0.34 + rnd(4) * 0.03) * scale;
      const rx = radius * (1.02 + (rnd(5) - 0.5) * 0.08);
      const ry = radius * (0.98 + (rnd(6) - 0.5) * 0.08);
      const n = 80;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        const w = 1 + 0.06 * Math.sin(t * 3 + ph1) + 0.035 * Math.sin(t * 5 + ph2);
        const x = Math.cos(t) * rx * w, y = Math.sin(t) * ry * w;
        if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
      }
      return s;
    }
    const lineMat = solid(0xe6c84a, { roughness: 0.6 });
    const whiteMat = solid(0xeef0ec, { roughness: 0.8 });

    // ---- ground: a sunken road with raised, curbed sidewalks (like real life)
    const ROAD_Y = -0.18;   // road sits below the walks (deeper curb)
    const WALK_TOP = 0.0;   // sidewalk surface (~curb height above the road)
    function ground(half, y, mat) {
      const m = new THREE.Mesh(track(new THREE.PlaneGeometry(half * 2, half * 2)), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(CTR, y, CTR);
      m.receiveShadow = true;
      group.add(m);
      return m;
    }
    // Rounded-rectangle walks (Extrude) so the block corners curve like a real
    // intersection. ExtrudeGeometry's top UVs are in world units, so a texture
    // repeat of 1/WALK_TILE gives square, consistent pavers on every piece.
    const drawRoundedRect = (ctx, half, r) => {
      const a = -half, b = half;
      ctx.moveTo(a + r, a);
      ctx.lineTo(b - r, a); ctx.quadraticCurveTo(b, a, b, a + r);
      ctx.lineTo(b, b - r); ctx.quadraticCurveTo(b, b, b - r, b);
      ctx.lineTo(a + r, b); ctx.quadraticCurveTo(a, b, a, b - r);
      ctx.lineTo(a, a + r); ctx.quadraticCurveTo(a, a, a + r, a);
    };
    function extrudeWalk(shape, top, thickness) {
      const geo = track(new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }));
      const m = new THREE.Mesh(geo, walkMat(1 / WALK_TILE, 1 / WALK_TILE));
      m.rotation.x = -Math.PI / 2;            // lay the XY shape flat, top face up
      m.position.set(CTR, top - thickness, CTR);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      return m;
    }
    // the green grass squares — one slightly-irregular extruded tile per cell
    function lawnCellShape(r, c) {
      const j = (salt, amp) => (hashFloat(r, c, salt) - 0.5) * amp;
      const half = 0.468 + hashFloat(r, c, 34) * 0.012;
      const left = -half + j(1, 0.018);
      const right = half + j(2, 0.018);
      const bottom = -half + j(3, 0.018);
      const top = half + j(4, 0.018);
      const cb = 0.045 + hashFloat(r, c, 5) * 0.035;
      const cr = 0.045 + hashFloat(r, c, 6) * 0.035;
      const ct = 0.045 + hashFloat(r, c, 7) * 0.035;
      const cl = 0.045 + hashFloat(r, c, 8) * 0.035;
      const pts = [
        [left + cb, bottom + j(9, 0.018)],
        [-0.16 + j(10, 0.045), bottom + j(11, 0.028)],
        [0.16 + j(12, 0.045), bottom + j(13, 0.028)],
        [right - cb, bottom + j(14, 0.018)],
        [right + j(15, 0.018), bottom + cr],
        [right + j(16, 0.028), -0.16 + j(17, 0.045)],
        [right + j(18, 0.028), 0.16 + j(19, 0.045)],
        [right + j(20, 0.018), top - cr],
        [right - ct, top + j(21, 0.018)],
        [0.16 + j(22, 0.045), top + j(23, 0.028)],
        [-0.16 + j(24, 0.045), top + j(25, 0.028)],
        [left + ct, top + j(26, 0.018)],
        [left + j(27, 0.018), top - cl],
        [left + j(28, 0.028), 0.16 + j(29, 0.045)],
        [left + j(30, 0.028), -0.16 + j(31, 0.045)],
        [left + j(32, 0.018), bottom + cl],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.Shape(pts);
    }

    function addLawnCells() {
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          const geo = track(new THREE.ExtrudeGeometry(lawnCellShape(r, c), {
            depth: LAWN_THICK,
            bevelEnabled: true,
            bevelSize: 0.012,
            bevelThickness: 0.008,
            bevelSegments: 1,
          }));
          const h = hash(r * 19 + 11, c * 23 + 5);
          const mesh = new THREE.Mesh(geo, [
            lawnTopMats[h % lawnTopMats.length],
            lawnEdgeMats[(h >>> 3) % lawnEdgeMats.length],
          ]);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(c + 0.5, LAWN_TOP - LAWN_THICK + hashFloat(r, c, 33) * 0.006, r + 0.5);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
      }
    }
    const CORNER = 0.6;                        // just a slight corner round
    ground(80, -0.30, apronMat);              // far district floor (below the road)
    ground(50, ROAD_Y, asphaltMat);           // road base (shows in the road ring)
    // outer walk: big square with a rounded hole on the road side (hole radius
    // keeps the road a constant width around the bend)
    const outerWalk = new THREE.Shape();
    drawRoundedRect(outerWalk, 50, 0);
    const roadHole = new THREE.Path();
    drawRoundedRect(roadHole, ROAD_H, 1.0);
    outerWalk.holes.push(roadHole);
    extrudeWalk(outerWalk, WALK_TOP, 0.22);
    // inner walk: a rounded square around the park
    const innerWalk = new THREE.Shape();
    drawRoundedRect(innerWalk, ISW_H, CORNER);
    extrudeWalk(innerWalk, WALK_TOP, 0.22);
    ground(PARK_H, 0.012, soilMat);           // soil base, visible in the grass-tile seams
    addLawnCells();                           // the green grass squares (one per cell)

    // road lane lines (a dashed square loop down the middle of the ring road)
    const RMID = (ISW_H + ROAD_H) / 2;        // 16.5 from centre
    const dashX = track(new THREE.BoxGeometry(1.2, 0.04, 0.16));
    const dashZ = track(new THREE.BoxGeometry(0.16, 0.04, 1.2));
    for (let t = -RMID + 3.5; t <= RMID - 3.5; t += 2.4) {   // stop short of the corners
      for (const s of [-1, 1]) {
        const a = new THREE.Mesh(dashX, lineMat);   // N / S runs
        a.position.set(CTR + t, ROAD_Y + 0.01, CTR + s * RMID);
        group.add(a);
        const b = new THREE.Mesh(dashZ, lineMat);   // E / W runs
        b.position.set(CTR + s * RMID, ROAD_Y + 0.01, CTR + t);
        group.add(b);
      }
    }

    // crosswalks across each side of the ring road, at the side mid-point
    const stripeX = track(new THREE.BoxGeometry(2.4, 0.05, 0.28));
    const stripeZ = track(new THREE.BoxGeometry(0.28, 0.05, 2.4));
    function crosswalk(cx, cz, vertical) {
      for (const o of [-1.4, -0.8, 0.8, 1.4]) {   // 2 + gap + 2 stripes
        const s = new THREE.Mesh(vertical ? stripeX : stripeZ, whiteMat);
        s.position.set(cx + (vertical ? 0 : o), ROAD_Y + 0.01, cz + (vertical ? o : 0));
        group.add(s);
      }
    }
    crosswalk(CTR, CTR - RMID, true);   // north
    crosswalk(CTR, CTR + RMID, true);   // south
    crosswalk(CTR - RMID, CTR, false);  // west
    crosswalk(CTR + RMID, CTR, false);  // east

    // ---- hedge maze: rounded leaf masses on every wall cell ---------------
    const mazeRows = world.rows || [];
    const plantSet = new Set((world.plants || []).map(([r, c]) => r * GRID + c));
    const wallCells = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        // hedges fill wall cells EXCEPT where a piranha plant stands (drawn below)
        if ((mazeRows[r] || '')[c] === '#' && !plantSet.has(r * GRID + c)) wallCells.push([r, c]);
      }
    }
    function addShrubMaze(cells) {
      const geo = track(new THREE.SphereGeometry(1, 18, 10));
      const lobes = shrubMats.map(() => []);
      const dummy = new THREE.Object3D();
      const recipes = [
        { lobes: 5, spread: 0.21, low: 0.23, high: 0.36, wide: 1.0, tall: 1.0 },
        { lobes: 5, spread: 0.23, low: 0.22, high: 0.34, wide: 1.06, tall: 0.94 },
        { lobes: 4, spread: 0.19, low: 0.25, high: 0.39, wide: 0.94, tall: 1.05 },
      ];

      const addLobe = (matIndex, x, z, sx, sy, sz, ry = 0) => {
        lobes[matIndex % lobes.length].push({ x, y: LAWN_TOP + sy + 0.02, z, sx, sy, sz, ry });
      };

      for (const [r, c] of cells) {
        const x = c + 0.5, z = r + 0.5;
        const seed = hash(r * 13 + 2, c * 11 + 4);
        const rot = (seed % 360) * Math.PI / 180;
        const recipe = recipes[seed % recipes.length];
        const cellScale = 0.95 + hashFloat(r, c, 71) * 0.12;
        const baseMat = seed % shrubMats.length;
        const centerLift = recipe.high * (0.94 + hashFloat(r, c, 72) * 0.12) * cellScale;

        addLobe(
          baseMat,
          x + (hashFloat(r, c, 131) - 0.5) * 0.04,
          z + (hashFloat(r, c, 137) - 0.5) * 0.04,
          0.3 * recipe.wide * cellScale,
          centerLift,
          0.3 * recipe.wide * cellScale,
          rot
        );

        for (let i = 0; i < recipe.lobes; i++) {
          const a = rot + i * (Math.PI * 2 / recipe.lobes) + (hashFloat(r, c, 75 + i) - 0.5) * 0.28;
          const d = recipe.spread * (0.82 + hashFloat(r, c, 79 + i) * 0.28);
          const lower = i % 2 === 0;
          addLobe(
            baseMat + (lower ? 2 : 1),
            x + Math.cos(a) * d,
            z + Math.sin(a) * d,
            (0.24 + hashFloat(r, c, 82 + i) * 0.06) * recipe.wide * cellScale,
            (lower ? recipe.low : recipe.high * 0.8) * (0.92 + hashFloat(r, c, 86 + i) * 0.14) * recipe.tall,
            (0.24 + hashFloat(r, c, 90 + i) * 0.06) * recipe.wide * cellScale,
            a
          );
        }
      }

      const placeInstances = (geometry, material, items, writeMatrix) => {
        if (!items.length) return;
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        items.forEach((item, i) => {
          writeMatrix(item);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      };
      lobes.forEach((items, i) => placeInstances(geo, shrubMats[i], items, (p) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.ry, 0);
        dummy.scale.set(p.sx, p.sy, p.sz);
      }));
    }
    if (wallCells.length) addShrubMaze(wallCells);

    // ---- slippery water + the goal (these sit on the grass) --------------
    for (const [r, c] of world.slipCells || []) {
      const cx = c + 0.5, cz = r + 0.5;
      const seed = hash(r * 17 + 3, c * 29 + 7) >>> 0;
      // the 3D water bulge: extrude the blob with a bevel -> a low rounded top that
      // stands out of the ground (kept short)
      const geo = track(new THREE.ExtrudeGeometry(puddleShape(seed, 1.0), {
        depth: 0.015, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.045, bevelSegments: 4,
      }));
      geo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geo, waterMat);
      water.position.set(cx, LAWN_TOP + 0.02, cz);
      water.renderOrder = 3;
      water.receiveShadow = true;
      group.add(water);
    }

    // ---- a spinning Power Star floating between the two goal cells --------
    let star = null;
    const starEsc = world.escape || [];
    if (starEsc.length) {
      let mx = 0, mz = 0;
      for (const [r, c] of starEsc) { mx += c + 0.5; mz += r + 0.5; }
      mx /= starEsc.length; mz /= starEsc.length;
      // PowerStar is genuinely Z_UP -> keep the loader's upright rotation
      loadModel('PowerStar.dae', true).then((proto) => {
        if (disposed || !proto) return;
        const b = proto.userData.bounds;
        const inner = cloneSkinned(proto);
        inner.position.set(-b.cx, -(b.minY + b.h / 2), -b.cz);   // centre at origin so it floats
        // model reads white -> golden-yellow BODY, but keep the EYES solid black
        // (the star has separate Shine__BodyMT and Shine__EyeMT meshes/materials)
        const bodyMats = [];
        inner.traverse((o) => {
          if (!o.isMesh) return;
          const isEye = /eye/i.test(o.name || '');
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (!m) continue;
            if (isEye) {
              m.map = null;
              m.color?.set?.(0x000000);
              m.emissive?.set?.(0x000000);
              if ('emissiveIntensity' in m) m.emissiveIntensity = 0;
            } else {
              m.color?.set?.(0xffd12a);
              m.emissive?.set?.(0xffb000);
              if ('emissiveIntensity' in m) m.emissiveIntensity = 0.25;
              bodyMats.push(m);
            }
            m.needsUpdate = true;
          }
        });
        const wrap = new THREE.Group();
        wrap.add(inner);
        wrap.scale.setScalar(0.95 / Math.max(b.w, b.h, b.d));
        wrap.position.set(mx, 1.0, mz);
        group.add(wrap);
        // "glow" = the star's own emissive gently pulsing + a faint warm light.
        // NO halo sprite (that read as a flat pasted-on disc).
        const glow = new THREE.PointLight(0xffd24a, 0.2, 4, 2);
        glow.position.set(mx, 1.0, mz);
        group.add(glow);
        star = { mesh: wrap, mats: bodyMats, light: glow, baseY: 1.0 };
      });
    }

    // ---- a few street lamps hugging the grid edge, axis-aligned (0/90),
    //      facing the road; none on the south/front side -------------------
    const lampR = PARK_H + 0.6;  // just off the grass, a touch toward the road
    const lampSides = [
      { dx: 0, dz: -1, ry: Math.PI },        // north
      { dx: -1, dz: 0, ry: -Math.PI / 2 },   // west
      { dx: 1, dz: 0, ry: Math.PI / 2 },     // east
    ];
    for (const t of [-6.5, 6.5]) {
      for (const s of lampSides) {
        const x = CTR + (s.dx ? s.dx * lampR : t);
        const z = CTR + (s.dz ? s.dz * lampR : t);
        place('CityWorldHomeStreetlight000.dae', x, z, { baseY: WALK_TOP - 0.01, height: 3.6, ry: s.ry });
      }
    }

    // ---- the surrounding NYC skyline: rows of buildings ------------------
    // Each ring is a hollow square whose building INNER FACES line up just
    // behind the outer sidewalk (centre = front + foot/2), so they read as a
    // continuous street wall and never sit on the road. Rows rise taller as
    // they recede. No jitter -> clean rows; corners aren't double-placed.
    const RINGS = [
      { front: OSW_H + 0.4, step: 7.5, hLo: 9,  hVar: 6,  foot: 7, skip: 0 },
      { front: OSW_H + 9,   step: 8.5, hLo: 15, hVar: 8,  foot: 7, skip: 6 },
      { front: OSW_H + 18,  step: 10,  hLo: 21, hVar: 12, foot: 8, skip: 4 },
    ];
    for (let ri = 0; ri < RINGS.length; ri++) {
      const { front, step, hLo, hVar, foot, skip } = RINGS[ri];
      const d = front + foot / 2;            // centre distance so fronts align
      const plots = [];
      for (let t = -d; t <= d + 0.01; t += step) {
        plots.push([CTR + t, CTR - d], [CTR + t, CTR + d]);     // N + S edges
      }
      for (let t = -d + step; t <= d - step + 0.01; t += step) {
        plots.push([CTR - d, CTR + t], [CTR + d, CTR + t]);     // W + E edges (no corners)
      }
      plots.forEach(([x, z], i) => {
        const h = hash(ri * 131 + i * 7, 808);
        if (skip && h % skip === 0) return;       // gaps = cross streets
        const height = hLo + (h % 5) / 4 * hVar + (h % 3) * 0.8;
        // face the park: each row turns its front toward the centre
        const dx = x - CTR, dz = z - CTR;
        const ry = Math.abs(dz) >= Math.abs(dx)
          ? (dz < 0 ? 0 : Math.PI)                  // north / south rows
          : (dx < 0 ? Math.PI / 2 : -Math.PI / 2);  // west / east rows
        place(BUILDINGS[h % BUILDINGS.length], x, z, {
          baseY: WALK_TOP - 0.02, footprint: foot, height, ry,
        });
      });
    }

    // ---- a few manholes set flush in the road lanes ----------------------
    const manR = RMID + 1.0;   // in the outer driving lane, off the centre line
    for (const [x, z] of [
      [CTR - manR, CTR + 4],   // west
      [CTR + manR, CTR - 4],   // east
    ]) {
      place('CityWorldHomeManhole000.dae', x, z, { baseY: ROAD_Y - 0.04, fitXZ: 1.0, ry: 0 });
    }

    // ---- a few trash cans on the outer sidewalk by the buildings ---------
    const propR = OSW_H - 0.55;
    for (let i = 0; i < 22; i++) {
      const h = hash(i * 53 + 13, 7001);
      const side = h % 4;
      if (side === 1) continue;                  // skip the south/front side
      if (h % 3 !== 0) continue;                 // sparse — only some spots get one (UNCHANGED)
      const along = (((h >> 2) % 1000) / 1000 - 0.5) * 2 * (OSW_H - 3);
      if (Math.abs(along) < 3.5) continue;        // near a crosswalk/entrance
      let x, z, ry;
      if (side === 0) { x = CTR + along; z = CTR - propR; ry = 0; }
      else if (side === 2) { x = CTR - propR; z = CTR + along; ry = Math.PI / 2; }
      else { x = CTR + propR; z = CTR + along; ry = -Math.PI / 2; }
      place('CityWorldHomeTrashBox000.dae', x, z, { baseY: WALK_TOP - 0.01, height: 0.9, ry });
      // garbage bags on the walk next to the can (offset along the sidewalk); some
      // spots get a single bag, some get a small stacked pile of 3 (2 + 1 on top)
      const tang = side === 0 ? [1, 0] : [0, 1];
      const perp = [tang[1], -tang[0]];
      const off = (h & 16) ? 0.7 : -0.7;
      const bx = x + tang[0] * off, bz = z + tang[1] * off;
      const bag = (ax, az, ay, salt) => place('BlowObjGarbageBag.dae', ax, az, {
        baseY: WALK_TOP - 0.02 + ay, height: 0.5, ry: ((h >> salt) % 8) * (Math.PI / 4),
      });
      // 2 bags on the ground; a 3rd resting on top ONLY on the right/East can
      bag(bx - tang[0] * 0.2, bz - tang[1] * 0.2, 0, 0);
      bag(bx + tang[0] * 0.2 + perp[0] * 0.06, bz + tang[1] * 0.2 + perp[1] * 0.06, 0, 3);
      if (side === 3) bag(bx + perp[0] * 0.04, bz + perp[1] * 0.04, 0.27, 6);   // side 3 = East = right
    }

    // ---- benches on the inner sidewalk, facing the park ------------------
    const benchR = PARK_H + 0.5;
    const benchSides = [
      [0, -1, Math.PI],       // north (rotated 180 to face the park)
      [-1, 0, -Math.PI / 2],  // west
      [1, 0, Math.PI / 2],    // east
    ];                         // (no bench on the south/front)
    for (const t of [-3.5, 3.5]) {
      for (const [dx, dz, ry] of benchSides) {
        const x = CTR + (dx ? dx * benchR : t);
        const z = CTR + (dz ? dz * benchR : t);
        place('CityWorldHomeBench000.dae', x, z, { baseY: WALK_TOP - 0.01, height: 0.6, ry });
      }
    }

    // traffic signals stand just before each crosswalk, nudged slightly inward
    // from the building-side curb so the skyline rows never swallow them.
    const sigR = ROAD_H - 0.45;
    const sigOff = 1.85;        // off to the side of the crosswalk stripes
    const sigs = [
      [CTR - sigOff, CTR - sigR, 0],             // north
      [CTR - sigR, CTR + sigOff, Math.PI / 2],   // west
      [CTR + sigR, CTR - sigOff, -Math.PI / 2],  // east
    ];                                            // (no signal on the south/front)
    for (const [x, z, ry] of sigs) {
      place('CityWorldHomeSignal000.dae', x, z, { baseY: WALK_TOP - 0.1, height: 4.2, ry });
    }

    // ---- taxis cruising the ring road (right-hand lanes, both ways) -------
    // The car is a genuine Z_UP model -> keep the loader's upright rotation.
    const taxis = [];
    const TAXI_LEN = 2.6, TAXI_SPEED = 6, TAXI_FWD = 0; // TAXI_FWD: Math.PI if it drives backwards
    const TAXI_INNER_L = RMID - 1.0;
    const TAXI_OUTER_L = RMID + 1.3;
    const TAXI_TURN_R = 2.55;
    const taxiDefs = [
      { L: TAXI_OUTER_L, turnR: TAXI_TURN_R, dir: -1, off: 0.0 },
      { L: TAXI_OUTER_L, turnR: TAXI_TURN_R, dir: -1, off: 0.5 },
      { L: TAXI_INNER_L, turnR: TAXI_TURN_R, dir: 1, off: 0.25 },
      { L: TAXI_INNER_L, turnR: TAXI_TURN_R, dir: 1, off: 0.7 },
    ];
    const loopPerim = (L, turnR) => {
      const Rc = Math.min(turnR, L - 0.5);
      return 4 * (2 * (L - Rc) + (Math.PI / 2) * Rc);
    };
    function loopAt(L, turnR, dist) {
      const Rc = Math.min(turnR, L - 0.5), C = L - Rc;
      const straight = 2 * C, side = straight + (Math.PI / 2) * Rc, perim = 4 * side;
      let d = ((dist % perim) + perim) % perim;
      const k = Math.floor(d / side);
      const s = d - k * side;
      let x, z;
      if (s <= straight) { x = L; z = -C + s; }
      else { const a = (s - straight) / Rc; x = C + Rc * Math.cos(a); z = C + Rc * Math.sin(a); }
      for (let i = 0; i < k; i++) { const nx = -z, nz = x; x = nx; z = nz; }   // rotate the side by 90°
      return [CTR + x, CTR + z];
    }
    loadModel('Car.dae', true).then((proto) => {
      if (disposed || !proto) return;
      // the ripped New Donk taxi albedo is amber/orange — lift green toward red on
      // the painted body so it reads yellow (whites + cool glass are left alone)
      proto.traverse((o) => {
        if (!o.isMesh) return;
        for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!mat || mat.userData.yellowed) continue;
          mat.userData.yellowed = true;
          mat.onBeforeCompile = (sh) => {
            sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
              '#include <map_fragment>\n\tdiffuseColor.g = mix(diffuseColor.g, diffuseColor.r, 0.5);');
          };
        }
      });
      const b = proto.userData.bounds;
      const scl = TAXI_LEN / Math.max(b.w, b.d);
      for (const def of taxiDefs) {
        const inner = cloneSkinned(proto);
        inner.position.set(-b.cx, -b.minY, -b.cz);
        const wrap = new THREE.Group();
        wrap.add(inner);
        wrap.scale.setScalar(scl);
        group.add(wrap);
        taxis.push({ mesh: wrap, L: def.L, turnR: def.turnR, dir: def.dir, base: def.off * loopPerim(def.L, def.turnR) });
      }
    });

    // ======================================================================
    // Round-2 game objects: SPIKE TRAPS, PIRANHA PLANTS, WARP PIPES.
    // These DAEs are Z-up, inch-unit SkinnedMeshes whose samplers three cannot
    // bind, so (as in the peach round) we DESKIN them to rest-pose meshes and skin
    // each with a hand-loaded PBR material. They all animate off the live frame.
    // ======================================================================
    const OBJ = './assets/objects/';
    const objTex = (path, srgb = true) => {
      const tex = trackTexture(texLoader.load(encodeURI(path)));
      tex.anisotropy = maxAnisotropy;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const deskin = (root) => {
      const skinned = [];
      root.traverse((o) => o.isSkinnedMesh && skinned.push(o));
      for (const sm of skinned) {
        const m = new THREE.Mesh(sm.geometry, sm.material);
        m.name = sm.name;
        m.position.copy(sm.position);
        m.quaternion.copy(sm.quaternion);
        m.scale.copy(sm.scale);
        if (sm.parent) { sm.parent.add(m); sm.parent.remove(sm); }
      }
      return root;
    };
    // centre in X/Z, sit the BASE at y=0, scale so the largest side spans `size`
    const fitObject = (obj, size) => {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const dim = box.getSize(new THREE.Vector3());
      const ctr = box.getCenter(new THREE.Vector3());
      obj.position.set(-ctr.x, -box.min.y, -ctr.z);
      const wrap = new THREE.Group();
      wrap.add(obj);
      wrap.scale.setScalar(size / (Math.max(dim.x, dim.y, dim.z) || 1));
      return wrap;
    };
    const setObjMat = (obj, mat) => obj.traverse((o) => {
      if (!o.isMesh) return;
      o.material = mat;
      o.castShadow = true;
      o.receiveShadow = true;
      track(o.geometry);
    });
    const loadObj = (path) => collada.loadAsync(encodeURI(path)).then((asset) => {
      if (disposed) return null;
      deskin(asset.scene);
      return asset.scene;
    }).catch((e) => { console.warn('R2 object failed to load:', path, e); return null; });

    const cellX = (c) => c + 0.5, cellZ = (r) => r + 0.5;
    let prevRed = null, prevBlue = null;   // last frame's actor cells (warp-entry detect)

    // ---- SPIKE TRAPS: sunk under the lawn, SHOOT UP when an actor steps on ----
    const spikeMat = track(new THREE.MeshStandardMaterial({
      map: objTex(OBJ + 'Spike Trap/Textures/needletrap4x4mbody00_alb.png'),
      normalMap: objTex(OBJ + 'Spike Trap/Textures/needletrap4x4mbody00_nrm.png', false),
      roughnessMap: objTex(OBJ + 'Spike Trap/Textures/needletrap4x4mbody00_rgh.png', false),
      color: 0xffffff, roughness: 0.62, metalness: 0.12,   // let the metal albedo read (no blue sheen)
    }));
    // sharp metal NEEDLES that shoot out of the trap plate on a hit (the DAE's own
    // pop-up is a skeleton animation we stripped when deskinning, so add our own)
    const needleMat = track(new THREE.MeshStandardMaterial({ color: 0xe2e7ec, roughness: 0.28, metalness: 0.6 }));
    const needleGeo = track(new THREE.ConeGeometry(0.05, 0.5, 6));
    const spikeObjs = [];                  // {r, c, box, needles, hot}
    loadObj(OBJ + 'Spike Trap/Spike Trap.dae').then((proto) => {
      if (!proto) return;
      for (const [r, c] of world.spikes || []) {
        const box = fitObject(proto.clone(true), 0.9);
        setObjMat(box, spikeMat);
        box.position.set(cellX(c), 0.02, cellZ(r));      // the trap plate sits flush + VISIBLE
        group.add(box);
        const needles = new THREE.Group();
        for (let i = 0; i < 9; i++) {                    // a 3x3 cluster of spikes
          const cone = new THREE.Mesh(needleGeo, needleMat);
          cone.position.set(((i % 3) - 1) * 0.24, 0.25, (Math.floor(i / 3) - 1) * 0.24);
          cone.castShadow = true;
          needles.add(cone);
        }
        needles.position.set(cellX(c), 0.1, cellZ(r));
        needles.scale.y = 0.001;                          // retracted until triggered
        group.add(needles);
        spikeObjs.push({ r, c, box, needles, hot: 0 });
      }
    });

    // ---- PIRANHA PLANTS: stand on their tile, LUNGE + rise when they bite -----
    const plantMat = track(new THREE.MeshStandardMaterial({
      map: objTex(OBJ + 'Piranha Plant/PackunPoisonBig/PackunPoisonBigBody_alb.png'),
      normalMap: objTex(OBJ + 'Piranha Plant/PackunPoisonBig/PackunPoisonBigBody_nrm.png', false),
      roughnessMap: objTex(OBJ + 'Piranha Plant/PackunPoisonBig/PackunPoisonBigBody_rgh.png', false),
      roughness: 0.62, metalness: 0.0,
    }));
    const plantObjs = [];                  // {r, c, wrap, baseS, chomp}
    loadObj(OBJ + 'Piranha Plant/PackunPoisonBig/PackunPoisonBig.dae').then((proto) => {
      if (!proto) return;
      for (const [r, c] of world.plants || []) {
        const wrap = fitObject(proto.clone(true), 1.5);
        setObjMat(wrap, plantMat);
        wrap.position.set(cellX(c), 0.02, cellZ(r));
        group.add(wrap);
        plantObjs.push({ r, c, wrap, baseS: wrap.scale.x, chomp: 0 });
      }
    });

    // ---- WARP PIPES: one on every entry AND destination; glow, flash on a warp -
    const pipeMat = track(new THREE.MeshStandardMaterial({
      map: objTex(OBJ + 'Warp Pipe/Textures/dokanbody_alb.png'),
      normalMap: objTex(OBJ + 'Warp Pipe/Textures/dokanbody_nrm.png', false),
      roughnessMap: objTex(OBJ + 'Warp Pipe/Textures/dokanbody_rgh.png', false),
      color: 0x46c24d, roughness: 0.55, metalness: 0.12,
      emissive: 0x1f7a2a, emissiveIntensity: 0.1,
    }));
    const pipeObjs = [];                   // {r, c, wrap, entry, flash, mat}
    const pipeCells = [];
    const pipeSeen = new Set();
    for (const p of world.pipes || []) {
      const add = (cell, entry) => {
        const key = cell[0] * GRID + cell[1];
        if (!pipeSeen.has(key)) { pipeSeen.add(key); pipeCells.push({ r: cell[0], c: cell[1], entry }); }
      };
      add(p.entry, true);
      for (const d of p.dests) add(d, false);
    }
    loadObj(OBJ + 'Warp Pipe/Warp Pipe.dae').then((proto) => {
      if (!proto) return;
      for (const pc of pipeCells) {
        const wrap = fitObject(proto.clone(true), pc.entry ? 0.95 : 0.72);
        const mat = track(pipeMat.clone());
        setObjMat(wrap, mat);
        wrap.position.set(cellX(pc.c), 0.02, cellZ(pc.r));
        group.add(wrap);
        pipeObjs.push({ r: pc.r, c: pc.c, wrap, entry: pc.entry, flash: 0, mat });
      }
    });

    // ---- animation + teardown -------------------------------------------
    function update(t, dt, frame) {
      waterMat.opacity = 0.82 + 0.04 * Math.sin(t * 1.4);
      waterNrm.offset.x = t * 0.015;                                             // subtle drifting sheen
      waterNrm.offset.y = t * 0.011;
      waterTex.offset.x = t * 0.018;                                            // cartoon water drifts
      waterTex.offset.y = t * 0.012;
      if (star) {                                                                // power star spins, bobs + breathes
        star.mesh.rotation.y = t * 1.3;
        star.mesh.position.y = star.baseY + Math.sin(t * 2) * 0.12;
        const breath = 0.5 + 0.5 * Math.sin(t * 1.5);    // slow in/out (~4s)
        for (const m of star.mats) m.emissiveIntensity = 0.15 + breath * 0.3;   // body glints
        star.light.intensity = 0.06 + breath * 0.16;
      }
      for (const tx of taxis) {
        const d = t * TAXI_SPEED * tx.dir + tx.base;
        const [x, z] = loopAt(tx.L, tx.turnR, d);
        const [x2, z2] = loopAt(tx.L, tx.turnR, d + 0.25 * tx.dir);
        tx.mesh.position.set(x, ROAD_Y, z);
        tx.mesh.rotation.y = Math.atan2(x2 - x, z2 - z) + TAXI_FWD;   // face travel direction
      }

      // ---- Round-2 hazards react to the live frame ------------------------
      const rCell = frame && Array.isArray(frame.red) ? frame.red : null;
      const bCell = frame && Array.isArray(frame.blue) ? frame.blue : null;
      const onCell = (o, cell) => cell && cell[0] === o.r && cell[1] === o.c;
      const manhattan = (o, cell) => Math.abs(cell[0] - o.r) + Math.abs(cell[1] - o.c);

      // SPIKES: an actor standing on the trap tile IS a death frame -> NEEDLES shoot up
      for (const s of spikeObjs) {
        const stepped = onCell(s, rCell) || onCell(s, bCell);
        s.hot = stepped ? 1 : Math.max(0, s.hot - dt * 2.2);
        const e = s.hot * s.hot * (3 - 2 * s.hot);                  // smoothstep ease
        s.needles.scale.y = 0.001 + e;                             // needles extend
        s.box.position.y = 0.02 + e * 0.05;                        // the plate jolts
      }

      // PLANTS: idle turn; LUNGE (scale + rise + twist) when an actor is next to it
      for (const p of plantObjs) {
        const near = (rCell && manhattan(p, rCell) <= 1) || (bCell && manhattan(p, bCell) <= 1);
        p.chomp = near ? 1 : Math.max(0, p.chomp - dt * 2.0);
        const lunge = Math.sin(Math.min(1, p.chomp) * Math.PI);    // 0 -> 1 -> 0 over a bite
        p.wrap.scale.setScalar(p.baseS * (1 + lunge * 0.30));
        p.wrap.rotation.y = t * 0.5 + lunge * 0.6;
        p.wrap.position.y = 0.02 + lunge * 0.14;
      }

      // PIPES: entries pulse invitingly; a warp FLASHES the entry used + the exit
      const flashKeys = new Set();
      const flashEntryNear = (prev) => {
        if (!prev) return;
        for (const pipe of pipeObjs) {
          if (pipe.entry && Math.abs(pipe.r - prev[0]) + Math.abs(pipe.c - prev[1]) === 1) {
            flashKeys.add(pipe.r * GRID + pipe.c);
          }
        }
      };
      if (frame && frame.redWarp) { flashKeys.add(frame.redWarp[0] * GRID + frame.redWarp[1]); flashEntryNear(prevRed); }
      if (frame && frame.blueWarp) { flashKeys.add(frame.blueWarp[0] * GRID + frame.blueWarp[1]); flashEntryNear(prevBlue); }
      for (const pipe of pipeObjs) {
        if (flashKeys.has(pipe.r * GRID + pipe.c)) pipe.flash = 1;
        else pipe.flash = Math.max(0, pipe.flash - dt * 1.8);
        const idle = pipe.entry ? 0.16 + 0.06 * Math.sin(t * 2 + pipe.r) : 0.04;
        pipe.mat.emissiveIntensity = idle + pipe.flash * 1.6;
        pipe.wrap.position.y = 0.02 + pipe.flash * 0.06;
      }
      if (frame) { prevRed = frame.red; prevBlue = frame.blue; }
    }

    function dispose() {
      disposed = true;
      scene.remove(group);
      for (const o of trash) o.dispose?.();
    }

    return { group, update, dispose };
  },
};
