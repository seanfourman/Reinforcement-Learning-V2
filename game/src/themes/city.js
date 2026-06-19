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
const DIVIDER_ROW = 12;

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

    const cellWall = (r, c) =>
      r >= 0 && r < GRID && c >= 0 && c < GRID && rows[r][c] === '#';

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
    const soilMat = track(new THREE.MeshStandardMaterial({
      map: textureAt(`${MK_TEXTURES}groundbasesoil02_alb.png`, 7, 7),
      normalMap: textureAt(`${MK_TEXTURES}groundbasesoil02_nrm.png`, 7, 7, false),
      color: 0xc6a279,
      roughness: 1,
      metalness: 0,
    }));
    const lawnTileTex = assetTexture('GroundLawn00_alb.png', 1.25, 1.25);
    const lawnTopMats = [
      0xb7df7e, 0xaed76f, 0xc2e78d, 0xa4cf67, 0xbce287, 0x9fca62,
    ].map((color) => track(new THREE.MeshStandardMaterial({
      map: lawnTileTex,
      color,
      roughness: 1,
      metalness: 0,
    })));
    const lawnEdgeMats = [
      0x638a39, 0x587f33, 0x6f9342, 0x4f7530,
    ].map((color) => solid(color, { roughness: 1 }));
    const hedgeMat = solid(0x49992f, { roughness: 0.95 });
    const planterMat = solid(0x8d8475, { roughness: 0.9 });
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
    ground(PARK_H, 0.012, soilMat);           // Mushroom Kingdom soil visible in cell seams
    addLawnCells();

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

    // ---- the park interior: greenery on every wall cell ------------------
    const planterGeo = track(new THREE.BoxGeometry(0.92, 0.2, 0.92));
    const hedgeGeo = track(new THREE.BoxGeometry(0.82, 0.66, 0.82));
    for (let r = 1; r < GRID - 1; r++) {
      for (let c = 1; c < GRID - 1; c++) {
        if (r === DIVIDER_ROW || !cellWall(r, c)) continue;
        const h = hash(r * 31 + 7, c * 17 + 3);
        const x = c + 0.5;
        const z = r + 0.5;

        const planter = new THREE.Mesh(planterGeo, planterMat);
        planter.position.set(x, 0.04, z);
        planter.castShadow = true;
        planter.receiveShadow = true;
        group.add(planter);

        const k = h % 6;
        if (k < 3) {
          const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
          hedge.position.set(x, 0.14 + 0.33, z);
          hedge.castShadow = true;
          hedge.receiveShadow = true;
          group.add(hedge);
        } else if (k < 5) {
          place('CityWorldHomeTree000.dae', x, z, { baseY: 0.14, height: 2.5 + (h % 3) * 0.4, ry: h });
        } else {
          place('CityWorldBushA.dae', x, z, { baseY: 0.14, height: 1.2, ry: h });
        }
        if (h % 8 === 0) {
          place('CityWorldHomeBench000.dae', x + 0.6, z + 0.6, { baseY: 0.04, height: 0.6, ry: (h >> 2) * 0.7 });
        }
      }
    }

    // ---- divider row 12: a hedge wall split by the two key-locked gates ---
    const HEDGE_W = 1.35;
    const hedgeWall = (x0, x1) => {
      const w = x1 - x0;
      const base = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.2, 0.9)), planterMat);
      base.position.set((x0 + x1) / 2, 0.04, DIVIDER_ROW + 0.5);
      base.receiveShadow = true;
      group.add(base);
      const hedge = new THREE.Mesh(track(new THREE.BoxGeometry(w, HEDGE_W, 0.8)), hedgeMat);
      hedge.position.set((x0 + x1) / 2, 0.14 + HEDGE_W / 2, DIVIDER_ROW + 0.5);
      hedge.castShadow = true;
      hedge.receiveShadow = true;
      group.add(hedge);
    };
    const [rdr, rdc] = world.redDoor;   // (12, 8)
    const [bdr, bdc] = world.blueDoor;  // (12, 11)
    hedgeWall(0, rdc);
    hedgeWall(rdc + 1, bdc);
    hedgeWall(bdc + 1, GRID);

    // garden gate arches at each door
    const gateArch = (x, z, color) => {
      const m = solid(color, { roughness: 0.5, metalness: 0.2, emissive: color, emissiveIntensity: 0.2 });
      for (const dx of [-0.5, 0.5]) {
        const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, HEDGE_W + 0.7, 0.6)), m);
        post.position.set(x + dx, (HEDGE_W + 0.7) / 2, z);
        post.castShadow = true;
        group.add(post);
      }
      const top = new THREE.Mesh(track(new THREE.BoxGeometry(1.32, 0.24, 0.6)), m);
      top.position.set(x, HEDGE_W + 0.7, z);
      top.castShadow = true;
      group.add(top);
    };
    gateArch(rdc + 0.5, rdr + 0.5, 0xe23a44);
    gateArch(bdc + 0.5, bdr + 0.5, 0x3b7bff);

    // closing gate panels (hidden once the matching key is taken)
    const gatePanel = (r, c, color) => {
      const mesh = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.9, HEDGE_W + 0.4, 0.18)),
        solid(color, { roughness: 0.45, metalness: 0.1 })
      );
      mesh.position.set(c + 0.5, (HEDGE_W + 0.4) / 2, r + 0.5);
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    };
    const redGate = gatePanel(rdr, rdc, 0xe23a44);
    const blueGate = gatePanel(bdr, bdc, 0x3b7bff);

    // ---- thin cell markers (all hug the y=0 board) -----------------------
    const decal = (r, c, hex, op = 0.55, y = 0.05, size = 0.9) => {
      const mesh = new THREE.Mesh(
        track(new THREE.PlaneGeometry(size, size)),
        track(new THREE.MeshStandardMaterial({
          color: hex, transparent: true, opacity: op,
          roughness: 0.5, metalness: 0, depthWrite: false,
          emissive: hex, emissiveIntensity: 0.4,
        }))
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(c + 0.5, y, r + 0.5);
      group.add(mesh);
      return mesh;
    };

    // slippery wet lawn -> puddles
    for (const [r, c] of world.slipCells || []) decal(r, c, 0x49b6ff, 0.32, 0.05);

    // drop-trap manholes
    const grates = [];
    for (const [r, c] of world.dropTraps || []) {
      place('CityWorldHomeManhole000.dae', c + 0.5, r + 0.5, { baseY: 0.02, fitXZ: 0.86, ry: Math.PI / 4 });
      grates.push(decal(r, c, 0xff7a2a, 0.4, 0.07, 0.95));
    }

    // north escape tiles + a park-exit arch over them
    const portals = (world.escape || []).map(([r, c]) => decal(r, c, 0x39d96a, 0.6, 0.08));
    if ((world.escape || []).length) {
      const ex = world.escape.reduce((s, e) => s + e[1] + 0.5, 0) / world.escape.length;
      const ez = world.escape[0][0] + 0.5;
      const archMat = solid(0x2fbf66, { emissive: 0x39d96a, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.5 });
      for (const dx of [-1.1, 1.1]) {
        const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.2, 3.0, 0.2)), archMat);
        post.position.set(ex + dx, 1.5, ez);
        post.castShadow = true;
        group.add(post);
      }
      const bar = new THREE.Mesh(track(new THREE.BoxGeometry(2.6, 0.42, 0.3)), archMat);
      bar.position.set(ex, 3.0, ez);
      group.add(bar);
    }

    // spawn pads
    const spawnPad = (cell, hex) => {
      if (!cell) return;
      const [r, c] = cell;
      const ring = new THREE.Mesh(
        track(new THREE.RingGeometry(0.32, 0.46, 28)),
        track(new THREE.MeshStandardMaterial({
          color: hex, emissive: hex, emissiveIntensity: 0.5,
          transparent: true, opacity: 0.75, roughness: 0.5, depthWrite: false,
        }))
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c + 0.5, 0.06, r + 0.5);
      group.add(ring);
    };
    spawnPad(world.redSpawn, 0xff4d6a);
    spawnPad(world.blueSpawn, 0x5b8dff);

    // pads under the floating keys (the keys themselves are drawn in live.js)
    if (world.redKey) decal(world.redKey[0], world.redKey[1], 0xff4d6a, 0.45, 0.06, 0.7);
    if (world.blueKey) decal(world.blueKey[0], world.blueKey[1], 0x5b8dff, 0.45, 0.06, 0.7);

    // gold home: a small stone fountain (floating gold rests at goldCol+1, x=10)
    const [gr, gc] = world.goldHome;
    const fx = gc + 1.0, fz = gr + 0.5;
    const basin = new THREE.Mesh(
      track(new THREE.CylinderGeometry(1.0, 1.15, 0.34, 24)),
      track(new THREE.MeshStandardMaterial({ color: 0xb9b2a3, roughness: 0.8, metalness: 0.05 }))
    );
    basin.position.set(fx, 0.11, fz);
    basin.castShadow = true;
    basin.receiveShadow = true;
    group.add(basin);
    const water = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.86, 24)),
      track(new THREE.MeshStandardMaterial({ color: 0x49b6ff, transparent: true, opacity: 0.7, roughness: 0.2, metalness: 0.1 }))
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(fx, 0.29, fz);
    group.add(water);
    const pedestal = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.22, 0.3, 0.4, 16)),
      track(new THREE.MeshStandardMaterial({
        color: 0x6b5a2a, emissive: 0xffc24b, emissiveIntensity: 0.45,
        roughness: 0.4, metalness: 0.55,
      }))
    );
    pedestal.position.set(fx, 0.34, fz);
    pedestal.castShadow = true;
    group.add(pedestal);

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
      if (h % 3 !== 0) continue;                 // sparse — only some spots get one
      const along = (((h >> 2) % 1000) / 1000 - 0.5) * 2 * (OSW_H - 3);
      if (Math.abs(along) < 3.5) continue;        // near a crosswalk/entrance
      let x, z, ry;
      if (side === 0) { x = CTR + along; z = CTR - propR; ry = 0; }
      else if (side === 2) { x = CTR - propR; z = CTR + along; ry = Math.PI / 2; }
      else { x = CTR + propR; z = CTR + along; ry = -Math.PI / 2; }
      place('CityWorldHomeTrashBox000.dae', x, z, { baseY: WALK_TOP - 0.01, height: 0.9, ry });
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

    // traffic signals standing just before each crosswalk (park side of the road)
    const sigR = ROAD_H + 0.5;  // on the outer-sidewalk curb, just past the road
    const sigOff = 1.9;         // off to the side of the crosswalk stripes
    const sigs = [
      [CTR - sigOff, CTR - sigR, 0],             // north
      [CTR - sigR, CTR + sigOff, Math.PI / 2],   // west
      [CTR + sigR, CTR - sigOff, -Math.PI / 2],  // east
    ];                                            // (no signal on the south/front)
    for (const [x, z, ry] of sigs) {
      place('CityWorldHomeSignal000.dae', x, z, { baseY: WALK_TOP - 0.15, height: 4.2, ry });
    }

    // ---- taxis cruising the ring road (right-hand lanes, both ways) -------
    // The car is a genuine Z_UP model -> keep the loader's upright rotation.
    const taxis = [];
    const TAXI_LEN = 2.6, TAXI_SPEED = 6, TAXI_FWD = 0; // TAXI_FWD: Math.PI if it drives backwards
    const taxiDefs = [
      { L: RMID + 1.3, dir: 1, off: 0.0 },    // outer lane, CCW = right-hand
      { L: RMID + 1.3, dir: 1, off: 0.5 },
      { L: RMID - 1.3, dir: -1, off: 0.25 },  // inner lane, CW = right-hand the other way
      { L: RMID - 1.3, dir: -1, off: 0.7 },
    ];
    const loopPerim = (L) => { const Rc = Math.min(2.5, L - 0.5); return 4 * (2 * (L - Rc) + (Math.PI / 2) * Rc); };
    function loopAt(L, dist) {
      const Rc = Math.min(2.5, L - 0.5), C = L - Rc;
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
        taxis.push({ mesh: wrap, L: def.L, dir: def.dir, base: def.off * loopPerim(def.L) });
      }
    });

    // ---- animation + teardown -------------------------------------------
    function update(t, dt, frame) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 2.0);
      for (const p of portals) p.material.opacity = 0.42 + 0.3 * pulse;
      for (const g of grates) g.material.opacity = 0.28 + 0.26 * Math.abs(Math.sin(t * 3));
      for (const tx of taxis) {
        const d = t * TAXI_SPEED * tx.dir + tx.base;
        const [x, z] = loopAt(tx.L, d);
        const [x2, z2] = loopAt(tx.L, d + 0.25 * tx.dir);
        tx.mesh.position.set(x, ROAD_Y, z);
        tx.mesh.rotation.y = Math.atan2(x2 - x, z2 - z) + TAXI_FWD;   // face travel direction
      }
      if (frame) {
        redGate.visible = !frame.redKey;
        blueGate.visible = !frame.blueKey;
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
