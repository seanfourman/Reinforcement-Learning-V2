// Round 3 — Fossil Falls (Cascade Kingdom), stripped to its core pieces.
//
// Just the essentials float in the sky: the 20x20 RL board lives directly ON
// the flat summit of a floating ROCK ISLAND - no raised platform, and NO grass
// up here. The playfield is a dry field of slightly-irregular FLAGSTONE SLABS
// (one per cell, dirt seams between them, a soft light/deep checker in cool
// limestone tones) cut straight into the summit, so the grid reads as natural
// terrain instead of a game board sitting on terrain. Wall cells carry REAL
// Cascade rocks: a clone of the pack's worn red-rock boulder
// (WaterfallWorldHomeRock002) per '#' cell, quarter-turn yaws and hashed
// sizes, overlapping neighbours so runs read as continuous rocky ridges.
// Slippery ('S') cells are darker WET-SHEEN slabs and the goal slabs are
// pale gold stone under the floating POWER MOON.
// 4 Cascade FLOATER ISLANDS hang off the left and right sides.
//
// Nothing may cover the y=0 board surface. Models come from the vendored Cascade
// Kingdom Collada pack in assets/models/fossil-falls (DJ_Fox11 / Models Resource).

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const GRID = 19; // R3's maze fills a 19x19 board (matches rl/worlds/fossilfalls.py)
const CTR = GRID / 2;
const ASSETS = "./assets/models/fossil-falls/";
const ISLAND_GRASS = "./assets/models/city-newdonk/GroundLawn00_alb.png";
const SLAB_TOP = 0.04; // flagstone-slab top surface, kept below decals/heatmap

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
  // wider shot than the default 30 so the assembled level around the arena shows.
  // 19x19 board (cells 0..18, cell=1) -> true centre is world (9.5, 9.5); the
  // default target assumes GRID=20 and lands at (10, 11), off to the up-left, so
  // pin the look-at to the real board centre and clamp pans to the 19 footprint.
  camera: { startDist: 38, maxDist: 38, target: [9.5, 0, 9.5], gridSize: 19 },
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
      // pack files resolve under ASSETS; an explicit ./ or / path (e.g. the shared
      // Goomba under assets/objects/) loads as-is so its own textures resolve beside it
      const url = /^(\.?\/)/.test(name) ? name : ASSETS + name;
      if (!protos.has(name)) {
        protos.set(
          name,
          collada
            .loadAsync(url)
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
    // the board floor: dry flagstone in two close limestone families for a
    // soft checker - LIGHT tops on (r+c)-even cells, DEEP on odd, hash-varied
    // inside each family so the grid reads at a glance without ever looking
    // like a printed chessboard. Cool stone tones, so the warm red mesas and
    // sandy apron stay clearly separate.
    const slabRockTex = assetTexture("GroundBaseRock00_alb.png", 1, 1);
    const slabMat = (color, opts = {}) =>
      track(
        new THREE.MeshStandardMaterial({
          map: slabRockTex,
          color,
          roughness: 0.9,
          metalness: 0,
          ...opts,
        }),
      );
    const stoneLightMats = [0xd2dde4, 0xcad5dd, 0xdae4ea].map((c) =>
      slabMat(c),
    );
    const stoneDeepMats = [0xb4c1c9, 0xacb9c1, 0xbcc8d0].map((c) => slabMat(c));
    // the goal + slip cells now keep a NORMAL stone slab (the hovering Moon /
    // the puddle blob mark them); no special gold/wet slab tops any more.
    // slippery cells get the SAME 3D cartoon-water PUDDLE as the city arena: a procedural
    // turquoise ripple texture on a wobbly extruded blob standing out of the floor; the
    // ripples scroll in update(). (Ported from themes/city.js.)
    function _waterCanvas() {
      const S = 256, cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const ctx = cv.getContext("2d"), img = ctx.createImageData(S, S), d = img.data;
      const lo = [24, 78, 140], hi = [58, 128, 190];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        let n = 0.5 + 0.30 * Math.sin(2 * Math.PI * (u + v)) + 0.20 * Math.sin(2 * Math.PI * (2 * u - v) + 1.3);
        n = Math.max(0, Math.min(1, 0.5 + (n - 0.5) * 0.7));
        const i = (y * S + x) * 4;
        d[i] = lo[0] + (hi[0] - lo[0]) * n;
        d[i + 1] = lo[1] + (hi[1] - lo[1]) * n;
        d[i + 2] = lo[2] + (hi[2] - lo[2]) * n;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return cv;
    }
    const puddleTex = trackTexture(new THREE.CanvasTexture(_waterCanvas()));
    puddleTex.colorSpace = THREE.SRGBColorSpace;
    puddleTex.wrapS = puddleTex.wrapT = THREE.RepeatWrapping;
    puddleTex.repeat.set(1.6, 1.6);
    puddleTex.anisotropy = maxAnisotropy;
    const puddleMat = track(new THREE.MeshStandardMaterial({
      color: 0xffffff, map: puddleTex, transparent: true, opacity: 0.92,
      roughness: 0.3, metalness: 0.1, emissive: 0x123a66, emissiveIntensity: 0.06,
      normalMap: assetTexture("Water00_nrm.png", 2.2, 2.2, false),
      normalScale: new THREE.Vector2(0.14, 0.14), depthWrite: false,
    }));
    function puddleShape(seed) {
      const s = new THREE.Shape();
      const rnd = (salt) => hashFloat(seed, salt, 211);
      const ph1 = rnd(1) * 6.283, ph2 = rnd(2) * 6.283;
      const radius = 0.34 + rnd(4) * 0.03;
      const rx = radius * (1.02 + (rnd(5) - 0.5) * 0.08);
      const ry = radius * (0.98 + (rnd(6) - 0.5) * 0.08);
      for (let i = 0, n = 80; i <= n; i++) {
        const th = (i / n) * Math.PI * 2;
        const w = 1 + 0.06 * Math.sin(th * 3 + ph1) + 0.035 * Math.sin(th * 5 + ph2);
        const x = Math.cos(th) * rx * w, y = Math.sin(th) * ry * w;
        if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
      }
      return s;
    }
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

    // ---- island + board shells -------------------------------------------
    const boulderMat = solid(0xa98d6f, { roughness: 1, flatShading: true });

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

    // The island shell: side + bottom vertices are pushed in/out by
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

    // little flat-shaded boulders, scattered on mesa caps and the summit apron.
    // 3 shared jittered dodecahedra; coincident vertex copies get the same
    // jitter (hashed by rounded position) so the hulls stay closed.
    const boulderGeos = [0, 1, 2].map((k) => {
      const g = track(new THREE.DodecahedronGeometry(1, 0));
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const key = (v) => Math.round(v * 8) + 40;
        const jit = (salt) =>
          (hashFloat(
            key(p.getX(i)) + salt,
            key(p.getY(i)) * 7 + key(p.getZ(i)),
            k,
          ) -
            0.5) *
          0.34;
        p.setXYZ(i, p.getX(i) + jit(1), p.getY(i) + jit(2), p.getZ(i) + jit(3));
      }
      g.computeVertexNormals();
      return g;
    });
    function addBoulder(x, y, z, s, seed) {
      const m = new THREE.Mesh(
        boulderGeos[hash(seed, 7) % boulderGeos.length],
        boulderMat,
      );
      m.scale.set(
        s * (0.8 + hashFloat(seed, 1, 721) * 0.5),
        s * (0.55 + hashFloat(seed, 2, 722) * 0.4),
        s * (0.8 + hashFloat(seed, 3, 723) * 0.5),
      );
      m.rotation.y = hashFloat(seed, 4, 724) * Math.PI * 2;
      // sit the hull ~1/3 into the ground so it reads half-buried, not dropped
      m.position.set(x, y + m.scale.y * 0.62, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }

    // the floating rock island the board lives on: its FLAT SUMMIT (y=0) *is*
    // the play surface - no raised platform. Sandy top shows in the slab seams
    // and as a bare apron around the grid; craggy bumpy rock sides TAPER to a
    // rough point far below (triangular silhouette).
    addBumpyRockIsland({
      x: CTR,
      z: CTR,
      w: 23.6,
      d: 23.4,
      topY: 0,
      bottomY: -17.0,
      seed: 100,
      topMat: sandyTopMat,
      sideMat: cliffMat,
      jag: 0.42,
      amp: 1.15,
      taper: 0.82,
      extrudeSteps: 16,
    });

    // ---- the playfield: one flagstone slab per cell, cut into the summit --
    // Slightly-irregular rounded squares (same trick as the city park lawns)
    // with dirt sides, sunk into the island top so the sandy rock reads in the
    // seams. Slab tops sit at SLAB_TOP, safely under decals and the heatmap.
    function cellShape(r, c) {
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

    const slipSet = new Set(
      (world.slipCells || []).map(([r, c]) => `${r},${c}`),
    );
    function slabTopMat(r, c) {
      // the goal + slip cells keep a NORMAL stone slab (the Moon / puddle sits on top)
      const fam = (r + c) % 2 ? stoneDeepMats : stoneLightMats;
      return fam[hash(r * 19 + 11, c * 23 + 5) % fam.length];
    }
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        // slabs under EVERY cell, walls included, so the strata mesas rise
        // from turf instead of from a bare gap
        const geo = track(
          new THREE.ExtrudeGeometry(cellShape(r, c), {
            depth: 0.05,
            bevelEnabled: true,
            bevelSize: 0.014,
            bevelThickness: 0.01,
            bevelSegments: 1,
          }),
        );
        // extrude UVs are shape-local, so every slab would sample the SAME
        // patch of the rock texture (a stamped look): slide each slab's UVs
        // by a hashed offset so neighbours show different stone
        const uv = geo.attributes.uv;
        const du = hashFloat(r, c, 41),
          dv = hashFloat(r, c, 42);
        for (let i = 0; i < uv.count; i++)
          uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
        const h = hash(r * 7 + 3, c * 13 + 1);
        const mesh = new THREE.Mesh(geo, [
          slabTopMat(r, c),
          grassEdgeMats[h % grassEdgeMats.length],
        ]);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(
          c + 0.5,
          SLAB_TOP - 0.05 + hashFloat(r, c, 33) * 0.006,
          r + 0.5,
        );
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }

    // ---- slippery WET cells: a real 3D cartoon-water puddle blob per cell (same look as
    // the city arena), sitting on the stone slab. Ripples scroll in update().
    for (const [r, c] of world.slipCells || []) {
      const geo = track(new THREE.ExtrudeGeometry(puddleShape(hash(r * 17 + 3, c * 29 + 7) >>> 0), {
        depth: 0.015, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.045, bevelSegments: 4,
      }));
      geo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geo, puddleMat);
      water.position.set(c + 0.5, SLAB_TOP + 0.02, r + 0.5);
      water.renderOrder = 3;
      water.receiveShadow = true;
      group.add(water);
    }

    // a few half-buried boulders on the bare apron ring around the grid
    for (let i = 0; i < 14; i++) {
      const t = hashFloat(i, 3, 731);
      const side = hash(i, 733) % 4;
      const along = -10.6 + t * 21.2;
      const out = 10.55 + hashFloat(i, 5, 735) * 0.55;
      const bx =
        CTR + (side === 0 || side === 3 ? along : side === 1 ? out : -out);
      const bz = CTR + (side === 0 ? -out : side === 3 ? out : along);
      addBoulder(bx, 0, bz, 0.14 + hashFloat(i, 6, 737) * 0.18, 900 + i);
    }

    // ---- rock maze: REAL Cascade rocks on the wall cells ------------------
    // Each '#' cell gets its own clone of the pack's boulder
    // (WaterfallWorldHomeRock000 - one solid single-lump rock, so rows read
    // as walls, not gravel), with per-clone shape randomisation below, sized
    // to overlap its neighbours into continuous ridges.
    const rows = world.rows || [];
    {
      const cells = [];
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          if ((rows[r] || "")[c] === "#") cells.push([r, c]);
        }
      }
      if (cells.length)
        loadModel("WaterfallWorldHomeRock000.dae").then((proto) => {
          if (disposed || !proto) return;
          // hide the foliage cards baked into the model ONCE on the shared
          // prototype (150 identical sprouting plants would read as noise)
          proto.traverse((o) => {
            if (!o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            if (mats.some((m) => /grass|leaf|plant|flower/i.test(m?.name || "")))
              o.visible = false;
          });
          // the boulder's stock RockWall01 skin is mossy GREEN (reads as a
          // hedge from above) - reskin it in the island's own red-rock so the
          // maze matches the cliffs it floats on
          const wallSkin = track(
            new THREE.MeshStandardMaterial({
              map: assetTexture("RockWallBase03_alb.png", 1, 1),
              normalMap: assetTexture("RockWallBase03_nrm.png", 1, 1, false),
              roughnessMap: assetTexture("RockWallBase03_rgh.png", 1, 1, false),
              roughness: 0.95,
              metalness: 0,
            }),
          );
          proto.traverse((o) => {
            if (o.isMesh && o.visible) o.material = wallSkin;
          });
          // fit by the ROCK's own bounds - the (now hidden) grass cards
          // inflate the stock bounds and would shrink every clone
          const box = new THREE.Box3();
          proto.traverse((o) => {
            if (o.isMesh && o.visible) box.expandByObject(o);
          });
          const size = box.getSize(new THREE.Vector3());
          const ctr = box.getCenter(new THREE.Vector3());
          const fit = Math.max(size.x, size.z);
          for (const [r, c] of cells) {
            const inst = cloneSkinned(proto);
            inst.position.set(-ctr.x, -box.min.y, -ctr.z);
            const wrap = new THREE.Group();
            wrap.add(inst);
            // every clone gets its own silhouette: independent long/short
            // axes, a free spin (not quarter turns), a touch of tilt, a 50%
            // mirror and a little drift, so the same rock never reads twice
            const long = 1.12 + hashFloat(r, c, 921) * 0.26;
            const aspect = 0.72 + hashFloat(r, c, 925) * 0.33;
            const mirror = hash(r * 3 + 1, c * 7 + 5) & 1 ? -1 : 1;
            wrap.scale.set(
              (long / fit) * mirror,
              (0.55 + hashFloat(r, c, 922) * 0.35) / size.y,
              (long * aspect) / fit,
            );
            wrap.rotation.set(
              (hashFloat(r, c, 926) - 0.5) * 0.12,
              hashFloat(r, c, 923) * Math.PI * 2,
              (hashFloat(r, c, 927) - 0.5) * 0.12,
            );
            // rooted on the island top, poking up through the slab seams
            // (sunk a bit deeper so the random tilt never lifts the base)
            wrap.position.set(
              c + 0.5 + (hashFloat(r, c, 928) - 0.5) * 0.12,
              -0.04,
              r + 0.5 + (hashFloat(r, c, 929) - 0.5) * 0.12,
            );
            group.add(wrap);
          }
        });
    }

    // ---- the floating Power Moon over the goal cells ---------------------
    // The real R1 Shine model, tinted VIOLET (R3's own moon colour) - loaded
    // below near the other object models where the loader helpers exist.
    let moon = null;

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
    place("WaterfallWorldHomeBone001.dae", -4.5, 10.0, {
      baseY: -9.8,
      footprint: 15.0,
      ry: -1.5, // west flank (tuned by eye)
    });
    place("WaterfallWorldHomeBone001.dae", 23.0, 10.0, {
      baseY: -9.8,
      footprint: 15.0,
      ry: -1.5 + Math.PI, // east flank (mirrored)
    });
    place("WaterfallWorldHomeBone000.dae", 10.8, 21.0, {
      baseY: -7.0,
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
        [47, -15, -2, 8, 4.8],
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
    // ---- Round-3 patrolling Goombas: the REAL Odyssey Goomba (assets/objects/Goomba)
    // per world.goombas patrol, positioned each frame from the deterministic cells the
    // backend sends in frame.goombas. Each goomba gets an empty container Group now (so
    // update() can drive it immediately); the shared model is loaded + reskinned once
    // below and cloned into every container when it arrives.
    const GOOMBA_DAE = "./assets/objects/Goomba/Goomba.dae";
    const GOOMBA_TEX = "./assets/objects/Goomba/Textures/";
    const GOOMBA_HEIGHT = 0.72; // world units tall (~0.7 of a cell)
    const goombaMeshes = [];
    for (let i = 0; i < (world.goombas || []).length; i++) {
      const gm = new THREE.Group();
      gm.visible = false;
      group.add(gm);
      goombaMeshes.push({ g: gm, x: 0, z: 0, has: false });
    }
    if (goombaMeshes.length) {
      // The Goomba.dae is a Z-up SkinnedMesh with a broken skeleton and library-id
      // texture refs three can't bind - cloning it as-is MELTS the mesh. So (as in the
      // peach/city rounds) DESKIN it to rest-pose meshes, then reskin from its Textures/
      // PNGs by MATERIAL family (BodyMT / EyeLMT-R / HairMT). One shared material set is
      // reused across every clone (no per-clone PBR blow-up).
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
      const gTex = (name, color) => {
        // the body + eye meshes use MIRRORED (negative) UVs, so the texture must REPEAT-
        // wrap: clamping pinned the left half of the body and both eyes to a texture edge
        // (a flat smear / a grey blob). Repeat wraps -U back onto the real detail.
        const t = textureAt(GOOMBA_TEX + name, 1, 1, color);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        return t;
      };
      const skinFor = (key) => {
        const set =
          key === "eye"
            ? ["kuriboeye_alb.0.png", "kuriboeye_nrm.0.png", "kuriboeye_rgh.0.png"]
            : key === "hair"
              ? ["mariohairface_alb.png", "mariohairface_nrm.png", "mariohairface_rgh.png"]
              : ["kuribobody_alb.png", "kuribobody_nrm.png", "kuribobody_rgh.png"];
        return track(
          new THREE.MeshStandardMaterial({
            map: gTex(set[0], true),
            normalMap: gTex(set[1], false),
            roughnessMap: gTex(set[2], false),
            roughness: 0.85,
            metalness: 0,
          }),
        );
      };
      const skinCache = {};
      // the eyeballs use the EyeL/EyeR materials; the cap/face patch uses HairMT;
      // EVERYTHING else (body, brows, eye-whites) is BodyMT -> the brown body skin.
      const famOf = (o) => {
        const m = (o.material?.name || "").toLowerCase();
        const key = m.includes("hair") ? "hair" : m.includes("eye") ? "eye" : "body";
        return (skinCache[key] ||= skinFor(key));
      };
      collada.loadAsync(GOOMBA_DAE).then((asset) => {
        if (disposed) return;
        const root = deskin(asset.scene);
        root.traverse((o) => {
          if (!o.isMesh) return;
          // the model ships extra states stacked in one spot: PressModel is the flat
          // STOMPED disc (that was the spreading pancake), EyeClose/EyeHalfClose are
          // blink frames. Hide them all; keep only the standing body + wide-awake eyes.
          if (/PressModel|EyeClose|EyeHalfClose|Mustache/i.test(o.name || "")) { o.visible = false; return; }
          o.material = famOf(o);
          o.castShadow = true;
          o.receiveShadow = true;
          track(o.geometry);
        });
        // centre in XZ, sit the base at y=0, scale to a readable height
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const dim = box.getSize(new THREE.Vector3());
        const ctr = box.getCenter(new THREE.Vector3());
        root.position.set(-ctr.x, -box.min.y, -ctr.z);
        const proto = new THREE.Group();
        proto.add(root);
        proto.scale.setScalar(GOOMBA_HEIGHT / (dim.y || 1));
        for (const gm of goombaMeshes) gm.g.add(proto.clone());
      }).catch((e) => console.warn("Goomba failed to load", e));
    }

    // ---- Round-3 CAGE mechanic: a freeze-coin PICKUP per side (grab it to cage the
    // rival) + the Moon-Cage that DROPS from off-screen onto a caged agent. Both are
    // Z-up skinned DAEs, so deskin them (like the Goomba) then hand-skin from textures.
    const OBJ = "./assets/objects/";
    const objTex = (url, srgb) => {
      const tex = textureAt(encodeURI(url), 1, 1, srgb);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    };
    const deskinObj = (root) => {
      const sk = [];
      root.traverse((o) => o.isSkinnedMesh && sk.push(o));
      for (const sm of sk) {
        const m = new THREE.Mesh(sm.geometry, sm.material);
        m.name = sm.name;
        m.position.copy(sm.position);
        m.quaternion.copy(sm.quaternion);
        m.scale.copy(sm.scale);
        if (sm.parent) { sm.parent.add(m); sm.parent.remove(sm); }
      }
      return root;
    };
    const fitObj = (root, size, byHeight) => {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const d = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      root.position.set(-c.x, -box.min.y, -c.z);
      const wrap = new THREE.Group();
      wrap.add(root);
      wrap.scale.setScalar(size / ((byHeight ? d.y : Math.max(d.x, d.z)) || 1));
      return wrap;
    };

    // -- the floating Power Moon over the goal (R1's Shine model, tinted VIOLET) --
    // Same moon model as R1/R2; each round tints it a different colour. Here the
    // gold albedo is dropped for a solid violet tint, keeping the Shine's own
    // emissive pattern + normal relief so it still reads as a glowing Power Moon.
    {
      const goals = world.escape || [];
      if (goals.length) {
        let mx = 0, mz = 0;
        for (const [r, c] of goals) { mx += c + 0.5; mz += r + 0.5; }
        mx /= goals.length; mz /= goals.length;
        const SH = OBJ + "Shine/";
        const moonMat = track(new THREE.MeshStandardMaterial({
          color: 0xb98cff,                                     // violet body tint
          emissive: 0x8a3aff,
          emissiveMap: objTex(SH + "Textures/shinebody_emm.png", false),
          normalMap: objTex(SH + "Textures/shinebody_nrm.png", false),
          emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.4,
        }));
        collada.loadAsync(encodeURI(SH + "Shine.dae")).then((asset) => {
          if (disposed) return;
          const root = deskinObj(asset.scene);
          root.traverse((o) => { if (o.isMesh) o.material = moonMat; });
          const wrap = fitObj(root, 0.92, true);               // ~0.92 units tall
          wrap.position.set(mx, 1.25, mz);
          group.add(wrap);
          const glow = new THREE.PointLight(0xc08cff, 0.5, 6, 2);
          glow.position.set(mx, 1.25, mz);
          group.add(glow);
          moon = { mesh: wrap, mat: moonMat, light: glow, baseY: 1.25 };
        }).catch((e) => console.warn("Shine moon failed to load", e));
      }
    }

    // -- freeze-coin pickups at each side's cage cell -------------------------
    const cagePickups = [];
    const pickupSpec = [
      ...(world.blueCage || []).map((c) => ({ cell: c, side: "blue" })),
      ...(world.redCage || []).map((c) => ({ cell: c, side: "red" })),
    ];
    if (pickupSpec.length) {
      const coinMat = track(new THREE.MeshStandardMaterial({
        map: objTex(OBJ + "Regional Coins/CoinCollectA_alb.png", true),
        normalMap: objTex(OBJ + "Regional Coins/CoinCollectA_nrm.png", false),
        roughnessMap: objTex(OBJ + "Regional Coins/CoinCollectA_rgh.png", false),
        metalnessMap: objTex(OBJ + "Regional Coins/CoinCollectA_mtl.png", false),
        roughness: 0.6, metalness: 0.5,
      }));
      collada.loadAsync(encodeURI(OBJ + "Regional Coins/CoinCollectA.dae")).then((asset) => {
        if (disposed) return;
        const root = deskinObj(asset.scene);
        root.traverse((o) => { if (o.isMesh) { o.material = coinMat; o.castShadow = true; track(o.geometry); } });
        const proto = fitObj(root, 0.55, false);
        for (const p of pickupSpec) {
          const m = proto.clone();
          m.position.set(p.cell[1] + 0.5, 0.4, p.cell[0] + 0.5);
          group.add(m);
          cagePickups.push({ mesh: m, r: p.cell[0], c: p.cell[1] });
        }
      }).catch((e) => console.warn("Cage pickup failed to load", e));
    }

    // -- the drop cage (one per side, hidden until that agent is caged) -------
    const cageDrops = { red: null, blue: null };
    {
      const cageSkin = (key) => track(
        key === "glass" ? new THREE.MeshStandardMaterial({
          map: objTex(OBJ + "Moon Cage/CageSineGlass_alb.png", true), transparent: true,
          opacity: 0.32, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
        }) : key === "lamp" ? new THREE.MeshStandardMaterial({
          map: objTex(OBJ + "Moon Cage/CageSineLamp_alb.png", true),
          emissiveMap: objTex(OBJ + "Moon Cage/CageSineLamp_emm.png", true),
          emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 0.6,
        }) : key === "window" ? new THREE.MeshStandardMaterial({
          map: objTex(OBJ + "Moon Cage/CageSineWindow_alb.png", true),
          normalMap: objTex(OBJ + "Moon Cage/CageSineWindow_nrm.png", false), roughness: 0.7, metalness: 0.3,
        }) : new THREE.MeshStandardMaterial({
          map: objTex(OBJ + "Moon Cage/CageSineBody_alb.png", true),
          normalMap: objTex(OBJ + "Moon Cage/CageSineBody_nrm.png", false),
          roughnessMap: objTex(OBJ + "Moon Cage/CageSineBody_rgh.png", false), roughness: 0.6, metalness: 0.4,
        }));
      collada.loadAsync(encodeURI(OBJ + "Moon Cage/CageShine.dae")).then((asset) => {
        if (disposed) return;
        const root = deskinObj(asset.scene);
        const cache = {};
        root.traverse((o) => {
          if (!o.isMesh) return;
          const n = (o.material?.name || "").toLowerCase();
          const k = n.includes("glass") ? "glass" : n.includes("lamp") ? "lamp"
            : n.includes("window") ? "window" : "body";
          o.material = (cache[k] ||= cageSkin(k));
          track(o.geometry);
        });
        const proto = fitObj(root, 2.0, true);       // tall enough to loom over the caged agent
        for (const side of ["red", "blue"]) {
          const m = proto.clone();
          m.visible = false;
          group.add(m);
          cageDrops[side] = { mesh: m, y: 8, has: false };
        }
      }).catch((e) => console.warn("Cage failed to load", e));
    }

    function update(t, dt, frame) {
      if (pondNrm) {
        pondNrm.offset.x = Math.sin(t * 0.18) * 0.4 + t * 0.013; // gentle swirling ripples
        pondNrm.offset.y = Math.cos(t * 0.15) * 0.4 + t * 0.009;
      }
      // slippery-cell puddles: scroll the water ripples
      puddleTex.offset.x = Math.sin(t * 0.2) * 0.05 + t * 0.012;
      puddleTex.offset.y = Math.cos(t * 0.15) * 0.05 + t * 0.009;
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
      // Round-3 Goombas: ease toward the deterministic cell the backend reports each
      // frame (cell (r,c) -> world (c+0.5, r+0.5)); waddle + bob while they patrol.
      const gcells = (frame && frame.goombas) || [];
      for (let i = 0; i < goombaMeshes.length; i++) {
        const gm = goombaMeshes[i];
        const cell = gcells[i];
        if (!cell) {
          gm.g.visible = false;
          continue;
        }
        const tx = cell[1] + 0.5,
          tz = cell[0] + 0.5;
        if (!gm.has) {
          gm.x = tx;
          gm.z = tz;
          gm.has = true;
        }
        const k = Math.min(1, dt * 9);
        gm.x += (tx - gm.x) * k;
        gm.z += (tz - gm.z) * k;
        gm.g.visible = true;
        gm.g.position.set(gm.x, Math.abs(Math.sin(t * 6 + i)) * 0.06, gm.z);
        gm.g.rotation.z = Math.sin(t * 6 + i) * 0.13; // waddle
      }
      // Round-3 cage pickups: spin + bob; hide the instant a side grabs it (it drops
      // out of frame.blueCage / frame.redCage, which list only the pickups still there).
      if (cagePickups.length) {
        const remain = new Set([
          ...(((frame && frame.blueCage) || [])).map((c) => c[0] + "," + c[1]),
          ...(((frame && frame.redCage) || [])).map((c) => c[0] + "," + c[1]),
        ]);
        for (const p of cagePickups) {
          const alive = !frame || remain.has(p.r + "," + p.c);
          p.mesh.visible = alive;
          if (alive) {
            p.mesh.rotation.y = t * 2.2;
            p.mesh.position.y = 0.4 + Math.sin(t * 3 + p.c) * 0.07;
          }
        }
      }
      // Round-3 cage drops: while frame.caged[side] > 0, a cage falls from off-screen onto
      // that agent's cell and holds; when the freeze ends it lifts back up and hides.
      const caged = (frame && frame.caged) || {};
      for (const side of ["red", "blue"]) {
        const cd = cageDrops[side];
        if (!cd) continue;
        const cell = frame && frame[side];
        if ((caged[side] || 0) > 0 && cell) {
          if (!cd.has) { cd.y = 8; cd.has = true; }
          cd.y += (0 - cd.y) * Math.min(1, dt * 7);        // ease DOWN onto the agent
          cd.mesh.visible = true;
          cd.mesh.position.set(cell[1] + 0.5, cd.y, cell[0] + 0.5);
          cd.mesh.rotation.y = Math.sin(t * 2) * 0.05;
        } else if (cd.has) {
          cd.y += (9 - cd.y) * Math.min(1, dt * 6);        // lift back OFF-screen, then hide
          cd.mesh.position.y = cd.y;
          if (cd.y > 7.5) { cd.mesh.visible = false; cd.has = false; }
        } else {
          cd.mesh.visible = false;
        }
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
