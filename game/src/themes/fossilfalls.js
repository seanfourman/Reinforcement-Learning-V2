// Round 3 — Fossil Falls (Cascade Kingdom), stripped to its core pieces.
//
// Just the essentials float in the sky: the 20x20 RL board (a GRASSY PLATEAU on
// the y=0 plane where the actors / value heatmap live) sitting on its own
// floating ROCK ISLAND, plus 4 of the Cascade FLOATER ISLANDS off the left and
// right sides. The board still carries its gameplay layer - rock-maze shelves on
// '#' cells, wet-rock POOLS on slippery ('S') cells, and the floating POWER MOON
// over the goal. The surrounding diorama (canyon cliffs, waterfall, dino bones,
// rim rocks, scattered plants) has been removed.
//
// Nothing may cover the y=0 board surface. Models come from the vendored Cascade
// Kingdom Collada pack in assets/models/fossil-falls (DJ_Fox11 / Models Resource).

import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const GRID = 20;
const CTR = GRID / 2;
const ASSETS = './assets/models/fossil-falls/';
const ISLAND_GRASS = './assets/models/city-newdonk/GroundLawn00_alb.png';
const GRASS_TOP = 0.04;   // raised plateau surface, kept below decals/heatmap

function hash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

export const fossilfalls = {
  name: 'fossilfalls',
  title: 'Fossil Falls',
  // misty prehistoric canyon: a fresh, slightly cool sky with hazy depth, one
  // warm sun against a cool blue fill, and a faint bloom so only the moon glows.
  sky: ['#356fb0', '#7cb4e4', '#dceffa'],
  fog: 0xc9e0f1,
  fogNear: 48,
  fogFar: 235,
  hemi: [0xaccdf2, 0x7c6c50, 0.6],
  sun: 0xfff1d2,
  sunIntensity: 3.1,
  fill: 0x9bc1f2,
  fillIntensity: 0.24,
  exposure: 1.02,
  bloom: { strength: 0.22, radius: 0.4, threshold: 0.85 }, // gentle moon-only glow
  env: './assets/hdri/qwantani_noon_2k.hdr',
  envIntensity: 0.45,
  envBlur: 0.0,
  bgIntensity: 1.02,
  redName: 'Magma',
  blueName: 'Glacier',

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

    const collada = new ColladaLoader();
    const texLoader = new THREE.TextureLoader();
    const protos = new Map();
    const maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
    let disposed = false;
    const islands = [];   // floating-island wraps to bob in update()
    const cascades = [];  // waterfall sheets: scroll their streak texture
    const ripples = [];   // expanding rings on the pond
    const mists = [];     // drifting spray puffs at the falls' foot
    let splash = null;    // pulsing foam where the cascade lands
    let pondNrm = null;   // ripple normal map for the realistic pond water

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

    function pbr(prefix, repeatX, repeatY, fallbackColor, extra = {}) {
      return track(new THREE.MeshStandardMaterial({
        color: fallbackColor,
        map: assetTexture(`${prefix}_alb.png`, repeatX, repeatY),
        normalMap: assetTexture(`${prefix}_nrm.png`, repeatX, repeatY, false),
        roughnessMap: assetTexture(`${prefix}_rgh.png`, repeatX, repeatY, false),
        roughness: 0.94,
        metalness: 0,
        ...extra,
      }));
    }

    const solid = (color, opts = {}) =>
      track(new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts }));

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
      if (!mat) return track(new THREE.MeshStandardMaterial({ color: 0x9a9080, roughness: 0.9 }));
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
      // leaves / ferns / fronds are alpha cards in this pack
      if (/leaf|leaves|plant|grass|fern|frond|flower|cloud/i.test(m.name || '')) {
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
      // same pack convention as the city set: files are tagged Z_UP but authored
      // Y-up, so the loader's auto rotation tips them over; undo it.
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

    // Clone a model to (x,z), its base sitting on baseY. footprint fits the larger
    // XZ side (keeps proportions); height, when given, scales Y to size.
    function place(name, x, z, opts = {}) {
      loadModel(name, opts.keepRotation).then((proto) => {
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
        opts.onPlaced?.(wrap);
      });
    }

    // ---- materials -------------------------------------------------------
    const grassTileTex = assetTexture('GroundGrass00_alb.png', 1.3, 1.3);
    const grassTopMats = [
      0x83c25a, 0x77b84f, 0x8fcb68, 0x6fae47, 0x88c861, 0x6aa642,
    ].map((color) => track(new THREE.MeshStandardMaterial({
      map: grassTileTex, color, roughness: 1, metalness: 0,
    })));
    const islandGrassTex = textureAt(ISLAND_GRASS, 1, 1);
    const islandGrassMat = track(new THREE.MeshStandardMaterial({
      map: islandGrassTex,
      color: 0x8ed35f,
      roughness: 1,
      metalness: 0,
    }));
    function setMaterialNeedsUpdate(mat) {
      if (Array.isArray(mat)) mat.forEach((m) => { if (m) m.needsUpdate = true; });
      else if (mat) mat.needsUpdate = true;
    }
    function applyIslandGrass(root) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.some((mat) => /GrassFlowerSet|GrassSet/i.test(mat?.name || ''))) {
          o.visible = false;
          return;
        }
        const replaceTop = (mat) => {
          const name = mat?.name || '';
          return /GroundMossRock|OUPBM/i.test(name) ? islandGrassMat : mat;
        };
        o.material = Array.isArray(o.material)
          ? o.material.map(replaceTop)
          : replaceTop(o.material);
        setMaterialNeedsUpdate(o.material);
      });
    }
    const grassEdgeMats = [
      0x5a4a32, 0x6b5638, 0x4f4029, 0x73603f,   // earthy dirt sides
    ].map((color) => solid(color, { roughness: 1 }));

    // strata'd rock for the island sides. Low repeat: extrude side UVs are in
    // WORLD units, so a small number tiles the rock at a readable scale instead
    // of mushing it. A faint warm emissive keeps the shadowed underside (it
    // faces away from the sun) from going pure black.
    const cliffMat = pbr('RockWallBase03', 0.2, 0.2, 0xffffff, {
      roughness: 0.95, emissive: 0x3a2418, emissiveIntensity: 0.6,
    });
    // sandy / dry-mud ground for the island + board top
    const sandyTopMat = pbr('GroundBaseRock00', 0.5, 0.5, 0xe6d6b0);

    // ---- cartoon water (slip pools + the falls) --------------------------
    const waterNrm = assetTexture('Water00_nrm.png', 2.2, 2.2, false);
    function waterCanvas() {
      const S = 256;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = S;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(S, S);
      const d = img.data;
      const lo = [26, 96, 132], hi = [76, 168, 196];   // teal pool: base -> ripple
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const u = x / S, v = y / S;
          let n = 0.5
            + 0.30 * Math.sin(2 * Math.PI * (u + v))
            + 0.20 * Math.sin(2 * Math.PI * (2 * u - v) + 1.3);
          n = Math.max(0, Math.min(1, 0.5 + (n - 0.5) * 0.7));
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
      roughness: 0.28, metalness: 0.1, envMapIntensity: 0.5,
      emissive: 0x0e3a52, emissiveIntensity: 0.06,
      normalMap: waterNrm, normalScale: new THREE.Vector2(0.14, 0.14),
      depthWrite: false,
    }));
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

    // ---- island + board shells -------------------------------------------
    const shelfGrassMat = grassTopMats[2];
    const mazeSideMat = solid(0x5c4a32, { roughness: 0.96 });

    function plateauShape(w, d, seed, steps = 7, jag = 0.55) {
      const pts = [];
      const push = (x, z, salt, edgeScale = 1) => {
        const nx = x + (hashFloat(seed, salt, 501) - 0.5) * jag * edgeScale;
        const nz = z + (hashFloat(seed, salt, 509) - 0.5) * jag * edgeScale;
        pts.push(new THREE.Vector2(nx, nz));
      };
      for (let i = 0; i < steps; i++) push(-w / 2 + (i / steps) * w, -d / 2, i, i === 0 ? 0.3 : 1);
      for (let i = 0; i < steps; i++) push(w / 2, -d / 2 + (i / steps) * d, 20 + i, i === 0 ? 0.3 : 1);
      for (let i = 0; i < steps; i++) push(w / 2 - (i / steps) * w, d / 2, 40 + i, i === 0 ? 0.3 : 1);
      for (let i = 0; i < steps; i++) push(-w / 2, d / 2 - (i / steps) * d, 60 + i, i === 0 ? 0.3 : 1);
      return new THREE.Shape(pts);
    }

    function addPlateau({ x, z, w, d, topY, bottomY, seed, topMat = shelfGrassMat, sideMat = cliffMat, jag = 0.55, steps = 7 }) {
      const depth = Math.max(0.2, topY - bottomY);
      const geo = track(new THREE.ExtrudeGeometry(plateauShape(w, d, seed, steps, jag), {
        depth, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.035, bevelSegments: 1,
      }));
      geo.rotateX(Math.PI / 2);
      geo.translate(x, topY, z);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    // Like addPlateau, but the side + bottom vertices are pushed in/out by
    // layered noise so the walls read as craggy ROCK instead of a flat cliff.
    // Displacement fades to 0 at the top, so the board still sits flush on it.
    function addBumpyRockIsland({ x, z, w, d, topY, bottomY, seed, topMat, sideMat,
      jag = 0.5, outlineSteps = 14, extrudeSteps = 12, amp = 1.1 }) {
      const depth = Math.max(0.2, topY - bottomY);
      const geo = track(new THREE.ExtrudeGeometry(plateauShape(w, d, seed, outlineSteps, jag), {
        depth, steps: extrudeSteps, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.035, bevelSegments: 1,
      }));
      geo.rotateX(Math.PI / 2);
      geo.translate(x, topY, z);
      const pos = geo.attributes.position;
      const span = Math.max(0.001, topY - bottomY);
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
        const df = Math.min(1, Math.max(0, (topY - vy) / span));   // 0 top .. 1 bottom
        if (df <= 0.002) continue;                                 // keep the top rim crisp
        const dx = vx - x, dz = vz - z, r = Math.hypot(dx, dz) || 1;
        const lump =
          0.55 * Math.sin(vx * 0.85 + vy * 0.6 + seed) +
          0.45 * Math.sin(vz * 1.05 - vy * 0.5 + seed * 0.3) +
          0.30 * Math.sin((vx + vz) * 0.7 + vy * 1.2 + seed * 0.7);
        const jitter = hashFloat(Math.round(vx * 6) + 200, Math.round(vz * 6) + 90, Math.round(vy * 6)) - 0.5;
        const off = (lump + jitter * 0.8) * amp * df;
        pos.setX(i, vx + (dx / r) * off);
        pos.setZ(i, vz + (dz / r) * off);
        pos.setY(i, vy + jitter * 0.5 * df);                       // a little vertical crag
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    // A craggy rock CONE for the backdrop peak: the cone skin is pushed in/out by
    // the same layered noise as the islands so it reads as low-poly rock, not a
    // smooth ice-cream cone. Displacement eases toward the apex to keep a clean
    // summit. Used twice: a big rock peak, then a small smoother snow cap.
    function addRockMountain({ x, z, baseY, peakY, radius, seed, mat, amp = 0.45, radial = 13, rings = 11 }) {
      const height = Math.max(0.5, peakY - baseY);
      const geo = track(new THREE.ConeGeometry(radius, height, radial, rings, false));
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
        const frac = (vy + height / 2) / height;          // 0 base .. 1 apex
        if (frac > 0.97) continue;                         // keep the summit crisp
        const r = Math.hypot(vx, vz) || 1;
        const lump =
          0.60 * Math.sin(vx * 0.9 + vy * 0.5 + seed) +
          0.50 * Math.sin(vz * 1.1 - vy * 0.4 + seed * 0.4) +
          0.30 * Math.sin((vx + vz) * 0.8 + vy * 1.0 + seed * 0.7);
        const jitter = hashFloat(Math.round(vx * 5) + 30, Math.round(vz * 5) + 50, Math.round(vy * 5)) - 0.5;
        const taper = 1 - frac * 0.55;                     // calmer near the top
        const off = (lump + jitter * 0.9) * amp * taper;
        pos.setX(i, vx + (vx / r) * off);
        pos.setZ(i, vz + (vz / r) * off);
        pos.setY(i, vy + jitter * 0.28 * taper);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.translate(x, baseY + height / 2, z);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    function ridgeShape(w, d, seed, jag = 0.08) {
      const pts = [];
      const hw = w * 0.5, hd = d * 0.5;
      const n = Math.max(24, Math.ceil((w + d) * 6));
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const co = Math.cos(t), si = Math.sin(t);
        const sx = Math.sign(co) * Math.pow(Math.abs(co), 0.42) * hw;
        const sz = Math.sign(si) * Math.pow(Math.abs(si), 0.42) * hd;
        const edge = 0.35 + 0.65 * Math.max(Math.abs(co), Math.abs(si));
        const x = sx + (hashFloat(seed, i, 710) - 0.5) * jag * edge;
        const z = sz + (hashFloat(seed, i, 711) - 0.5) * jag * edge;
        pts.push(new THREE.Vector2(x, z));
      }
      return new THREE.Shape(pts);
    }

    function addRidge({ x, z, w, d, topY, bottomY, seed, topMat, sideMat }) {
      const depth = Math.max(0.08, topY - bottomY);
      const geo = track(new THREE.ExtrudeGeometry(ridgeShape(w, d, seed, Math.min(0.16, 0.04 + Math.max(w, d) * 0.012)), {
        depth, bevelEnabled: true, bevelSize: 0.055, bevelThickness: 0.045, bevelSegments: 2,
      }));
      geo.rotateX(Math.PI / 2);
      geo.translate(x, topY, z);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    // the floating rock island the board sits on: dirt/mud top, craggy bumpy
    // rock sides, dropping deep below the board
    addBumpyRockIsland({
      x: CTR, z: CTR, w: 22.8, d: 22.6, topY: -0.08, bottomY: -12.0,
      seed: 100, topMat: sandyTopMat, sideMat: cliffMat, jag: 0.42, amp: 1.1,
    });

    // ---- board surface: one continuous playable plateau, sandy/dirt top -----
    addPlateau({
      x: CTR, z: CTR, w: 20.9, d: 20.9, topY: GRASS_TOP,
      bottomY: -0.14, seed: 210, topMat: sandyTopMat,
      sideMat: grassEdgeMats[1], jag: 0.28, steps: 10,
    });

    // A few soft dirt scars break up the green without covering gameplay markers.
    const dirtPatchMat = track(new THREE.MeshStandardMaterial({
      color: 0x8b6a43, roughness: 1, metalness: 0, transparent: true, opacity: 0.34,
      depthWrite: false,
    }));
    for (let i = 0; i < 18; i++) {
      const h = hash(i * 31 + 9, 8800);
      const patch = new THREE.Mesh(track(new THREE.CircleGeometry(0.45 + (h % 40) / 100, 18)), dirtPatchMat);
      patch.rotation.x = -Math.PI / 2;
      patch.scale.set(1 + ((h >>> 4) % 60) / 80, 0.45 + ((h >>> 8) % 50) / 100, 1);
      patch.rotation.z = (h % 628) / 100;
      patch.position.set(1.4 + (h % 172) / 10, GRASS_TOP + 0.006, 1.1 + ((h >>> 6) % 178) / 10);
      patch.renderOrder = 1;
      group.add(patch);
    }

    // ---- rock maze: raised mossy shelves, merged into organic runs --------
    const rows = world.rows || [];
    const wallCells = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if ((rows[r] || '')[c] === '#') wallCells.push([r, c]);
      }
    }
    function addRockMaze(cells) {
      const wallSet = new Set(cells.map(([r, c]) => `${r},${c}`));
      const used = new Set();
      const isWall = (r, c) => wallSet.has(`${r},${c}`);
      const isUsed = (r, c) => used.has(`${r},${c}`);
      const mark = (r, c) => used.add(`${r},${c}`);
      const addShelf = (r0, c0, len, horizontal) => {
        const seed = hash(r0 * 83 + c0 * 17, len * 41 + (horizontal ? 3 : 9));
        const x = horizontal ? c0 + len * 0.5 : c0 + 0.5;
        const z = horizontal ? r0 + 0.5 : r0 + len * 0.5;
        const w = horizontal ? Math.max(0.86, len * 0.94) : 0.76;
        const d = horizontal ? 0.76 : Math.max(0.86, len * 0.94);
        addRidge({
          x, z, w, d,
          topY: 0.36 + hashFloat(r0, c0, 502) * 0.06,
          bottomY: GRASS_TOP + 0.005,
          seed,
          topMat: grassTopMats[(seed >>> 2) % grassTopMats.length],
          sideMat: mazeSideMat,
        });
      };

      for (let r = 0; r < GRID; r++) {
        let c = 0;
        while (c < GRID) {
          if (!isWall(r, c) || isUsed(r, c)) { c++; continue; }
          let n = 1;
          while (c + n < GRID && isWall(r, c + n) && !isUsed(r, c + n)) n++;
          if (n >= 2) {
            addShelf(r, c, n, true);
            for (let k = 0; k < n; k++) mark(r, c + k);
          }
          c += Math.max(1, n);
        }
      }

      for (let c = 0; c < GRID; c++) {
        let r = 0;
        while (r < GRID) {
          if (!isWall(r, c) || isUsed(r, c)) { r++; continue; }
          let n = 1;
          while (r + n < GRID && isWall(r + n, c) && !isUsed(r + n, c)) n++;
          addShelf(r, c, n, false);
          for (let k = 0; k < n; k++) mark(r + k, c);
          r += Math.max(1, n);
        }
      }
    }
    if (wallCells.length) addRockMaze(wallCells);

    // ---- wet-rock pools on the slippery cells ----------------------------
    for (const [r, c] of world.slipCells || []) {
      const cx = c + 0.5, cz = r + 0.5;
      const seed = hash(r * 17 + 3, c * 29 + 7) >>> 0;
      const geo = track(new THREE.ExtrudeGeometry(puddleShape(seed, 1.0), {
        depth: 0.015, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.045, bevelSegments: 4,
      }));
      geo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geo, waterMat);
      water.position.set(cx, GRASS_TOP + 0.02, cz);
      water.renderOrder = 3;
      water.receiveShadow = true;
      group.add(water);
    }

    // ---- the floating Power Moon over the goal cells ---------------------
    let moon = null;
    const goals = world.escape || [];
    if (goals.length) {
      let mx = 0, mz = 0;
      for (const [r, c] of goals) { mx += c + 0.5; mz += r + 0.5; }
      mx /= goals.length; mz /= goals.length;
      const moonGeo = track(new THREE.IcosahedronGeometry(0.42, 1));
      const moonMat = track(new THREE.MeshStandardMaterial({
        color: 0xffe9a0, emissive: 0xffc23a, emissiveIntensity: 0.6,
        roughness: 0.5, metalness: 0.0, flatShading: true,
      }));
      const mesh = new THREE.Mesh(moonGeo, moonMat);
      mesh.castShadow = true;
      const wrap = new THREE.Group();
      wrap.add(mesh);
      wrap.position.set(mx, 1.25, mz);
      group.add(wrap);
      const glow = new THREE.PointLight(0xffd866, 0.5, 6, 2);
      glow.position.set(mx, 1.25, mz);
      group.add(glow);
      moon = { mesh: wrap, mat: moonMat, light: glow, baseY: 1.25 };
    }

    // ---- the 4 Cascade floater islands on the left and right sides -------
    [
      ['WaterfallWorldHomeFloaterIsland000.dae', -5.4, 4.8, 3.3, 4.8, 0.55, 0.0],
      ['WaterfallWorldHomeFloaterIsland001.dae', 23.8, 13.6, 2.6, 5.6, -0.45, 2.1],
      ['WaterfallWorldHomeFloaterIsland000.dae', -4.6, 18.4, 1.8, 5.4, -0.2, 1.2],
      ['WaterfallWorldHomeFloaterIsland001.dae', 24.0, 2.6, 2.1, 4.9, 0.35, 2.8],
    ].forEach(([name, x, z, y, foot, ry, ph]) =>
      place(name, x, z, {
        baseY: y,
        footprint: foot,
        ry,
        onPlaced: (w) => {
          applyIslandGrass(w);
          islands.push({ w, y, ph });
        },
      })
    );

    // ---- backdrop: snow-capped mountain + waterfall into a pond -----------
    // A tall rock peak rises behind the north wall, beyond the goal gap, so it
    // never covers the board. A bright cascade spills from a spring near the
    // summit, down the front face, into a teal pond at its foot ringed by rocks.
    // The Power Moon over the goal now floats squarely "over the falls" again.
    {
      const mtnX = CTR, mtnZ = -14.0;
      const baseY = -3.0, peakY = 16.0, mtnR = 8.5, mtnH = peakY - baseY;
      const rockRadiusAt = (y) => mtnR * (1 - (y - baseY) / mtnH);  // front-face radius

      const mountainMat = pbr('RockWallBase03', 3, 4, 0xc3b297, {
        roughness: 0.96, emissive: 0x3a2418, emissiveIntensity: 0.5,
      });
      const snowMat = track(new THREE.MeshStandardMaterial({
        color: 0xeef3f6, roughness: 0.72, metalness: 0,
        emissive: 0x20303c, emissiveIntensity: 0.06,
      }));
      const foamMat = track(new THREE.MeshStandardMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85, roughness: 0.4, metalness: 0,
        emissive: 0xeaf6ff, emissiveIntensity: 0.5, depthWrite: false,
      }));
      const mistMat = track(new THREE.MeshStandardMaterial({
        color: 0xf2fbff, transparent: true, opacity: 0.28, roughness: 0.6, metalness: 0,
        emissive: 0xdff2ff, emissiveIntensity: 0.25, depthWrite: false,
      }));
      // genuine reflective water for the pond + spring: a glossy, low-roughness
      // physical surface that mirrors the HDRI sky with a clearcoat sheen and an
      // animated ripple normal map (NOT the flat cartoon canvas the slip pools use).
      pondNrm = assetTexture('Water00_nrm.png', 3, 3, false);
      const pondWaterMat = track(new THREE.MeshPhysicalMaterial({
        color: 0x16414d,
        roughness: 0.08,
        metalness: 0.0,
        envMapIntensity: 3.0,
        transparent: true,
        opacity: 0.9,
        normalMap: pondNrm,
        normalScale: new THREE.Vector2(0.45, 0.45),
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        ior: 1.33,
        depthWrite: false,
      }));

      // rock foundation: a bumpy shoulder tying the floating board island to the
      // mountain and cradling the pond (front kept north of the board surface).
      addBumpyRockIsland({
        x: mtnX, z: -11.0, w: 22.0, d: 21.0, topY: -0.12, bottomY: -15.0,
        seed: 320, topMat: sandyTopMat, sideMat: cliffMat, jag: 0.6, amp: 1.3,
      });

      // the peak + its snow cap
      addRockMountain({ x: mtnX, z: mtnZ, baseY, peakY, radius: mtnR, seed: 412, mat: mountainMat, amp: 0.7, radial: 15, rings: 13 });
      addRockMountain({
        x: mtnX, z: mtnZ, baseY: 10.0, peakY: peakY + 0.3,
        radius: rockRadiusAt(10.0) + 0.5, seed: 77, mat: snowMat, amp: 0.3, rings: 7,
      });

      // --- the pond at the foot: a wide, shallow pool -----------------------
      const pondZ = -4.5, pondY = -0.05;
      const pondHalfX = 5.4, pondHalfZ = 1.9;      // wide left-right, thin front-back
      const pondBaseR = 3.06;                       // puddleShape(940, 9.0) ~radius
      const pondGeo = track(new THREE.ExtrudeGeometry(puddleShape(940, 9.0), {
        depth: 0.02, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 4,
      }));
      pondGeo.rotateX(-Math.PI / 2);
      const pond = new THREE.Mesh(pondGeo, pondWaterMat);
      pond.position.set(mtnX, pondY, pondZ);
      pond.scale.set(pondHalfX / pondBaseR, 1, pondHalfZ / pondBaseR);
      pond.renderOrder = 3;
      pond.receiveShadow = true;
      group.add(pond);

      // a ring of rocks hugging the wide elliptical rim so the pond reads contained
      const rimGeo = track(new THREE.IcosahedronGeometry(1, 0));
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + hashFloat(i, 5, 12) * 0.4;
        const ex = pondHalfX + 0.25 + hashFloat(i, 9, 7) * 0.6;
        const ez = pondHalfZ + 0.25 + hashFloat(i, 11, 7) * 0.45;
        const s = 0.42 + hashFloat(i, 3, 4) * 0.5;
        const rock = new THREE.Mesh(rimGeo, cliffMat);
        rock.position.set(mtnX + Math.cos(a) * ex, pondY + 0.02 + s * 0.2, pondZ + Math.sin(a) * ez);
        rock.scale.set(s, s * (0.5 + hashFloat(i, 1, 2) * 0.5), s);
        rock.rotation.set(hashFloat(i, 2, 1) * 1.2, a, hashFloat(i, 6, 8) * 1.2);
        rock.castShadow = true;
        rock.receiveShadow = true;
        group.add(rock);
      }

      // --- spring at the top + the falling cascade -------------------------
      const srcY = 9.0;
      // keep the cascade clearly in FRONT of the bulged, craggy cone face for its
      // whole length: the face slopes outward as it drops, so this forward offset
      // (which beats the worst displacement bulge) leaves the spring + sheet proud
      // of the rock instead of buried in it.
      const srcZ = mtnZ + rockRadiusAt(srcY) + 1.9;
      const springGeo = track(new THREE.CircleGeometry(1.6, 20));
      springGeo.rotateX(-Math.PI / 2);
      const spring = new THREE.Mesh(springGeo, pondWaterMat);
      spring.position.set(mtnX, srcY + 0.05, srcZ - 0.5);   // back edge tucked into the cliff
      spring.renderOrder = 3;
      group.add(spring);

      // a vertical streak texture for the falling water
      function waterfallCanvas() {
        const W = 48, H = 256;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(W, H);
        const d = img.data;
        const lo = [78, 150, 182], hi = [232, 246, 251];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = x / W, v = y / H;
            const col = hashFloat(x, 7, 333);
            let n = 0.42 + 0.42 * col
              + 0.18 * Math.sin(2 * Math.PI * (v * 3 + col * 2))
              + 0.10 * Math.sin(2 * Math.PI * (v * 7 - col));
            n = Math.max(0, Math.min(1, n));
            const i = (y * W + x) * 4;
            d[i] = lo[0] + (hi[0] - lo[0]) * n;
            d[i + 1] = lo[1] + (hi[1] - lo[1]) * n;
            d[i + 2] = lo[2] + (hi[2] - lo[2]) * n;
            const edge = Math.min(1, Math.min(u, 1 - u) / 0.12);   // soften side seams
            d[i + 3] = (200 + 55 * n) * (0.45 + 0.55 * edge);
          }
        }
        ctx.putImageData(img, 0, 0);
        return cv;
      }
      const fallTex = trackTexture(new THREE.CanvasTexture(waterfallCanvas()));
      fallTex.colorSpace = THREE.SRGBColorSpace;
      fallTex.wrapS = fallTex.wrapT = THREE.RepeatWrapping;
      fallTex.repeat.set(1, 3.4);
      fallTex.anisotropy = maxAnisotropy;
      const fallMat = track(new THREE.MeshStandardMaterial({
        color: 0xffffff, map: fallTex, transparent: true, opacity: 0.94,
        roughness: 0.22, metalness: 0, emissive: 0xbfe6f2, emissiveIntensity: 0.2,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      // a tapered sheet (wider at the base), hanging in front of the slope from
      // the spring down to the pond
      const topY = srcY, botY = pondY + 0.02, topZ = srcZ, botZ = pondZ;
      const dz = botZ - topZ, dy = topY - botY;
      const len = Math.hypot(dy, dz);
      const fallGeo = track(new THREE.PlaneGeometry(1, len, 3, 14));
      {
        const p = fallGeo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const vf = (p.getY(i) + len / 2) / len;          // 0 bottom .. 1 top
          p.setX(i, p.getX(i) * (4.2 + (2.2 - 4.2) * vf)); // 4.2 wide foot -> 2.2 lip
        }
        p.needsUpdate = true;
        fallGeo.computeVertexNormals();
      }
      const fall = new THREE.Mesh(fallGeo, fallMat);
      fall.position.set(mtnX, (topY + botY) / 2, (topZ + botZ) / 2);
      fall.rotation.x = -Math.atan2(dz, dy);               // top toward the cliff, foot in the pond
      fall.renderOrder = 4;
      group.add(fall);
      cascades.push({ tex: fallTex, mat: fallMat });

      // foam at the lip and where it lands
      const lip = new THREE.Mesh(track(new THREE.SphereGeometry(1.2, 12, 9)), foamMat);
      lip.position.set(mtnX, topY + 0.08, topZ);
      lip.scale.set(1.4, 0.45, 0.9);
      group.add(lip);

      splash = new THREE.Mesh(track(new THREE.SphereGeometry(1.7, 14, 10)), track(foamMat.clone()));
      splash.position.set(mtnX, pondY + 0.1, botZ);
      splash.scale.set(1.6, 0.32, 1.25);
      group.add(splash);

      // expanding ripple rings radiating from the splash
      const ringGeo = track(new THREE.RingGeometry(0.92, 1.0, 28));
      ringGeo.rotateX(-Math.PI / 2);
      for (let i = 0; i < 3; i++) {
        const rmat = track(new THREE.MeshBasicMaterial({
          color: 0xdff3ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
        }));
        const ring = new THREE.Mesh(ringGeo, rmat);
        ring.position.set(mtnX, pondY + 0.03, botZ);
        ring.renderOrder = 4;
        group.add(ring);
        ripples.push({ mesh: ring, mat: rmat, off: i / 3, r0: 0.9, grow: 3.0, speed: 0.45, ax: 1.5, az: 0.5 });
      }

      // drifting spray at the base
      const mistGeo = track(new THREE.SphereGeometry(1.0, 10, 8));
      for (let i = 0; i < 5; i++) {
        const puff = new THREE.Mesh(mistGeo, mistMat);
        const px = mtnX + (hashFloat(i, 4, 6) - 0.5) * 8.0;
        const pz = botZ + (hashFloat(i, 8, 9) - 0.5) * 1.8;
        puff.position.set(px, pondY + 0.8 + hashFloat(i, 2, 3) * 0.7, pz);
        puff.scale.set(1.3 + i * 0.2, 0.75, 1.1);
        group.add(puff);
        mists.push({ mesh: puff, base: puff.position.y, ph: i * 2.1 });
      }
    }

    // ---- animation + teardown -------------------------------------------
    function update(t, dt, frame) {
      waterMat.opacity = 0.84 + 0.04 * Math.sin(t * 1.4);
      waterNrm.offset.x = t * 0.015;
      waterNrm.offset.y = t * 0.011;
      waterTex.offset.x = t * 0.02;
      waterTex.offset.y = t * 0.014;
      if (pondNrm) {
        pondNrm.offset.x = Math.sin(t * 0.18) * 0.4 + t * 0.013;   // gentle swirling ripples
        pondNrm.offset.y = Math.cos(t * 0.15) * 0.4 + t * 0.009;
      }
      if (moon) {
        moon.mesh.rotation.y = t * 0.9;
        moon.mesh.position.y = moon.baseY + Math.sin(t * 1.8) * 0.12;
        const breath = 0.5 + 0.5 * Math.sin(t * 1.4);
        moon.mat.emissiveIntensity = 0.45 + breath * 0.4;
        moon.light.intensity = 0.35 + breath * 0.35;
      }
      for (const is of islands) {
        is.w.position.y = is.y + Math.sin(t * 0.6 + is.ph) * 0.25;
        is.w.rotation.y += dt * 0.05;
      }
      for (const cas of cascades) {
        cas.tex.offset.y += dt * 1.1;                 // streaks tumble downward toward the pond
        cas.tex.offset.x = Math.sin(t * 0.7) * 0.02;  // faint sway
        cas.mat.emissiveIntensity = 0.16 + 0.06 * Math.sin(t * 3.1);
      }
      for (const rp of ripples) {
        const ph = ((t * rp.speed + rp.off) % 1 + 1) % 1;
        const rad = rp.r0 + ph * rp.grow;
        rp.mesh.scale.set(rad * rp.ax, 1, rad * rp.az);   // elliptical, matching the pool
        rp.mat.opacity = (1 - ph) * 0.45;
      }
      if (splash) {
        const b = 0.5 + 0.5 * Math.sin(t * 5.0);
        splash.material.opacity = 0.55 + 0.25 * b;
        splash.scale.x = 1.6 + 0.16 * b;
        splash.scale.z = 1.25 + 0.12 * b;
      }
      for (const m of mists) {
        m.mesh.position.y = m.base + Math.sin(t * 0.8 + m.ph) * 0.25;
        m.mesh.position.x += Math.sin(t * 0.3 + m.ph) * dt * 0.05;
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
