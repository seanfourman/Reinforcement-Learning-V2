// Round 3 — Fossil Falls (Cascade Kingdom), a prehistoric canyon basin.
//
// The 20x20 RL grid is a GRASSY PLATEAU on the y=0 board plane where the actors,
// gold/keys and value heatmap live (see live.js / heatmap.js). Wall ('#') cells
// become clusters of faceted ROCK; slippery ('S') cells become wet-rock POOLS;
// the goal cells host a floating POWER MOON. Going outward from the board: a low
// rock rim, then a ring of canyon cliffs, with a WATERFALL crashing down on the
// north side behind the moon. Dinosaur bones, floating islands, boulders and
// ferns dress the rim.
//
// Nothing may cover the y=0 board surface: rock/greenery only stands on wall
// cells and every gameplay marker is a thin decal/low pedestal. Models come from
// the vendored Cascade Kingdom Collada pack in assets/models/fossil-falls
// (DJ_Fox11 / The Models Resource).

import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const GRID = 20;
const CTR = GRID / 2;
const ASSETS = './assets/models/fossil-falls/';
const ISLAND_GRASS = './assets/models/city-newdonk/GroundLawn00_alb.png';
const PARK_H = 10;        // board edge half-extent
const GRASS_TOP = 0.04;   // raised plateau surface, kept below decals/heatmap
const GRASS_THICK = 0.055;

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
    const dirtMat = pbr('HomeDirtrBody00', 24, 24, 0x6f5a40);     // far canyon floor
    const soilMat = pbr('GroundBaseRock00', 10, 10, 0x8a7c66);    // base under the grass
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

    // faceted boulder materials (flat-shaded) for loose rim rocks
    const rockChunkMats = [
      track(new THREE.MeshStandardMaterial({ color: 0xb98760, roughness: 0.96, metalness: 0, flatShading: true })),
      track(new THREE.MeshStandardMaterial({ color: 0xd0a16f, roughness: 0.97, metalness: 0, flatShading: true })),
      track(new THREE.MeshStandardMaterial({ color: 0x7d8f55, roughness: 0.95, metalness: 0, flatShading: true })),
    ];
    // textured rock for the big canyon cliffs (large flat faces read the texture)
    const cliffMat = pbr('RockWall00', 3, 4, 0xc77d55);
    const cliffMat2 = pbr('GroundBaseRock00', 4, 5, 0xb27652);

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

    // vertical white-teal streaks for the falling sheet (scrolls down in update)
    function fallCanvas() {
      const S = 128;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = S;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(S, S);
      const d = img.data;
      for (let x = 0; x < S; x++) {
        // per-column brightness = a few overlaid sine streaks
        const u = x / S;
        const streak = 0.5 + 0.5 * Math.sin(2 * Math.PI * u * 9 + Math.sin(u * 40));
        for (let y = 0; y < S; y++) {
          const v = y / S;
          const flow = 0.5 + 0.5 * Math.sin(2 * Math.PI * v * 3 + u * 20);
          const b = Math.min(1, 0.45 + streak * 0.5 + flow * 0.18);
          const i = (y * S + x) * 4;
          d[i] = 150 + b * 95;
          d[i + 1] = 200 + b * 50;
          d[i + 2] = 220 + b * 35;
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas;
    }
    const fallTex = trackTexture(new THREE.CanvasTexture(fallCanvas()));
    fallTex.colorSpace = THREE.SRGBColorSpace;
    fallTex.wrapS = fallTex.wrapT = THREE.RepeatWrapping;
    fallTex.repeat.set(2.4, 3.0);
    const fallMat = track(new THREE.MeshStandardMaterial({
      color: 0xffffff, map: fallTex, transparent: true, opacity: 0.9,
      roughness: 0.2, metalness: 0.0, emissive: 0x9fd6ec, emissiveIntensity: 0.25,
      side: THREE.DoubleSide, depthWrite: false,
    }));

    // ---- stacked canyon island shell -------------------------------------
    const shelfGrassMat = grassTopMats[2];
    const boneMat = solid(0xe6d39c, { roughness: 0.82 });
    const mazeSideMat = solid(0x5c4a32, { roughness: 0.96 });

    function ground(half, y, mat, cx = CTR, cz = CTR) {
      const m = new THREE.Mesh(track(new THREE.PlaneGeometry(half * 2, half * 2)), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, y, cz);
      m.receiveShadow = true;
      group.add(m);
      return m;
    }

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

    function addBoneSpikes(cx, cz, count, radiusX, radiusZ, baseY, seed) {
      const geo = track(new THREE.ConeGeometry(0.11, 0.52, 7));
      const mesh = new THREE.InstancedMesh(geo, boneMat, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const h = hash(seed + i * 31, 4400 + i * 17);
        const a = (i / count) * Math.PI * 2 + (h % 30) * 0.01;
        dummy.position.set(
          cx + Math.cos(a) * radiusX * (0.85 + (h % 17) / 120),
          baseY + 0.26,
          cz + Math.sin(a) * radiusZ * (0.85 + (h % 19) / 120)
        );
        dummy.rotation.set((hashFloat(seed, i, 41) - 0.5) * 0.18, h * 0.01, (hashFloat(seed, i, 43) - 0.5) * 0.18);
        dummy.scale.setScalar(0.82 + (h % 21) / 100);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    function addRibCage(cx, cz, baseY, count, spacing, scale, ry) {
      const wrap = new THREE.Group();
      const ribGeo = track(new THREE.TorusGeometry(0.56 * scale, 0.045 * scale, 8, 28, Math.PI));
      for (let i = 0; i < count; i++) {
        const rib = new THREE.Mesh(ribGeo, boneMat);
        rib.position.set((i - (count - 1) * 0.5) * spacing, baseY + 0.05, 0);
        rib.castShadow = true;
        rib.receiveShadow = true;
        wrap.add(rib);
      }
      const spine = new THREE.Mesh(track(new THREE.CylinderGeometry(0.055 * scale, 0.055 * scale, spacing * (count + 0.6), 8)), boneMat);
      spine.rotation.z = Math.PI / 2;
      spine.position.set(0, baseY + 0.04, -0.36 * scale);
      spine.castShadow = true;
      wrap.add(spine);
      wrap.rotation.y = ry;
      wrap.position.set(cx, 0, cz);
      group.add(wrap);
    }

    ground(95, -5.45, dirtMat);

    [
      { x: CTR, z: CTR, w: 22.8, d: 22.6, topY: -0.08, bottomY: -4.95, seed: 100, topMat: shelfGrassMat, sideMat: cliffMat, jag: 0.42, steps: 9 },
      { x: CTR, z: -4.6, w: 15.2, d: 6.8, topY: 2.05, bottomY: -4.45, seed: 120, topMat: shelfGrassMat, sideMat: cliffMat2, jag: 0.62 },
      { x: -4.2, z: -0.6, w: 7.2, d: 6.2, topY: 0.72, bottomY: -4.8, seed: 130, topMat: shelfGrassMat, sideMat: cliffMat },
      { x: 24.2, z: -0.7, w: 7.4, d: 6.4, topY: 0.86, bottomY: -4.7, seed: 131, topMat: shelfGrassMat, sideMat: cliffMat },
      { x: -5.0, z: 10.2, w: 7.0, d: 10.8, topY: -0.42, bottomY: -5.2, seed: 140, topMat: shelfGrassMat, sideMat: cliffMat2, jag: 0.5 },
      { x: 25.2, z: 9.6, w: 8.4, d: 11.0, topY: -0.32, bottomY: -5.35, seed: 141, topMat: shelfGrassMat, sideMat: cliffMat2, jag: 0.5 },
      { x: 2.6, z: 23.6, w: 11.2, d: 7.6, topY: -0.66, bottomY: -5.55, seed: 150, topMat: shelfGrassMat, sideMat: cliffMat },
      { x: 17.6, z: 24.3, w: 12.8, d: 8.2, topY: -0.34, bottomY: -5.55, seed: 151, topMat: shelfGrassMat, sideMat: cliffMat },
      { x: -8.5, z: 4.6, w: 4.8, d: 4.2, topY: 1.55, bottomY: -3.2, seed: 160, topMat: shelfGrassMat, sideMat: cliffMat },
    ].forEach(addPlateau);

    addBoneSpikes(2.4, 23.4, 12, 4.8, 2.9, -0.28, 700);
    addBoneSpikes(23.8, 9.5, 10, 3.0, 4.0, 0.02, 740);
    addBoneSpikes(10.0, -4.7, 16, 6.1, 2.2, 2.08, 780);
    addRibCage(23.2, 6.4, 0.18, 7, 0.42, 1.25, -0.78);
    addRibCage(10.4, -3.9, 2.18, 5, 0.45, 1.1, 0.08);

    // ---- board grass: one continuous playable surface, no spreadsheet grid
    addPlateau({
      x: CTR, z: CTR, w: 20.9, d: 20.9, topY: GRASS_TOP,
      bottomY: -0.14, seed: 210, topMat: grassTopMats[4],
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

    // ---- waterfall and fossil crown behind the moon ----------------------
    const FALL_X = CTR, FALL_Z = -2.55;
    for (const off of [-1.55, 1.55]) {
      const sheet = new THREE.Mesh(track(new THREE.PlaneGeometry(2.8, 5.2)), fallMat);
      sheet.position.set(FALL_X + off, 1.35, FALL_Z + 0.25);
      sheet.renderOrder = 2;
      group.add(sheet);
    }
    const poolGeo = track(new THREE.CircleGeometry(3.1, 44));
    const pool = new THREE.Mesh(poolGeo, waterMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(FALL_X, -0.02, FALL_Z + 0.25);
    pool.renderOrder = 3;
    group.add(pool);
    const mistMat = track(new THREE.MeshBasicMaterial({
      color: 0xeaf6ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide,
    }));
    const mist = new THREE.Mesh(track(new THREE.PlaneGeometry(7.5, 3.3)), mistMat);
    mist.position.set(FALL_X, 0.8, FALL_Z + 0.4);
    group.add(mist);

    place('WaterfallWorldHomeBone000.dae', CTR + 0.2, -4.9, { baseY: 2.08, footprint: 12.4, ry: 0.02 });
    place('WaterfallWorldHomeBone001.dae', CTR - 4.8, -3.9, { baseY: 2.12, footprint: 6.2, ry: 0.38 });
    place('WaterfallWorldHomeBreakBone000.dae', 23.7, 0.0, { baseY: 0.9, footprint: 4.5, ry: -0.65 });
    place('WaterfallWorldHomeBreakBone001.dae', 23.8, 3.0, { baseY: 0.9, footprint: 4.0, ry: -0.55 });

    // repeat the actual Cascade floating-island assets around the board; these
    // are the pieces that read closest to the reference image from this camera.
    [
      ['WaterfallWorldHomeFloaterIsland000.dae', -8.2, 4.8, 3.3, 4.8, 0.55, 0.0],
      ['WaterfallWorldHomeFloaterIsland001.dae', 26.7, 13.6, 2.6, 5.6, -0.45, 2.1],
      ['WaterfallWorldHomeFloaterIsland000.dae', -7.2, 18.4, 1.8, 5.4, -0.2, 1.2],
      ['WaterfallWorldHomeFloaterIsland001.dae', 27.0, 2.6, 2.1, 4.9, 0.35, 2.8],
      ['WaterfallWorldHomeFloaterIsland000.dae', 4.1, -9.0, 2.8, 5.2, -0.65, 3.6],
      ['WaterfallWorldHomeFloaterIsland001.dae', 18.2, -8.2, 3.6, 6.0, 0.15, 4.4],
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

    const rimRocks = [
      ['WaterfallWorldHomeRock000.dae', -4.4, 10.4, -0.32, 2.7, 0.2],
      ['WaterfallWorldHomeRock001.dae', 25.0, 8.0, -0.22, 3.0, -0.7],
      ['WaterfallWorldHomeRock002.dae', 17.8, 24.4, -0.22, 3.4, 1.1],
      ['WaterfallWorldHomeRock000.dae', 2.4, 23.0, -0.52, 2.5, 2.0],
      ['WaterfallWorldHomeRock001Break.dae', -4.2, -0.8, 0.78, 2.4, -0.3],
      ['WaterfallWorldHomeRock002.dae', 24.0, -1.0, 0.92, 2.5, 0.5],
    ];
    for (const [name, x, z, y, foot, ry] of rimRocks) {
      place(name, x, z, { baseY: y, footprint: foot, ry });
    }
    place('WaterfallWorldHomeStoneBridge.dae', 18.2, 23.1, { baseY: -0.22, footprint: 5.0, ry: 0.45 });
    place('WaterfallWorldHomeBreakPartsTrace000.dae', 2.4, 22.8, { baseY: -0.5, footprint: 5.2, ry: -0.3 });

    for (let i = 0; i < 34; i++) {
      const h = hash(i * 41 + 5, 3300);
      const ring = i % 4;
      let x, z, baseY;
      if (ring === 0) {
        const ang = (i / 34) * Math.PI * 2 + (h % 100) / 500;
        const rad = PARK_H + 1.2 + (h % 3) * 0.45;
        x = CTR + Math.cos(ang) * rad;
        z = CTR + Math.sin(ang) * rad * 0.95;
        baseY = -0.02;
      } else if (ring === 1) {
        x = -4.8 + (h % 48) / 10;
        z = 4.2 + ((h >>> 5) % 88) / 10;
        baseY = -0.35;
      } else if (ring === 2) {
        x = 22.0 + (h % 54) / 10;
        z = -0.8 + ((h >>> 4) % 128) / 10;
        baseY = -0.25;
      } else {
        x = 1.4 + (h % 176) / 10;
        z = 21.0 + ((h >>> 4) % 48) / 10;
        baseY = -0.45;
      }
      if (x > -0.25 && x < GRID + 0.25 && z > -0.25 && z < GRID + 0.25) continue;
      const plant = `WaterfallWorldHomePlant${String(h % 13).padStart(3, '0')}.dae`;
      place(plant, x, z, { baseY, height: 0.58 + (h % 5) * 0.11, ry: (h % 360) * Math.PI / 180 });
    }

    // ---- animation + teardown -------------------------------------------
    function update(t, dt, frame) {
      waterMat.opacity = 0.84 + 0.04 * Math.sin(t * 1.4);
      waterNrm.offset.x = t * 0.015;
      waterNrm.offset.y = t * 0.011;
      waterTex.offset.x = t * 0.02;
      waterTex.offset.y = t * 0.014;
      fallTex.offset.y = -t * 1.1;                 // sheet rushes downward
      fallTex.offset.x = Math.sin(t * 0.7) * 0.02;
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
    }

    function dispose() {
      disposed = true;
      scene.remove(group);
      for (const o of trash) o.dispose?.();
    }

    return { group, update, dispose };
  },
};
