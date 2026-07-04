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

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const GRID = 20;
const CTR = GRID / 2;
const ASSETS = "./assets/models/fossil-falls/";
const ISLAND_GRASS = "./assets/models/city-newdonk/GroundLawn00_alb.png";
const GRASS_TOP = 0.04; // raised plateau surface, kept below decals/heatmap

function hash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

export const fossilfalls = {
  name: "fossilfalls",
  title: "Fossil Falls",
  subtitle: "Floating Stone Islands",
  // misty prehistoric canyon: a fresh, slightly cool sky with hazy depth, one
  // warm sun against a cool blue fill, and a faint bloom so only the moon glows.
  sky: ["#356fb0", "#7cb4e4", "#dceffa"],
  fog: 0xc9e0f1,
  // pushed way out so the assembled Cascade Kingdom diorama behind the arena
  // reads crisply and only its far cliffs melt into the sky
  fogNear: 95,
  fogFar: 420,
  hemi: [0xaccdf2, 0x7c6c50, 0.6],
  sun: 0xfff1d2,
  sunIntensity: 3.1,
  fill: 0x9bc1f2,
  fillIntensity: 0.24,
  exposure: 1.02,
  // tuned midway: a soft halo on the brightest cloud tops + the moon, without
  // the full white blowout (was 0.22/0.85, too hot; 0.14/0.93 too flat)
  bloom: { strength: 0.18, radius: 0.4, threshold: 0.89 },
  env: "./assets/hdri/qwantani_noon_2k.hdr",
  envIntensity: 0.45,
  envBackground: false, // HDRI lights the scene; the sky stays the soft gradient
  // wider shot than the default 30 so the assembled level around the arena shows
  camera: { startDist: 38, maxDist: 38 },
  redName: "Magma",
  blueName: "Glacier",

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
    const islands = []; // floating-island wraps to bob in update()
    const cascades = []; // waterfall sheets: scroll their streak texture
    const ripples = []; // expanding rings on the pond
    const mists = []; // drifting spray puffs at the falls' foot
    let splash = null; // pulsing foam where the cascade lands
    let pondNrm = null; // ripple normal map for the realistic pond water
    const ships = []; // moored airships: bob + sway in update(), no full turn
    // the round transition holds its black screen until the real level below
    // has fully assembled (resolved in the backdrop block, even on failure)
    let markReady;
    const ready = new Promise((res) => (markReady = res));

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
      return track(
        new THREE.MeshStandardMaterial({
          color: fallbackColor,
          map: assetTexture(`${prefix}_alb.png`, repeatX, repeatY),
          normalMap: assetTexture(`${prefix}_nrm.png`, repeatX, repeatY, false),
          roughnessMap: assetTexture(
            `${prefix}_rgh.png`,
            repeatX,
            repeatY,
            false,
          ),
          roughness: 0.94,
          metalness: 0,
          ...extra,
        }),
      );
    }

    const solid = (color, opts = {}) =>
      track(
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.85,
          metalness: 0,
          ...opts,
        }),
      );

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

    // grass for the level terrain: EXACTLY the same look as the floater islands
    // (applyIslandGrass) - the lawn texture + tint - applied to every grass and
    // mossy-rock surface of the Cascade chunks, so all the greens match.
    const levelGrassTex = textureAt(ISLAND_GRASS, 1, 1);
    function tuneMaterial(mat) {
      if (!mat)
        return track(
          new THREE.MeshStandardMaterial({ color: 0x9a9080, roughness: 0.9 }),
        );
      const m = mat.clone();
      if (/GroundGrass00|GroundMossRock|OUPBM/i.test(m.name || "")) {
        m.map = levelGrassTex;
        m.color?.set?.(0x8ed35f); // identical tint to islandGrassMat
      }
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
      if (
        /leaf|leaves|plant|grass|fern|frond|flower|cloud/i.test(m.name || "")
      ) {
        m.side = THREE.DoubleSide;
        m.transparent = true;
        m.alphaTest = Math.max(m.alphaTest || 0, 0.12);
      }
      if ("emissiveIntensity" in m)
        m.emissiveIntensity = Math.min(m.emissiveIntensity || 0, 0.4);
      if ("shininess" in m) m.shininess = Math.min(m.shininess || 30, 8);
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
        protos.set(
          name,
          collada
            .loadAsync(ASSETS + name)
            .then((asset) => {
              const proto = prepare(asset, keepRotation);
              if (disposed) disposeTree(proto);
              return proto;
            })
            .catch((err) => {
              console.warn(`Could not load ${name}`, err);
              return null;
            }),
        );
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
    const grassTileTex = assetTexture("GroundGrass00_alb.png", 1.3, 1.3);
    const grassTopMats = [
      0x83c25a, 0x77b84f, 0x8fcb68, 0x6fae47, 0x88c861, 0x6aa642,
    ].map((color) =>
      track(
        new THREE.MeshStandardMaterial({
          map: grassTileTex,
          color,
          roughness: 1,
          metalness: 0,
        }),
      ),
    );
    const islandGrassTex = textureAt(ISLAND_GRASS, 1, 1);
    const islandGrassMat = track(
      new THREE.MeshStandardMaterial({
        map: islandGrassTex,
        color: 0x8ed35f,
        roughness: 1,
        metalness: 0,
      }),
    );
    function setMaterialNeedsUpdate(mat) {
      if (Array.isArray(mat))
        mat.forEach((m) => {
          if (m) m.needsUpdate = true;
        });
      else if (mat) mat.needsUpdate = true;
    }
    function applyIslandGrass(root) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (
          mats.some((mat) => /GrassFlowerSet|GrassSet/i.test(mat?.name || ""))
        ) {
          o.visible = false;
          return;
        }
        const replaceTop = (mat) => {
          const name = mat?.name || "";
          return /GroundMossRock|OUPBM/i.test(name) ? islandGrassMat : mat;
        };
        o.material = Array.isArray(o.material)
          ? o.material.map(replaceTop)
          : replaceTop(o.material);
        setMaterialNeedsUpdate(o.material);
      });
    }
    const grassEdgeMats = [
      0x5a4a32,
      0x6b5638,
      0x4f4029,
      0x73603f, // earthy dirt sides
    ].map((color) => solid(color, { roughness: 1 }));

    // strata'd rock for the island sides. Low repeat: extrude side UVs are in
    // WORLD units, so a small number tiles the rock at a readable scale instead
    // of mushing it. A faint warm emissive keeps the shadowed underside (it
    // faces away from the sun) from going pure black.
    const cliffMat = pbr("RockWallBase03", 0.2, 0.2, 0xffffff, {
      roughness: 0.95,
      emissive: 0x3a2418,
      emissiveIntensity: 0.6,
    });
    // sandy / dry-mud ground for the island + board top
    const sandyTopMat = pbr("GroundBaseRock00", 0.5, 0.5, 0xe6d6b0);

    // ---- cartoon water (slip pools + the falls) --------------------------
    const waterNrm = assetTexture("Water00_nrm.png", 2.2, 2.2, false);
    function waterCanvas() {
      const S = 256;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = S;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(S, S);
      const d = img.data;
      const lo = [26, 96, 132],
        hi = [76, 168, 196]; // teal pool: base -> ripple
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const u = x / S,
            v = y / S;
          let n =
            0.5 +
            0.3 * Math.sin(2 * Math.PI * (u + v)) +
            0.2 * Math.sin(2 * Math.PI * (2 * u - v) + 1.3);
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
    const waterMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: waterTex,
        transparent: true,
        opacity: 0.92,
        roughness: 0.28,
        metalness: 0.1,
        envMapIntensity: 0.5,
        emissive: 0x0e3a52,
        emissiveIntensity: 0.06,
        normalMap: waterNrm,
        normalScale: new THREE.Vector2(0.14, 0.14),
        depthWrite: false,
      }),
    );
    function puddleShape(seed, scale = 1) {
      const s = new THREE.Shape();
      const rnd = (salt) => hashFloat(seed, salt, 211);
      const ph1 = rnd(1) * 6.283,
        ph2 = rnd(2) * 6.283;
      const radius = (0.34 + rnd(4) * 0.03) * scale;
      const rx = radius * (1.02 + (rnd(5) - 0.5) * 0.08);
      const ry = radius * (0.98 + (rnd(6) - 0.5) * 0.08);
      const n = 80;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        const w =
          1 + 0.06 * Math.sin(t * 3 + ph1) + 0.035 * Math.sin(t * 5 + ph2);
        const x = Math.cos(t) * rx * w,
          y = Math.sin(t) * ry * w;
        if (i === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
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
      for (let i = 0; i < steps; i++)
        push(-w / 2 + (i / steps) * w, -d / 2, i, i === 0 ? 0.3 : 1);
      for (let i = 0; i < steps; i++)
        push(w / 2, -d / 2 + (i / steps) * d, 20 + i, i === 0 ? 0.3 : 1);
      for (let i = 0; i < steps; i++)
        push(w / 2 - (i / steps) * w, d / 2, 40 + i, i === 0 ? 0.3 : 1);
      for (let i = 0; i < steps; i++)
        push(-w / 2, d / 2 - (i / steps) * d, 60 + i, i === 0 ? 0.3 : 1);
      return new THREE.Shape(pts);
    }

    function addPlateau({
      x,
      z,
      w,
      d,
      topY,
      bottomY,
      seed,
      topMat = shelfGrassMat,
      sideMat = cliffMat,
      jag = 0.55,
      steps = 7,
    }) {
      const depth = Math.max(0.2, topY - bottomY);
      const geo = track(
        new THREE.ExtrudeGeometry(plateauShape(w, d, seed, steps, jag), {
          depth,
          bevelEnabled: true,
          bevelSize: 0.04,
          bevelThickness: 0.035,
          bevelSegments: 1,
        }),
      );
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
    function addBumpyRockIsland({
      x,
      z,
      w,
      d,
      topY,
      bottomY,
      seed,
      topMat,
      sideMat,
      jag = 0.5,
      outlineSteps = 14,
      extrudeSteps = 12,
      amp = 1.1,
      taper = 0,
    }) {
      const depth = Math.max(0.2, topY - bottomY);
      const geo = track(
        new THREE.ExtrudeGeometry(plateauShape(w, d, seed, outlineSteps, jag), {
          depth,
          steps: extrudeSteps,
          bevelEnabled: true,
          bevelSize: 0.04,
          bevelThickness: 0.035,
          bevelSegments: 1,
        }),
      );
      geo.rotateX(Math.PI / 2);
      geo.translate(x, topY, z);
      const pos = geo.attributes.position;
      const span = Math.max(0.001, topY - bottomY);
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i),
          vy = pos.getY(i),
          vz = pos.getZ(i);
        const df = Math.min(1, Math.max(0, (topY - vy) / span)); // 0 top .. 1 bottom
        if (df <= 0.002) continue; // keep the top rim crisp
        let dx = vx - x,
          dz = vz - z;
        // taper: shrink the footprint radially with depth, so the island
        // narrows toward a rough point below (the classic floating-island cone)
        if (taper > 0) {
          const f = 1 - taper * df;
          dx *= f;
          dz *= f;
        }
        const r = Math.hypot(dx, dz) || 1;
        const lump =
          0.55 * Math.sin(vx * 0.85 + vy * 0.6 + seed) +
          0.45 * Math.sin(vz * 1.05 - vy * 0.5 + seed * 0.3) +
          0.3 * Math.sin((vx + vz) * 0.7 + vy * 1.2 + seed * 0.7);
        const jitter =
          hashFloat(
            Math.round(vx * 6) + 200,
            Math.round(vz * 6) + 90,
            Math.round(vy * 6),
          ) - 0.5;
        const off = (lump + jitter * 0.8) * amp * df;
        pos.setX(i, x + dx + (dx / r) * off);
        pos.setZ(i, z + dz + (dz / r) * off);
        pos.setY(i, vy + jitter * 0.5 * df); // a little vertical crag
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    function ridgeShape(w, d, seed, jag = 0.08) {
      const pts = [];
      const hw = w * 0.5,
        hd = d * 0.5;
      const n = Math.max(24, Math.ceil((w + d) * 6));
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const co = Math.cos(t),
          si = Math.sin(t);
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
      const geo = track(
        new THREE.ExtrudeGeometry(
          ridgeShape(w, d, seed, Math.min(0.16, 0.04 + Math.max(w, d) * 0.012)),
          {
            depth,
            bevelEnabled: true,
            bevelSize: 0.055,
            bevelThickness: 0.045,
            bevelSegments: 2,
          },
        ),
      );
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
    // rock sides TAPERING to a rough point far below (triangular silhouette)
    addBumpyRockIsland({
      x: CTR,
      z: CTR,
      w: 23.6,
      d: 23.4,
      topY: -0.08,
      bottomY: -17.0,
      seed: 100,
      topMat: sandyTopMat,
      sideMat: cliffMat,
      jag: 0.42,
      amp: 1.15,
      taper: 0.82,
      extrudeSteps: 16,
    });

    // ---- board surface: one continuous playable plateau, sandy/dirt top.
    // Deliberately NOT a neat square: a chunky, jagged organic outline (still
    // fully containing the 20x20 play area) so the arena reads as terrain.
    addPlateau({
      x: CTR,
      z: CTR,
      w: 21.7,
      d: 21.7,
      topY: GRASS_TOP,
      bottomY: -0.14,
      seed: 210,
      topMat: sandyTopMat,
      sideMat: grassEdgeMats[1],
      jag: 0.85,
      steps: 6,
    });

    // A few soft dirt scars break up the green without covering gameplay markers.
    const dirtPatchMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x8b6a43,
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    );
    for (let i = 0; i < 18; i++) {
      const h = hash(i * 31 + 9, 8800);
      const patch = new THREE.Mesh(
        track(new THREE.CircleGeometry(0.45 + (h % 40) / 100, 18)),
        dirtPatchMat,
      );
      patch.rotation.x = -Math.PI / 2;
      patch.scale.set(
        1 + ((h >>> 4) % 60) / 80,
        0.45 + ((h >>> 8) % 50) / 100,
        1,
      );
      patch.rotation.z = (h % 628) / 100;
      patch.position.set(
        1.4 + (h % 172) / 10,
        GRASS_TOP + 0.006,
        1.1 + ((h >>> 6) % 178) / 10,
      );
      patch.renderOrder = 1;
      group.add(patch);
    }

    // ---- rock maze: raised mossy shelves, merged into organic runs --------
    const rows = world.rows || [];
    const wallCells = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if ((rows[r] || "")[c] === "#") wallCells.push([r, c]);
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
          x,
          z,
          w,
          d,
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
          if (!isWall(r, c) || isUsed(r, c)) {
            c++;
            continue;
          }
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
          if (!isWall(r, c) || isUsed(r, c)) {
            r++;
            continue;
          }
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
      const cx = c + 0.5,
        cz = r + 0.5;
      const seed = hash(r * 17 + 3, c * 29 + 7) >>> 0;
      const geo = track(
        new THREE.ExtrudeGeometry(puddleShape(seed, 1.0), {
          depth: 0.015,
          bevelEnabled: true,
          bevelThickness: 0.04,
          bevelSize: 0.045,
          bevelSegments: 4,
        }),
      );
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
      let mx = 0,
        mz = 0;
      for (const [r, c] of goals) {
        mx += c + 0.5;
        mz += r + 0.5;
      }
      mx /= goals.length;
      mz /= goals.length;
      const moonGeo = track(new THREE.IcosahedronGeometry(0.42, 1));
      const moonMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xffe9a0,
          emissive: 0xffc23a,
          emissiveIntensity: 0.6,
          roughness: 0.5,
          metalness: 0.0,
          flatShading: true,
        }),
      );
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
    // floaters at VERY different heights left + right, for vertical depth
    [
      [
        "WaterfallWorldHomeFloaterIsland000.dae",
        -5.5,
        4.0,
        2.0,
        5.2,
        0.55,
        0.0,
      ],
      [
        "WaterfallWorldHomeFloaterIsland001.dae",
        -12.0,
        17.0,
        -6.5,
        4.6,
        -0.45,
        2.1,
      ],
      [
        "WaterfallWorldHomeFloaterIsland000.dae",
        28.0,
        14.0,
        11.5,
        5.6,
        -0.2,
        1.2,
      ],
      [
        "WaterfallWorldHomeFloaterIsland001.dae",
        26.5,
        2.0,
        -4.0,
        4.4,
        0.35,
        2.8,
      ],
      // between the two right-side floaters, a bit further out
      [
        "WaterfallWorldHomeFloaterIsland000.dae",
        30.0,
        20.0,
        -10,
        7.5,
        0.9,
        3.4,
      ],
    ].forEach(([name, x, z, y, foot, ry, ph]) =>
      place(name, x, z, {
        baseY: y,
        footprint: foot,
        ry,
        onPlaced: (w) => {
          applyIslandGrass(w);
          islands.push({ w, y, ph });
        },
      }),
    );

    // ---- the Odyssey, moored in the sky off the arena's right side --------
    // Mario's hat-shaped airship (vendored ShineTower rip), bobbing gently
    // like the floater islands.
    place("odyssey/ShineTower.dae", 28.5, 13.5, {
      baseY: 1.0,
      footprint: 12.5,
      ry: -0.6, // angled so the bow faces the arena
      // moored: bobs and SWAYS around its heading (no full rotation)
      onPlaced: (w) => ships.push({ w, y: 1.0, ry: -0.6, ph: 3.6 }),
    });

    // ---- the Broodals' wooden airship, moored off the LEFT side -----------
    place("broodal-ship/Ship.dae", -8.0, 12.5, {
      baseY: 1.5,
      footprint: 11.0,
      ry: 0.6, // mirrored: bow toward the arena
      onPlaced: (w) => ships.push({ w, y: 1.5, ry: 0.6, ph: 1.4 }),
    });

    // ---- fossils EMBEDDED in the main island itself: rib-cages erode out of
    // BOTH tapered flanks (no separate islets), and the great skull juts from
    // the south face, watching the camera. Bases are sunk into the rock so the
    // bones read as part of the island.
    place("WaterfallWorldHomeBone001.dae", -3.5, 10.0, {
      baseY: -9.8,
      footprint: 15.0,
      ry: -1.5, // west flank (tuned by eye)
    });
    place("WaterfallWorldHomeBone001.dae", 23.5, 10.0, {
      baseY: -9.8,
      footprint: 15.0,
      ry: -1.5 + Math.PI, // east flank (mirrored)
    });
    place("WaterfallWorldHomeBone000.dae", 10.75, 21.0, {
      baseY: -6.5,
      footprint: 7.5,
      ry: 0, // the skull on the south face (tuned live via the dev bar)
    });

    // ---- the SURROUNDING RING: single Ground chunks from the pack placed as
    // modular cliff masses east/west/south-below, so the terrain wraps all the
    // way around the arena and the raw sky never shows below the horizon.
    // Tops stay a few units BELOW the board so nothing crowds the maze.
    place("WaterfallWorldHomeGround007.dae", -37, -15, {
      footprint: 50,
      baseY: -36,
      ry: 2.2,
    });
    place("WaterfallWorldHomeGround001.dae", 60, -20, {
      footprint: 48,
      baseY: -80,
      ry: 4.12, // tuned live via the dev bar
    });
    place("WaterfallWorldHomeGround006.dae", 10, 38, {
      footprint: 60,
      baseY: -44,
      ry: 0.15,
    });

    // ---- the mist sea: soft drifting haze layers far below the islands, so
    // looking down between them you see fog, never a "bottom"
    const hazes = [];
    {
      function hazeCanvas() {
        const S = 256;
        const cv = document.createElement("canvas");
        cv.width = cv.height = S;
        const ctx = cv.getContext("2d");
        const g = ctx.createRadialGradient(
          S / 2,
          S / 2,
          S * 0.1,
          S / 2,
          S / 2,
          S * 0.5,
        );
        g.addColorStop(0, "rgba(236,246,252,0.95)");
        g.addColorStop(0.55, "rgba(226,240,250,0.55)");
        g.addColorStop(1, "rgba(220,236,250,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        return cv;
      }
      const hazeTex = trackTexture(new THREE.CanvasTexture(hazeCanvas()));
      hazeTex.colorSpace = THREE.SRGBColorSpace;
      const hazeGeo = track(new THREE.PlaneGeometry(1, 1));
      for (const [hx, hy, hz, w, d, op, ph] of [
        // thin veils up high, denser sea further down - terrain tops stay visible
        [10, -16, 6, 170, 120, 0.28, 0.0],
        [-16, -23, 14, 150, 110, 0.38, 1.7],
        [34, -23, 18, 150, 110, 0.38, 3.9],
        [10, -32, 10, 240, 180, 0.55, 2.6],
        [10, -44, 12, 330, 250, 0.8, 5.1],
      ]) {
        const m = track(
          new THREE.MeshBasicMaterial({
            map: hazeTex,
            transparent: true,
            opacity: op,
            depthWrite: false,
            fog: false,
          }),
        );
        const p = new THREE.Mesh(hazeGeo, m);
        p.rotation.x = -Math.PI / 2;
        p.scale.set(w, d, 1);
        p.position.set(hx, hy, hz);
        p.renderOrder = 1;
        group.add(p);
        hazes.push({ mesh: p, baseX: hx, baseZ: hz, ph });
      }

      // --- the CLOUD DECK: big lit cartoon clouds (lobed spheres, same recipe
      // as the waterfall's crown) drifting LOW on the sides and out front, so
      // the fog reads clearly without a glowing sheet.
      const deckMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xf4f7fa, // just shy of white: only the sunniest tops kiss the bloom
          transparent: true,
          opacity: 0.92,
          roughness: 0.9,
          metalness: 0,
          emissive: 0xcfdfec,
          emissiveIntensity: 0, // no self-glow at all - lit purely by the sun
          depthWrite: false,
        }),
      );
      const deckGeo = track(new THREE.SphereGeometry(1, 12, 9));
      function deckCloud(x, y, z, scale, seed, ph) {
        const cl = new THREE.Group();
        const heart = new THREE.Mesh(deckGeo, deckMat);
        heart.scale.set(scale * 0.9, scale * 0.42, scale * 0.75);
        cl.add(heart);
        for (let i = 0; i < 5; i++) {
          const lobe = new THREE.Mesh(deckGeo, deckMat);
          const a = (i / 5) * Math.PI * 2 + hashFloat(seed, i, 81) * 0.9;
          const rr = scale * (0.5 + hashFloat(seed, i, 82) * 0.35);
          lobe.position.set(
            Math.cos(a) * rr,
            (hashFloat(seed, i, 83) - 0.5) * scale * 0.2,
            Math.sin(a) * rr * 0.7,
          );
          const s = scale * (0.35 + hashFloat(seed, i, 84) * 0.3);
          lobe.scale.set(s, s * 0.45, s * 0.85);
          cl.add(lobe);
        }
        cl.position.set(x, y, z);
        // keep the white puffs OUT of the bloom pass - lit white geometry over
        // a pale sky blooms hard otherwise (the "way too much glow")
        cl.traverse((o) => (o.userData.excludeBloom = true));
        group.add(cl);
        mists.push({ mesh: cl, base: y, ph });
      }
      [
        // left side, low
        [-15, -14, 6, 7, 0.4],
        [-11, -17, 18, 8.5, 1.8],
        [-19, -20, 27, 9, 5.6],
        // right side, low
        [34, -15, 4, 7, 4.4],
        [38, -18, 16, 8, 0.9],
        [31, -20, 27, 9.5, 3.1],
        // out front (south, toward the camera), lowest
        [-2, -22, 32, 10, 2.3],
        [12, -24, 35, 12, 3.7],
        [25, -22, 33, 10, 5.0],
        // back-left and middle-back right
        [-21, -15, -16, 8.5, 1.1],
        [31, -15, -2, 8, 4.8],
      ].forEach(([x, y, z, s, ph], i) => deckCloud(x, y, z, s, 700 + i, ph));
    }

    // ---- backdrop: the REAL Fossil Falls level, self-assembled ------------
    // Every WaterfallWorldHome chunk in the pack still carries its authentic
    // in-level transform, so loading them together re-assembles the actual
    // Cascade Kingdom island - tiered red-rock cliffs, grassy plateaus, the
    // sauropod skeleton, the stone bridge and the summit pond - as one giant
    // floating diorama rising behind the arena (the reference-photo look).
    // The flat board island keeps floating dead-centre in front of it.
    {
      const LEVEL_FILES = [
        "WaterfallWorldHomeGround000.dae",
        "WaterfallWorldHomeGround001.dae",
        "WaterfallWorldHomeGround002.dae",
        "WaterfallWorldHomeGround003.dae",
        "WaterfallWorldHomeGround004.dae",
        "WaterfallWorldHomeGround005.dae",
        "WaterfallWorldHomeGround006.dae",
        "WaterfallWorldHomeGround007.dae",
        "WaterfallWorldHomeBone000.dae", // sauropod skull (BoneSaursHead)
        "WaterfallWorldHomeBone001.dae", // rib-cage bone set
        "WaterfallWorldHomeStoneBridge.dae",
        "WaterfallWorldHomeWater000.dae", // summit pond (retextured below)
      ];
      // layout knobs (tuned from screenshots)
      const LEVEL_TARGET = 190; // world-units footprint of the widest side
      const LEVEL_ROT = -Math.PI / 4; // yaw the tiered/skeleton face toward the camera
      const LEVEL_X = CTR - 15; // slid west of the board centre
      const LEVEL_TOP_Y = 16; // plateau top rises this far above the board
      const LEVEL_FRONT_Z = 7; // nearest cliff face, overlapping the board's north edge

      // the export's water meshes reference a blank UV-distortion map and render
      // white - swap them for real reflective water (ripples animate in update()).
      pondNrm = assetTexture("Water00_nrm.png", 5, 5, false);
      const levelWaterMat = track(
        new THREE.MeshPhysicalMaterial({
          color: 0x1d5a66,
          roughness: 0.1,
          metalness: 0,
          envMapIntensity: 2.5,
          transparent: true,
          opacity: 0.92,
          normalMap: pondNrm,
          normalScale: new THREE.Vector2(0.5, 0.5),
          clearcoat: 1.0,
          clearcoatRoughness: 0.08,
          ior: 1.33,
          depthWrite: false,
        }),
      );

      const level = new THREE.Group();
      Promise.all(LEVEL_FILES.map((f) => loadModel(f)))
        .then((protosArr) => {
          if (disposed) return;
          for (const proto of protosArr) {
            if (!proto) continue;
            const inst = cloneSkinned(proto); // keep the native in-level transform
            inst.traverse((o) => {
              if (!o.isMesh) return;
              o.castShadow = false; // backdrop only receives - shadow pass stays cheap
              const ms = Array.isArray(o.material) ? o.material : [o.material];
              // the black warp-gate covers are level-logic props, not scenery
              if (ms.some((m) => /commongateblack/i.test(m?.name || ""))) {
                o.visible = false;
                return;
              }
              if (ms.some((m) => /water00|waterconnect/i.test(m?.name || ""))) {
                o.material = levelWaterMat;
                o.renderOrder = 2;
              }
            });
            level.add(inst);
          }
          // fit: centre the assembly, bbox top plateau at LEVEL_TOP_Y, nearest
          // cliff face at LEVEL_FRONT_Z, uniformly scaled to LEVEL_TARGET across
          level.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(level);
          const size = box.getSize(new THREE.Vector3());
          const ctr = box.getCenter(new THREE.Vector3());
          const s = LEVEL_TARGET / (Math.max(size.x, size.z) || 1);
          level.position.set(-ctr.x, -box.max.y, -ctr.z); // bbox top -> wrap origin
          const wrap = new THREE.Group();
          wrap.add(level);
          wrap.scale.setScalar(s);
          wrap.rotation.y = LEVEL_ROT;
          wrap.position.set(
            LEVEL_X,
            LEVEL_TOP_Y,
            LEVEL_FRONT_Z - (size.z * s) / 2,
          );
          group.add(wrap);
        })
        .catch((e) => console.warn("Fossil Falls level failed to assemble", e))
        .finally(() => markReady()); // never hang the round transition

      // --- the great waterfall: a streaked sheet pouring off the front cliff,
      // past the arena's depth, into the void below (positions tuned by eye)
      const WF_X = CTR; // slid west along with the diorama
      const WF_Z = -7.2; // hugs the now-closer cliff face
      const WF_TOP_Y = 6.0;
      const WF_BOT_Y = -46.0;

      // a vertical streak texture for the falling water
      function waterfallCanvas() {
        const W = 48,
          H = 256;
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext("2d");
        const img = ctx.createImageData(W, H);
        const d = img.data;
        const lo = [78, 150, 182],
          hi = [232, 246, 251];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = x / W,
              v = y / H;
            const col = hashFloat(x, 7, 333);
            let n =
              0.42 +
              0.42 * col +
              0.18 * Math.sin(2 * Math.PI * (v * 3 + col * 2)) +
              0.1 * Math.sin(2 * Math.PI * (v * 7 - col));
            n = Math.max(0, Math.min(1, n));
            const i = (y * W + x) * 4;
            d[i] = lo[0] + (hi[0] - lo[0]) * n;
            d[i + 1] = lo[1] + (hi[1] - lo[1]) * n;
            d[i + 2] = lo[2] + (hi[2] - lo[2]) * n;
            const edge = Math.min(1, Math.min(u, 1 - u) / 0.12); // soften side seams
            d[i + 3] = (200 + 55 * n) * (0.45 + 0.55 * edge);
          }
        }
        ctx.putImageData(img, 0, 0);
        return cv;
      }
      const fallTex = trackTexture(new THREE.CanvasTexture(waterfallCanvas()));
      fallTex.colorSpace = THREE.SRGBColorSpace;
      fallTex.wrapS = fallTex.wrapT = THREE.RepeatWrapping;
      fallTex.repeat.set(1, 4.6);
      fallTex.anisotropy = maxAnisotropy;
      const fallMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: fallTex,
          transparent: true,
          opacity: 0.94,
          roughness: 0.22,
          metalness: 0,
          emissive: 0xbfe6f2,
          emissiveIntensity: 0.2,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      // a tapered sheet (wider at the foot), hanging straight down the cliff face
      const len = WF_TOP_Y - WF_BOT_Y;
      const fallGeo = track(new THREE.PlaneGeometry(1, len, 3, 14));
      {
        const p = fallGeo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const vf = (p.getY(i) + len / 2) / len; // 0 bottom .. 1 top
          p.setX(i, p.getX(i) * (5.6 + (3.2 - 5.6) * vf)); // 5.6 wide foot -> 3.2 lip
        }
        p.needsUpdate = true;
        fallGeo.computeVertexNormals();
      }
      const fall = new THREE.Mesh(fallGeo, fallMat);
      fall.position.set(WF_X, (WF_TOP_Y + WF_BOT_Y) / 2, WF_Z);
      fall.renderOrder = 4;
      group.add(fall);
      cascades.push({ tex: fallTex, mat: fallMat });

      // --- spray clouds: the cartoon look, but built like PUFFY CLOUDS - each
      // one a cluster of overlapping rounded lobes (Mario-style cumulus), not a
      // single squashed ball.
      const foamMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xf4f8fb, // just shy of white - a soft kiss of bloom on the crown
          transparent: true,
          opacity: 0.9,
          roughness: 0.55,
          metalness: 0,
          emissive: 0xeaf6ff,
          emissiveIntensity: 0.12,
          depthWrite: false,
        }),
      );
      const mistMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xf2fbff,
          transparent: true,
          opacity: 0.32,
          roughness: 0.6,
          metalness: 0,
          emissive: 0xdff2ff,
          emissiveIntensity: 0.08,
          depthWrite: false,
        }),
      );
      const lobeGeo = track(new THREE.SphereGeometry(1, 14, 10));
      function cartoonCloud(mat, scale, seed) {
        const cl = new THREE.Group();
        // big soft heart of the cloud
        const heart = new THREE.Mesh(lobeGeo, mat);
        heart.scale.set(scale * 0.8, scale * 0.6, scale * 0.7);
        cl.add(heart);
        // 5 lobes bulging out around it at varied sizes/heights
        for (let i = 0; i < 5; i++) {
          const lobe = new THREE.Mesh(lobeGeo, mat);
          const a = (i / 5) * Math.PI * 2 + hashFloat(seed, i, 41) * 0.9;
          const r = scale * (0.45 + hashFloat(seed, i, 42) * 0.3);
          lobe.position.set(
            Math.cos(a) * r,
            (hashFloat(seed, i, 43) - 0.35) * scale * 0.35,
            Math.sin(a) * r * 0.6,
          );
          const s = scale * (0.35 + hashFloat(seed, i, 44) * 0.3);
          lobe.scale.set(s, s * 0.75, s);
          cl.add(lobe);
        }
        // spray clouds sit right at the bright waterfall - keep them out of the
        // bloom pass or they halo hard
        cl.traverse((o) => (o.userData.excludeBloom = true));
        group.add(cl);
        return cl;
      }
      // billowing crown where the water tips over the lip: a big central cloud
      // pulled toward the camera, flanked by two smaller companions
      const crown = cartoonCloud(foamMat, 2.4, 501);
      crown.position.set(WF_X, WF_TOP_Y + 0.35, WF_Z + 1.6);
      mists.push({ mesh: crown, base: WF_TOP_Y + 0.35, ph: 0.6 });
      const crownL = cartoonCloud(foamMat, 1.5, 502);
      crownL.position.set(WF_X - 2.8, WF_TOP_Y + 0.1, WF_Z + 1.2);
      mists.push({ mesh: crownL, base: WF_TOP_Y + 0.1, ph: 1.9 });
      const crownR = cartoonCloud(foamMat, 1.6, 503);
      crownR.position.set(WF_X + 2.9, WF_TOP_Y + 0.2, WF_Z + 1.3);
      mists.push({ mesh: crownR, base: WF_TOP_Y + 0.2, ph: 4.2 });
      // smaller cloud puffs drifting down the upper drop
      for (let i = 0; i < 8; i++) {
        const py = WF_TOP_Y - 3.0 - hashFloat(i, 2, 3) * 10.0;
        const puff = cartoonCloud(
          mistMat,
          1.2 + hashFloat(i, 5, 45) * 0.7,
          510 + i,
        );
        puff.position.set(
          WF_X + (hashFloat(i, 4, 6) - 0.5) * 6.5,
          py,
          WF_Z + 1.0,
        );
        mists.push({ mesh: puff, base: py, ph: 3 + i * 2.1 });
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
        pondNrm.offset.x = Math.sin(t * 0.18) * 0.4 + t * 0.013; // gentle swirling ripples
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
      for (const s of ships) {
        // airships ride at anchor: gentle bob + a slight back-and-forth sway
        // about their mooring heading, never a full turn
        s.w.position.y = s.y + Math.sin(t * 0.5 + s.ph) * 0.3;
        s.w.rotation.y = s.ry + Math.sin(t * 0.22 + s.ph) * 0.13;
        s.w.rotation.z = Math.sin(t * 0.35 + s.ph * 0.7) * 0.02;
      }
      for (const cas of cascades) {
        cas.tex.offset.y += dt * 1.1; // streaks tumble downward toward the pond
        cas.tex.offset.x = Math.sin(t * 0.7) * 0.02; // faint sway
        cas.mat.emissiveIntensity = 0.16 + 0.06 * Math.sin(t * 3.1);
      }
      for (const rp of ripples) {
        const ph = (((t * rp.speed + rp.off) % 1) + 1) % 1;
        const rad = rp.r0 + ph * rp.grow;
        rp.mesh.scale.set(rad * rp.ax, 1, rad * rp.az); // elliptical, matching the pool
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
      for (const h of hazes) {
        // the mist sea drifts slowly and breathes a little
        h.mesh.position.x = h.baseX + Math.sin(t * 0.05 + h.ph) * 6;
        h.mesh.position.z = h.baseZ + Math.cos(t * 0.04 + h.ph * 1.3) * 5;
        h.mesh.rotation.z = t * 0.008 + h.ph;
      }
    }

    function dispose() {
      disposed = true;
      scene.remove(group);
      for (const o of trash) o.dispose?.();
    }

    return { group, ready, update, dispose };
  },
};
