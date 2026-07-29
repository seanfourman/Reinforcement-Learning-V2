// Round 5 — Tostarena (Sand Kingdom): the CAPTURE THE FLAG continuous arena.
//
// A STREET-LEVEL town square, composed like the city round (round 2), not the
// floating-island rounds: the arena is Tostarena's sandy plaza, the town's
// adobe buildings RING it on every side at ground level, and the desert runs
// to the fog. There is no grid: the two racers fight over a single flag on the
// centre pole, each hauling it to its own corner base while the other chases to
// steal it, smashing crates for power-ups along the way (see
// continuous.ContinuousArena._step_ctf_game). The Inverted Pyramid hovers
// tip-down beyond the north edge as the town monument.
//
// Nothing may cover the y=0 arena surface above ~0.16 (the racers' feet).
// Models come from the vendored Sand Kingdom OBJ/MTL pack in
// assets/models/tostarena (Models Resource rip, same pipeline as ruined.js).

import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { loadBoardWalker } from "../boardchars.js"; // Bowser rides the airship (idx 6)

const ASSETS = "./assets/models/tostarena/";

function hash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

export const tostarena = {
  name: "tostarena",
  title: "Dry Dry Desert",
  subtitle: "Moon Heist",
  // GOLDEN HOUR: a dusk-indigo zenith burning down into a low orange sun and a
  // gold horizon, the whole desert bathed warm
  sky: ["#1e2f60", "#d9743f", "#ffcf82"],
  fog: 0xdca066,
  fogNear: 62,
  fogFar: 270,
  // warm sky bounce over warm-dark ground
  hemi: [0xf2b078, 0x543022, 0.72],
  // the game's main sun is FIXED high overhead (can't sit low from a theme), so
  // it is turned OFF here and the theme adds its own LOW warm "setting sun"
  // directional light in buildScene - that gives the long dusk shadows.
  sun: 0xff8c3a,
  sunIntensity: 0,
  fill: 0xc86844,
  fillIntensity: 0.34,
  exposure: 1.08,
  // a touch of bloom so the low sun + warm rims glow
  bloom: { strength: 0.34, radius: 0.5, threshold: 0.72 },
  env: "./assets/hdri/qwantani_noon_2k.hdr",
  envIntensity: 0.3,
  envBackground: false,
  camera: { startDist: 38, maxDist: 38 },
  redName: "Actor-Critic",
  blueName: "PPO",

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
    let disposed = false;
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
    const texLoader = new THREE.TextureLoader();

    const hashFloat = (a, b, salt = 0) =>
      ((hash(a * 97 + salt * 37, b * 131 + salt * 53) >>> 0) % 10000) / 10000;

    // ---- the round's spec from the env ------------------------------------
    const A = world.arena || 20;
    const C = A / 2;
    // ---- shared texture helper --------------------------------------------
    function assetTexture(name, repeatX = 1, repeatY = 1, color = true) {
      const tex = trackTexture(texLoader.load(ASSETS + name));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = maxAniso;
      if (color) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    // ---- OBJ pipeline (same recipe as ruined.js) ---------------------------
    // MTL gives albedo only; rebuild each material as PBR, pull the pack's
    // sibling _nrm map, alpha-card the palm fronds, and swap the baked water
    // surfaces for real reflective water.
    const auxTex = new THREE.TextureLoader().setPath(ASSETS);
    const oasisWaterMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0x3fb0c8,
        roughness: 0.12,
        metalness: 0,
        envMapIntensity: 2.2,
        transparent: true,
        opacity: 0.95,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        // a faint teal glow so the pools read as WATER even over the red sand
        emissive: 0x0c4050,
        emissiveIntensity: 0.4,
        depthWrite: false,
      }),
    );
    function siblingTex(albMap, suffix) {
      const src = albMap.image?.src || albMap.source?.data?.src || "";
      const file = src.split("/").pop().split("?")[0];
      if (!file || !/_alb\.png$/i.test(file)) return null;
      const t = track(auxTex.load(file.replace(/_alb\.png$/i, suffix)));
      t.wrapS = albMap.wrapS;
      t.wrapT = albMap.wrapT;
      t.repeat.copy(albMap.repeat);
      t.anisotropy = maxAniso;
      return t;
    }
    function upgradeMat(m) {
      if (!m) return m;
      if (/wire|dummy/i.test(m.name || "")) {
        m.transparent = true;
        m.opacity = 0;
        m.depthWrite = false;
        return m;
      }
      // the packs bake water as a flat UV-distortion sheet that renders white -
      // swap any water surface for the reflective oasis material
      if (/water|uvdistortion|aura/i.test(m.name || "")) return oasisWaterMat;
      const map = m.map || null;
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = maxAniso;
      }
      const std = track(
        new THREE.MeshStandardMaterial({
          map,
          color: 0xffffff,
          roughness: 0.88,
          metalness: 0.0,
          emissive: new THREE.Color(0.02, 0.018, 0.012),
        }),
      );
      if (map) {
        const nrm = siblingTex(map, "_nrm.png");
        if (nrm) {
          std.normalMap = nrm;
          std.normalScale.set(1.1, 1.1);
        }
      }
      // palm fronds / grass tufts are alpha cards in this pack; their albedo
      // PNGs are RGBA, so the cutout comes from the map's OWN alpha channel
      // (the pack's separate _alpha masks put the shape where three.js does
      // not look for it and would discard every frond)
      if (/leaf|palm|grass|flower|frond/i.test(m.name || "")) {
        std.transparent = true;
        std.alphaTest = 0.3;
        std.side = THREE.DoubleSide;
      }
      std.name = m.name;
      return std;
    }
    const protos = new Map();
    function loadObj(name) {
      if (!protos.has(name)) {
        protos.set(
          name,
          new Promise((resolve) => {
            const finish_ = (obj) => {
              if (obj)
                obj.traverse((o) => {
                  if (!o.isMesh) return;
                  const ms = Array.isArray(o.material)
                    ? o.material
                    : [o.material];
                  // wire/helper meshes: hide OUTRIGHT (they'd still shadow and
                  // poison the bounds fit at opacity 0)
                  if (ms.every((m) => /wire|dummy/i.test(m?.name || ""))) {
                    o.visible = false;
                    o.castShadow = false;
                    return;
                  }
                  o.castShadow = true;
                  o.receiveShadow = true;
                  track(o.geometry);
                  o.material = Array.isArray(o.material)
                    ? o.material.map(upgradeMat)
                    : upgradeMat(o.material);
                });
              resolve(obj);
            };
            const objOnly = () =>
              new OBJLoader()
                .setPath(ASSETS)
                .load(name + ".obj", finish_, undefined, () => resolve(null));
            new MTLLoader()
              .setPath(ASSETS)
              .setResourcePath(ASSETS)
              .load(
                name + ".mtl",
                (mats) => {
                  mats.preload();
                  new OBJLoader()
                    .setMaterials(mats)
                    .setPath(ASSETS)
                    .load(name + ".obj", finish_, undefined, objOnly);
                },
                undefined,
                objOnly,
              );
          }),
        );
      }
      return protos.get(name);
    }

    // Clone a loaded model to (x,z) with its base at baseY; footprint fits the
    // larger XZ side (keeps proportions); height, when given, scales Y to size.
    // The Sand Kingdom pack is authored Z-up, but models are split between
    // extending along +Z and along -Z (the palm's fronds live at z<0!), so the
    // upright flip's SIGN is chosen per model - whichever way puts its bulk
    // feet-down. Bounds only count VISIBLE meshes (hidden wire helpers carry
    // stray vertices that poison the fit).
    function visibleBounds(root) {
      const box = new THREE.Box3();
      const mbox = new THREE.Box3();
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        mbox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        box.union(mbox);
      });
      return box;
    }
    function placeObj(name, x, z, opts = {}) {
      loadObj(name).then((proto) => {
        if (disposed || !proto) return;
        const inst = proto.clone();
        const raw = visibleBounds(inst);
        if (raw.isEmpty()) return;
        // model bulk on -Z: +90deg stands it up; bulk on +Z: -90deg
        inst.rotation.x =
          raw.max.z + raw.min.z < 0 ? Math.PI / 2 : -Math.PI / 2;
        const box = visibleBounds(inst);
        const size = box.getSize(new THREE.Vector3());
        const ctr = box.getCenter(new THREE.Vector3());
        inst.position.set(-ctr.x, -box.min.y, -ctr.z);
        let sx, sy, sz;
        if (opts.footprint != null) {
          sx = sz = opts.footprint / Math.max(size.x, size.z, 0.001);
          sy = opts.height != null ? opts.height / Math.max(size.y, 0.001) : sx;
        } else if (opts.height != null) {
          sx = sy = sz = opts.height / Math.max(size.y, 0.001);
        } else {
          sx = sy = sz = opts.scale ?? 1;
        }
        const wrap = new THREE.Group();
        wrap.add(inst);
        wrap.scale.set(sx, sy, sz);
        wrap.rotation.y = opts.ry ?? 0;
        wrap.position.set(x, opts.baseY ?? 0, z);
        group.add(wrap);
        // abut: slide the placed model so its facing edge lands EXACTLY on a
        // line (models' depths differ wildly; this is how the town blocks hug
        // the kerb without spilling onto the plaza). dir +1 = the model sits
        // on the positive side of the edge.
        for (const ab of opts.abut || []) {
          const b = visibleBounds(wrap);
          const cur =
            ab.dir > 0
              ? ab.axis === "x"
                ? b.min.x
                : b.min.z
              : ab.axis === "x"
                ? b.max.x
                : b.max.z;
          wrap.position[ab.axis] += ab.edge - cur;
        }
        opts.onPlaced?.(wrap);
      });
    }

    // ---- the desert floor: STREET LEVEL, like the city round ---------------
    // One big sand plane at y=0 running out to the fog - the arena is just the
    // kerbed plaza in the middle of town, not a floating island.
    {
      const GROUND = 260;
      const rep = GROUND / 10; // bigger sand tiles (~7 units) so the grain reads
      const groundMat = track(
        new THREE.MeshStandardMaterial({
          map: assetTexture("GroundSandRed00_rep_alb.png", rep, rep),
          normalMap: assetTexture(
            "GroundSandRed00_rep_nrm.png",
            rep,
            rep,
            false,
          ),
          normalScale: new THREE.Vector2(1.5, 1.5),
          color: 0xd8bfa0,
          roughness: 1,
          metalness: 0,
        }),
      );
      const g = new THREE.Mesh(
        track(new THREE.PlaneGeometry(GROUND, GROUND)),
        groundMat,
      );
      g.rotation.x = -Math.PI / 2;
      g.position.set(C, 0, C);
      g.receiveShadow = true;
      group.add(g);
    }

    // Keep the playable sand surface clear; scene landmarks stay outside it.

    // ---- LANDMARKS ---------------------------------------------------------
    // (The Inverted Pyramid backdrop was REMOVED - Bowser's Airship is the north
    // landmark now.) `pyramid` stays null so its guarded update is a no-op.
    let pyramid = null;

    // (oasis pools + palms and the ruin-gate pillars were on-board props -
    // removed to keep the board clean; the checkpoints are still marked by the
    // glowing rings.)

    // scattered desert stones on the apron ring around the play area
    for (let i = 0; i < 10; i++) {
      const side = hash(i, 91) % 4;
      const t = hashFloat(i, 5, 92);
      const along = -A / 2 - 0.6 + t * (A + 1.2);
      const out = A / 2 + 1.1 + hashFloat(i, 6, 93) * 0.9;
      const sx =
        C + (side === 0 || side === 3 ? along : side === 1 ? out : -out);
      const sz = C + (side === 0 ? -out : side === 3 ? out : along);
      // stones removed by request (deterministic placement, so matching by
      // position is stable). Add [x, z] pairs here to drop more.
      const REMOVED = [
        [21.8, 11.9],
        [3.5, -2.3],
        [6.1, 22.2],
      ];
      if (REMOVED.some(([rx, rz]) => Math.hypot(sx - rx, sz - rz) < 1.5))
        continue;
      // the Stone00x models are tall carved pillar chunks - cap their height
      // so they read as squat toppled rubble, not a colonnade
      placeObj(`Stone00${hash(i, 94) % 3}`, sx, sz, {
        footprint: 0.9 + hashFloat(i, 7, 95) * 0.7,
        height: 0.4 + hashFloat(i, 9, 97) * 0.4,
        ry: hashFloat(i, 8, 96) * Math.PI * 2,
      });
    }

    // ---- the TOWN: ONE BIG ring of buildings ALL the way around ------------
    // (the round-2 composition: the arena lives INSIDE the town.) Four big
    // Town000 blocks - one per side, each rotated to face the plaza so the
    // same model shows a different street front - close ranks with corner
    // pieces into a single unbroken town encircling the square. The blocks
    // are large enough that the buildings LOOM over the kerb rather than
    // reading as toys. The Jaxi statue watches the finish from inside the
    // ring; the tower rises from the north-west corner.
    // The block is SPLIT into left/right wings so each can be moved on its
    // own. The model's 32 meshes are PER-MATERIAL buckets that each span the
    // whole town (all clay walls in one mesh, etc.), so the cut happens at
    // TRIANGLE level: each wing keeps only the triangles whose centre lies on
    // its side of the model's midline (the baked ground plane gets sliced at
    // the seam too, so each wing stays self-grounded). Both wings share the
    // whole-model centring + scale, so identical coords reassemble the intact
    // block exactly. Move/turn each wing HERE:
    const TOWN = {
      size: 60, // footprint of the intact block
      y: -4.5, // default sink; a wing can carry its own y override
      left: { x: -28.5, z: -1.5, ry: -2.97, y: -6 }, // west-side backdrop
      right: { x: 9, z: 2.5, ry: 0 },
      // a DUPLICATE of the left wing filling the empty north end
      top: { x: 16.5, z: -27, ry: 0, y: -0.35, half: "left" },
    };
    // rebuild a geometry keeping only the triangles listed in `keep` (indices
    // into the triangle list). Returns geo unchanged if every tri is kept, null
    // if none are. Shared by the wing split and the stray-part carve below.
    function rebuildGeom(geo, keep, triCount) {
      if (keep.length === triCount) return geo;
      if (!keep.length) return null;
      const pos = geo.attributes.position;
      const idx = geo.index;
      if (idx) {
        const arr = new (pos.count > 65535 ? Uint32Array : Uint16Array)(
          keep.length * 3,
        );
        for (let j = 0; j < keep.length; j++)
          for (let k = 0; k < 3; k++)
            arr[j * 3 + k] = idx.getX(keep[j] * 3 + k);
        const g2 = geo.clone();
        g2.setIndex(new THREE.BufferAttribute(arr, 1));
        return g2;
      }
      const g2 = new THREE.BufferGeometry();
      for (const [name, src] of Object.entries(geo.attributes)) {
        const it = src.itemSize;
        const dst = new Float32Array(keep.length * 3 * it);
        for (let j = 0; j < keep.length; j++)
          for (let k = 0; k < 3; k++) {
            const si = (keep[j] * 3 + k) * it;
            const di = (j * 3 + k) * it;
            for (let c = 0; c < it; c++) dst[di + c] = src.array[si + c];
          }
        g2.setAttribute(name, new THREE.BufferAttribute(dst, it));
      }
      return g2;
    }
    // keep only this wing's triangles of one geometry; null = nothing left.
    // Tests geometry-space x directly: OBJ meshes sit at identity transforms,
    // and the upright flip spins about X so geometry x IS model x.
    function splitGeometryX(geo, midX, wantLeft) {
      const pos = geo.attributes.position;
      const idx = geo.index;
      const triCount = Math.floor((idx ? idx.count : pos.count) / 3);
      const keep = [];
      for (let t = 0; t < triCount; t++) {
        let cx = 0;
        for (let k = 0; k < 3; k++) {
          const i = idx ? idx.getX(t * 3 + k) : t * 3 + k;
          cx += pos.getX(i);
        }
        if (cx / 3 < midX === wantLeft) keep.push(t);
      }
      return rebuildGeom(geo, keep, triCount);
    }
    // DROP the triangles whose centroid falls inside a model-space AABB - used
    // to carve a stray sub-part out of a per-material bucket (same OBJ vertex
    // space as splitGeometryX, since the flip is on the parent, not baked in).
    function dropTrisInBox(geo, lo, hi) {
      const pos = geo.attributes.position;
      const idx = geo.index;
      const triCount = Math.floor((idx ? idx.count : pos.count) / 3);
      const keep = [];
      for (let t = 0; t < triCount; t++) {
        let cx = 0,
          cy = 0,
          cz = 0;
        for (let k = 0; k < 3; k++) {
          const i = idx ? idx.getX(t * 3 + k) : t * 3 + k;
          cx += pos.getX(i);
          cy += pos.getY(i);
          cz += pos.getZ(i);
        }
        cx /= 3;
        cy /= 3;
        cz /= 3;
        const inside =
          cx >= lo[0] &&
          cx <= hi[0] &&
          cy >= lo[1] &&
          cy <= hi[1] &&
          cz >= lo[2] &&
          cz <= hi[2];
        if (!inside) keep.push(t);
      }
      return rebuildGeom(geo, keep, triCount);
    }
    // stray sub-parts of a Town000 per-material bucket that land ON the plaza
    // and must be carved away (model-space AABBs, found by analysing
    // Town000.obj). WallClayColor01 carries a lone ~235-unit cylinder in the
    // model's south-west that the wing framing drops right into the middle of
    // the arena - remove just those 36 triangles; the wall in the same bucket
    // is 1000+ units away in model space, so it is untouched.
    const TOWN_CARVE = [
      {
        mesh: "WallClayColor01_rep",
        lo: [-530, -70, -610],
        hi: [-250, 210, -300],
      },
    ];
    // `which` names the placement in TOWN; `place.half` (or `which` itself)
    // picks which geometry HALF to keep, so several placements can reuse the
    // same wing geometry at different spots.
    function placeTownHalf(which) {
      const place = TOWN[which];
      const half = place.half || which;
      loadObj("Town000").then((proto) => {
        if (disposed || !proto) return;
        const inst = proto.clone();
        const raw = visibleBounds(inst);
        if (raw.isEmpty()) return;
        const midX = (raw.min.x + raw.max.x) / 2; // geometry-space midline
        inst.rotation.x =
          raw.max.z + raw.min.z < 0 ? Math.PI / 2 : -Math.PI / 2;
        // FULL-model framing first, so both wings scale + centre identically
        const box = visibleBounds(inst);
        const size = box.getSize(new THREE.Vector3());
        const ctr = box.getCenter(new THREE.Vector3());
        inst.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          // the block's own baked courtyard fountain sits ON the midline, so
          // the wing cut slices it in half - drop it outright instead (the
          // plaza already has its own fountain centrepiece)
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          if (
            /fountain/i.test(o.name || "") ||
            ms.some((m) => /fountain/i.test(m?.name || ""))
          ) {
            o.visible = false;
            return;
          }
          let geo = splitGeometryX(o.geometry, midX, half === "left");
          if (!geo) {
            o.visible = false;
            return;
          }
          // carve out any configured stray sub-parts (e.g. the arena cylinder
          // baked into the WallClayColor01 wall bucket)
          for (const c of TOWN_CARVE) {
            if ((o.name || "").includes(c.mesh)) {
              geo = dropTrisInBox(geo, c.lo, c.hi);
              if (!geo) break;
            }
          }
          if (!geo) {
            o.visible = false;
            return;
          }
          if (geo !== o.geometry) o.geometry = track(geo);
        });
        inst.position.set(-ctr.x, -box.min.y, -ctr.z);
        const s = TOWN.size / Math.max(size.x, size.z, 0.001);
        const wrap = new THREE.Group();
        wrap.add(inst);
        wrap.scale.setScalar(s);
        wrap.rotation.y = place.ry;
        wrap.position.set(place.x, place.y ?? TOWN.y, place.z);
        group.add(wrap);
      });
    }
    placeTownHalf("left");
    placeTownHalf("right");
    // the NORTH row of buildings is gone: Bowser's Airship (below) now owns the
    // north edge, cruising over the open desert where the town block used to be.
    // placeTownHalf("top");   // removed for the airship

    // streetlights at the plaza corners + benches along the edges, so the
    // kerb reads as a town square people actually use
    for (const [lx, lz, lr] of [
      [-0.9, -0.9, 0.8],
      [A + 0.9, -0.9, -0.8],
      [-0.9, A + 0.9, 2.4],
      [A + 0.9, A + 0.9, -2.4],
    ]) {
      placeObj("Streetlight000", lx, lz, { height: 1.9, ry: lr });
    }
    for (const [bx, bz, br] of [
      [-1.4, 6.5, Math.PI / 2],
      [-1.4, 14, Math.PI / 2],
      [A + 1.4, 6.5, -Math.PI / 2],
      [A + 1.4, 14, -Math.PI / 2],
      [6, A + 1.4, Math.PI],
      [14.5, A + 1.4, Math.PI],
    ]) {
      placeObj("Bench000", bx, bz, { footprint: 1.3, ry: br });
    }

    // (the centre fountain + its wading pool were on-board props - removed to
    // keep the board clean.)

    // ======================================================================
    // DUSK ATMOSPHERE: what keeps the emptied plaza feeling ALIVE - blowing
    // sand on the evening wind, birds wheeling over the town, and the low
    // setting sun glowing on the horizon.
    // ======================================================================

    // the LOW SETTING-SUN key light (the game's own sun is fixed overhead and
    // off for this round) - warm, from a low western angle, casting the long
    // dusk shadows across the plaza. Added to `group` so dispose() cleans it.
    {
      const duskLight = new THREE.DirectionalLight(0xff8f42, 3.5);
      duskLight.position.set(C - 44, 13, C - 6);
      duskLight.target.position.set(C, 0, C);
      duskLight.castShadow = true;
      duskLight.shadow.mapSize.set(2048, 2048);
      const SH = 42;
      duskLight.shadow.camera.left = -SH;
      duskLight.shadow.camera.right = SH;
      duskLight.shadow.camera.top = SH;
      duskLight.shadow.camera.bottom = -SH;
      duskLight.shadow.camera.near = 0.5;
      duskLight.shadow.camera.far = 170;
      duskLight.shadow.bias = -0.0006;
      group.add(duskLight);
      group.add(duskLight.target);
    }

    // blowing DUST drifting across the whole plaza on the wind
    const dust = (() => {
      const N = 200;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = C + (hashFloat(i, 1, 911) - 0.5) * 76;
        // most of the dust hugs the ground (desert haze), a little rides higher
        pos[i * 3 + 1] = 0.1 + Math.pow(hashFloat(i, 2, 912), 2) * 6;
        pos[i * 3 + 2] = C + (hashFloat(i, 3, 913) - 0.5) * 76;
      }
      const geo = track(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = track(
        new THREE.PointsMaterial({
          color: 0xffd9a0,
          size: 0.17,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          sizeAttenuation: true,
        }),
      );
      const pts = new THREE.Points(geo, mat);
      pts.traverse((o) => (o.userData.excludeBloom = true));
      group.add(pts);
      return { pts, pos, N, wind: 3.4 };
    })();

    // a TUMBLEWEED rolling across the desert now and then - a tangled ball of
    // dry twigs (crossed torus rings), blown on the wind, bouncing as it goes.
    // Hidden between passes; the update() loop drives one crossing per cycle.
    const TUMBLE_R = 0.9;
    const tumble = (() => {
      const g = new THREE.Group();
      const mat = track(
        new THREE.MeshStandardMaterial({
          color: 0xc2a066, // dry straw, pale enough to read on the red sand
          roughness: 1,
          metalness: 0,
          emissive: 0x3a2c14,
          emissiveIntensity: 0.4,
        }),
      );
      for (let i = 0; i < 13; i++) {
        const ring = new THREE.Mesh(
          track(
            new THREE.TorusGeometry(
              TUMBLE_R * (0.82 + hashFloat(i, 1, 941) * 0.3),
              0.05,
              5,
              14,
            ),
          ),
          mat,
        );
        ring.rotation.set(
          hashFloat(i, 2, 942) * Math.PI,
          hashFloat(i, 3, 943) * Math.PI,
          hashFloat(i, 4, 944) * Math.PI,
        );
        ring.scale.set(1, 0.75 + hashFloat(i, 5, 945) * 0.4, 1);
        g.add(ring);
      }
      g.traverse((o) => (o.userData.excludeBloom = true));
      g.visible = false;
      group.add(g);
      return g;
    })();

    // the low SETTING SUN glowing on the horizon behind the town
    {
      const S = 128;
      const cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const ctx = cv.getContext("2d");
      const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, "rgba(255,244,206,1)");
      g.addColorStop(0.3, "rgba(255,172,84,0.9)");
      g.addColorStop(1, "rgba(255,120,50,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      const tex = trackTexture(new THREE.CanvasTexture(cv));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = track(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const sp = new THREE.Sprite(mat);
      sp.scale.set(44, 44, 1);
      sp.position.set(C - 18, 8, -66); // low, off to one side behind the town
      group.add(sp);
    }

    // ======================================================================
    // CAPTURE THE FLAG game props (Round 5): the centre flag-pole, breakable
    // crates (the real FrailBox model) that BURST into shards when smashed, the
    // two corner bases with score pips, cartoon stun STARS, flying Mario-Kart
    // shells + laid banana/oil traps, and the Chain-Chomp reel-in (the chomp ball
    // flies out + drags the rival back), plus one-shot grab/steal/capture/crate
    // bursts. (The held weapon is shown in the top HUD, not in-world.) All driven
    // per-frame from the live snapshot in updateCTF(), the same way ruined.js
    // drives its Banzai Bills.
    // ======================================================================
    const ctf = world.ctf || {};
    const homeR = ctf.homeRadius || 1.5;
    const flagR = ctf.flagRadius || 0.75;
    const capturesToWin = ctf.capturesToWin || 3;
    const crateR = ctf.crateRadius || 0.55;
    const bases = {
      red: ctf.bases?.red || [A - 2.5, A - 2.5],
      blue: ctf.bases?.blue || [2.5, 2.5],
    };
    const RED = 0xff5a4d;
    const BLUE = 0x4da0ff;
    const CRATE_PATH = "./assets/objects/Crate/";

    // a soft additive radial-gradient glow sprite in any colour
    function makeGlowSprite(hex, scale = 3) {
      const S = 128;
      const cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const ctx = cv.getContext("2d");
      const c = new THREE.Color(hex);
      const r = Math.round(c.r * 255),
        g = Math.round(c.g * 255),
        b = Math.round(c.b * 255);
      const grd = ctx.createRadialGradient(
        S / 2,
        S / 2,
        0,
        S / 2,
        S / 2,
        S / 2,
      );
      grd.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
      grd.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, S, S);
      const tex = trackTexture(new THREE.CanvasTexture(cv));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = track(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        }),
      );
      const sp = new THREE.Sprite(mat);
      sp.scale.set(scale, scale, 1);
      return sp;
    }

    // ---- shared loader for the real object DAEs (deskin + hand-built PBR) ---
    // These Odyssey packs flag STATIC meshes as SkinnedMesh with a broken skeleton
    // whose samplers three cannot bind, so they must be deskinned to a plain Mesh
    // and re-textured by hand (same recipe as fossilfalls.js / peach.js).
    const OBJ = "./assets/objects/";
    const collada = new ColladaLoader();
    const objTex = (url, srgb = true) => {
      const tex = trackTexture(texLoader.load(encodeURI(url)));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = maxAniso;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
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
        if (sm.parent) {
          sm.parent.add(m);
          sm.parent.remove(sm);
        }
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

    // ---- the flag: the real Odyssey Checkpoint Flag (deskinned) ------------
    // The BodyMT pole is PLANTED at the centre and never moves. The FlagMT cloth is
    // split into its own group: it sits on the pole when free, and only IT flies to
    // ride above whoever is carrying it (the pole stays behind). The cloth ripples
    // in the wind (a vertex wave growing from the pole to the free edge).
    const FLAGDIR = OBJ + "Checkpoint Flag/";
    const flag = {
      poleWrap: new THREE.Group(), // the planted pole (never moves)
      clothWrap: null, // the movable cloth group
      cloth: null,
      clothBase: null,
      wave: null,
      clothHome: null,
    };
    flag.poleWrap.position.set(C, 0, C);
    group.add(flag.poleWrap);
    {
      const poleMat = track(
        new THREE.MeshStandardMaterial({
          map: objTex(FLAGDIR + "CheckpointFlagBody_alb.png", true),
          normalMap: objTex(FLAGDIR + "CheckpointFlagBody_nrm.png", false),
          roughnessMap: objTex(FLAGDIR + "CheckpointFlagBody_rgh.png", false),
          roughness: 0.75,
          metalness: 0.2,
        }),
      );
      const clothMat = track(
        new THREE.MeshStandardMaterial({
          map: objTex(FLAGDIR + "CheckpointFlagMark_alb.0.png", true),
          normalMap: objTex(FLAGDIR + "CheckpointFlagMark_nrm.0.png", false),
          roughnessMap: objTex(FLAGDIR + "CheckpointFlagMark_rgh.0.png", false),
          roughness: 0.7,
          metalness: 0.0,
          side: THREE.DoubleSide,
        }),
      );
      collada
        .loadAsync(encodeURI(FLAGDIR + "CheckpointFlag.dae"))
        .then((asset) => {
          if (disposed) return;
          const root = deskinObj(asset.scene);
          let clothMesh = null;
          root.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            track(o.geometry);
            // NB: the pole mesh is "CheckpointFlag__BodyMT" - it CONTAINS "Flag"
            // (from the model name), so key off "Body" for the pole and treat the
            // rest (the "__FlagMT" cloth) as the banner.
            if (/body/i.test(o.name || "")) o.material = poleMat;
            else {
              o.material = clothMat;
              clothMesh = o;
            }
          });
          const wrap = fitObj(root, 2.8, true); // ~2.8 units tall by height
          flag.poleWrap.add(wrap);
          // lift the CLOTH out of the pole model into its own world-space group, so
          // only the cloth travels while the pole stays planted. Bake its planted
          // world transform so it doesn't jump when we detach it.
          if (clothMesh) {
            flag.poleWrap.updateMatrixWorld(true);
            const wp = new THREE.Vector3(),
              wq = new THREE.Quaternion(),
              ws = new THREE.Vector3();
            clothMesh.matrixWorld.decompose(wp, wq, ws);
            clothMesh.parent.remove(clothMesh);
            clothMesh.position.set(0, 0, 0);
            clothMesh.quaternion.copy(wq);
            clothMesh.scale.copy(ws);
            const cw = new THREE.Group();
            cw.position.copy(wp);
            cw.add(clothMesh);
            group.add(cw);
            flag.clothWrap = cw;
            flag.cloth = clothMesh;
            flag.clothHome = wp.clone(); // where it rests on the pole
            // prime the wind wave: flattest axis = the sheet normal to displace, the
            // wider horizontal axis = the length (the free edge waves most).
            const g = clothMesh.geometry;
            g.computeBoundingBox();
            const bb = g.boundingBox;
            const ext = [
              bb.max.x - bb.min.x,
              bb.max.y - bb.min.y,
              bb.max.z - bb.min.z,
            ];
            const normalAxis = ext.indexOf(Math.min(...ext));
            const lenAxis =
              normalAxis === 0
                ? 2
                : normalAxis === 2
                  ? 0
                  : ext[0] >= ext[2]
                    ? 0
                    : 2;
            flag.clothBase = Float32Array.from(g.attributes.position.array);
            flag.wave = {
              normalAxis,
              lenAxis,
              lo: bb.min.getComponent(lenAxis),
              range: ext[lenAxis] || 1,
            };
            // centre the POLE dead-centre: the cloth was offset to one side and skewed
            // the model bbox, so fitObj left the pole off-centre. Shift the (now pole-
            // only) model AND the cloth's home by the same offset so the cloth stays put.
            wrap.updateMatrixWorld(true);
            const pc = new THREE.Box3()
              .setFromObject(wrap)
              .getCenter(new THREE.Vector3());
            const ox = pc.x - C,
              oz = pc.z - C;
            wrap.position.x -= ox;
            wrap.position.z -= oz;
            cw.position.x -= ox;
            cw.position.z -= oz;
            flag.clothHome.x -= ox;
            flag.clothHome.z -= oz;
          }
        })
        .catch(() => {});
    }

    // ---- the two corner HOME bases: the Shiverian Rug, tinted per team ------
    // A real flat rug laid on the sand at each corner, its albedo MULTIPLIED by the
    // owning model's colour (red base = red rug, blue base = blue rug). Sized to the
    // actual capture zone (radius homeR), so the rug edge IS the scoring line. The
    // capture COUNT is shown in the HUD (flag icons), not on the board.
    const rugModels = []; // for disposal
    function makeBase(pos, color) {
      const bg = new THREE.Group();
      bg.position.set(pos[0], 0, pos[1]);
      const inx = C - pos[0],
        inz = C - pos[1];
      const il = Math.hypot(inx, inz) || 1;
      const ux = inx / il,
        uz = inz / il; // toward the plaza centre
      const rugMat = track(
        new THREE.MeshStandardMaterial({
          map: objTex(OBJ + "Shiverian Rug/SouvenirSnow1Body_alb.png", true),
          normalMap: objTex(
            OBJ + "Shiverian Rug/SouvenirSnow1Body_nrm.png",
            false,
          ),
          roughnessMap: objTex(
            OBJ + "Shiverian Rug/SouvenirSnow1Body_rgh.png",
            false,
          ),
          color, // team tint (multiplies the albedo)
          roughness: 0.92,
          metalness: 0.0,
        }),
      );
      collada
        .loadAsync(encodeURI(OBJ + "Shiverian Rug/SouvenirSnow1.dae"))
        .then((asset) => {
          if (disposed) return;
          const root = deskinObj(asset.scene);
          root.traverse((o) => {
            if (!o.isMesh) return;
            o.material = rugMat;
            o.receiveShadow = true;
            track(o.geometry);
          });
          // footprint = the capture DIAMETER (2 * homeR), so the rug marks the zone
          const wrap = fitObj(root, homeR * 2, false);
          // if the export came in standing up, lay it flat on the sand
          wrap.updateMatrixWorld(true);
          const b = new THREE.Box3().setFromObject(wrap);
          const s = b.getSize(new THREE.Vector3());
          if (s.y > Math.max(s.x, s.z) * 0.6) wrap.rotation.x = -Math.PI / 2;
          wrap.rotation.y = Math.atan2(ux, uz); // point length at centre
          wrap.position.y = 0.02;
          bg.add(wrap);
          rugModels.push(wrap);
        })
        .catch(() => {});
      const glow = new THREE.PointLight(color, 0.7, 6, 2);
      glow.position.set(0, 0.7, 0);
      bg.add(glow);
      group.add(bg);
      return { glow };
    }
    const baseVis = {
      red: makeBase(bases.red, RED),
      blue: makeBase(bases.blue, BLUE),
    };

    // ---- one-shot event de-dup (so a transient effect fires once per event) --
    const seenEvents = new Set();
    const seenOrder = [];
    function rememberEvent(id) {
      if (seenEvents.has(id)) return false;
      seenEvents.add(id);
      seenOrder.push(id);
      if (seenOrder.length > 256) seenEvents.delete(seenOrder.shift());
      return true;
    }

    // ---- breakable crates: the real FrailBox (deskinned), pooled by id ------
    const crateMeshes = new Map(); // crate id -> Object3D
    let crateProtoObj = null;
    {
      const crateMat = track(
        new THREE.MeshStandardMaterial({
          map: objTex(CRATE_PATH + "FrailBoxBody00_alb.png", true),
          normalMap: objTex(CRATE_PATH + "FrailBoxBody00_nrm.png", false),
          roughnessMap: objTex(CRATE_PATH + "FrailBoxBody00_rgh.png", false),
          roughness: 0.85,
          metalness: 0.0,
        }),
      );
      collada
        .loadAsync(encodeURI(CRATE_PATH + "FrailBox.dae"))
        .then((asset) => {
          if (disposed) return;
          const root = deskinObj(asset.scene);
          root.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            o.material = crateMat;
            track(o.geometry);
          });
          crateProtoObj = fitObj(root, 1.15, false);
        })
        .catch(() => {
          crateProtoObj = null;
        }); // missing model -> crates don't draw
    }
    // a crate DROPS in from high out of frame, bounces once, then rests dead still
    // (fixed yaw, no spin, no bob) at its sim spot.
    const CRATE_REST_Y = 0.05,
      CRATE_DROP_Y = 16;
    function syncCrates(frame, t, dt) {
      const active = new Set();
      for (const cr of frame?.crates || []) {
        active.add(cr.id);
        let m = crateMeshes.get(cr.id);
        if (!m && crateProtoObj) {
          m = crateProtoObj.clone();
          m.rotation.y = (cr.id * 1.37) % (Math.PI * 2); // one fixed yaw; never spins
          m.position.set(cr.pos[0], CRATE_DROP_Y, cr.pos[1]); // start above the screen
          m.userData.vy = 0;
          m.userData.landed = false;
          group.add(m);
          crateMeshes.set(cr.id, m);
        }
        if (m) {
          m.position.x = cr.pos[0];
          m.position.z = cr.pos[1];
          if (!m.userData.landed) {
            m.userData.vy -= 34 * dt; // gravity fall
            m.position.y += m.userData.vy * dt;
            if (m.position.y <= CRATE_REST_Y) {
              m.position.y = CRATE_REST_Y;
              if (m.userData.vy < -6) {
                // one small bounce
                m.userData.vy = -m.userData.vy * 0.26;
              } else {
                m.userData.vy = 0;
                m.userData.landed = true;
              }
            }
          } else {
            m.position.y = CRATE_REST_Y; // sits perfectly still
          }
        }
      }
      for (const [id, m] of crateMeshes) {
        if (active.has(id)) continue;
        group.remove(m); // smashed -> the crate burst covers the FX
        crateMeshes.delete(id);
      }
    }

    // ---- per-side cartoon STUN STARS: classic yellow 5-point "dizzy" stars that
    // circle over a stunned agent's head (a hand-drawn star sprite, not a blob) ---
    function makeStarTexture() {
      const S = 96,
        cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const ctx = cv.getContext("2d");
      const cx = S / 2,
        cy = S / 2,
        R = S * 0.4,
        r = R * 0.46;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? R : r;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = cx + Math.cos(a) * rad,
          y = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const grd = ctx.createLinearGradient(0, cy - R, 0, cy + R);
      grd.addColorStop(0, "#fff29a");
      grd.addColorStop(1, "#ffb61e");
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.lineWidth = S * 0.085;
      ctx.strokeStyle = "#5a3a00";
      ctx.stroke(); // bold cartoon outline
      const tex = trackTexture(new THREE.CanvasTexture(cv));
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    const starMat = track(
      new THREE.SpriteMaterial({
        map: makeStarTexture(),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    const aura = {};
    for (const side of ["red", "blue"]) {
      const stars = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Sprite(starMat); // sprites share one material
        s.scale.set(0.6, 0.6, 1);
        s.renderOrder = 11;
        s.position.set(
          Math.cos((i / 3) * Math.PI * 2) * 0.55,
          0,
          Math.sin((i / 3) * Math.PI * 2) * 0.55,
        );
        stars.add(s);
      }
      stars.visible = false;
      group.add(stars);
      aura[side] = { stars };
    }

    // ---- flying shells (red = homing, green = straight/bouncing) ------------
    // two shared prototypes cloned per live shell id (geometry/material tracked
    // once), pooled by id and removed when the shell expires or lands a hit.
    function makeShell(kind) {
      const color = kind === "red" ? 0xe5342a : 0x2eb24a;
      const cream = 0xfbe9c2;
      const g = new THREE.Group();
      // top carapace: a glossy coloured dome (upper hemisphere)
      const dome = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.36, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56)),
        track(new THREE.MeshStandardMaterial({
          color, roughness: 0.28, metalness: 0.05,
          emissive: color, emissiveIntensity: 0.12,
        })),
      );
      dome.scale.y = 0.9;
      dome.position.y = 0.05;
      dome.castShadow = true;
      g.add(dome);
      // the cream belly (lower hemisphere, flattened)
      const belly = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.34, 22, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5)),
        track(new THREE.MeshStandardMaterial({ color: cream, roughness: 0.6 })),
      );
      belly.scale.y = 0.55;
      belly.position.y = 0.05;
      g.add(belly);
      // the thick cream rim around the middle (the shell's lip)
      const rim = new THREE.Mesh(
        track(new THREE.TorusGeometry(0.345, 0.075, 10, 26)),
        track(new THREE.MeshStandardMaterial({ color: cream, roughness: 0.5 })),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.05;
      g.add(rim);
      // the red shell wears cream Koopa-spots on its dome
      if (kind === "red") {
        const spotMat = track(new THREE.MeshStandardMaterial({ color: cream, roughness: 0.5 }));
        const spotGeo = track(new THREE.SphereGeometry(0.085, 10, 8));
        for (const [ax, az] of [[0, 0], [0.2, 0.13], [-0.19, 0.14], [0.11, -0.22], [-0.13, -0.2]]) {
          const r = Math.hypot(ax, az);
          const s = new THREE.Mesh(spotGeo, spotMat);
          const yy = 0.05 + Math.sqrt(Math.max(0, 0.32 * 0.32 - r * r)) * 0.9;
          s.position.set(ax, yy, az);
          s.scale.set(1, 0.4, 1);
          g.add(s);
        }
      }
      return g;
    }
    const shellProto = { red: makeShell("red"), green: makeShell("green") };
    const shellMeshes = new Map();
    function syncShells(frame, t, dt) {
      const active = new Set();
      for (const s of frame?.shells || []) {
        active.add(s.id);
        let m = shellMeshes.get(s.id);
        if (!m) {
          m = (shellProto[s.kind] || shellProto.red).clone();
          group.add(m);
          shellMeshes.set(s.id, m);
        }
        m.position.set(s.pos[0], 0.38, s.pos[1]);
        m.rotation.y += dt * 15; // spin like a rolling shell
      }
      for (const [id, m] of shellMeshes) {
        if (active.has(id)) continue;
        group.remove(m);
        shellMeshes.delete(id);
      }
    }

    // ---- laid traps: a banana peel or an oil slick lying on the sand --------
    // a dropped banana PEEL splayed OPEN on the ground: a small centre lump with
    // four tapered peel strips fanning outward, their tips curling up (Mario-Kart
    // style), not a closed crescent banana.
    const peelMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xf5c518,
        roughness: 0.5,
        emissive: 0x3a2c00,
        emissiveIntensity: 0.16,
      }),
    );
    const peelInnerMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xfff0b0,
        roughness: 0.6,
      }),
    );
    function makeBanana() {
      const g = new THREE.Group();
      const base = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.12, 12, 10)),
        peelMat,
      );
      base.scale.set(1, 0.5, 1); // a small squashed lump only
      base.position.y = 0.06;
      base.castShadow = true;
      g.add(base);
      // the peel's centre rises to a POINT (the stem where the strips join), pointing up
      const nub = new THREE.Mesh(
        track(new THREE.ConeGeometry(0.1, 0.42, 12)),
        peelMat,
      );
      nub.position.y = 0.27;
      nub.castShadow = true;
      g.add(nub);
      const N = 4;
      for (let i = 0; i < N; i++) {
        const pivot = new THREE.Group();
        pivot.position.y = 0.06;
        pivot.rotation.y = (i / N) * Math.PI * 2 + 0.4; // fan the strips around
        const strip = new THREE.Mesh(
          track(new THREE.CylinderGeometry(0.035, 0.11, 0.5, 8)),
          i % 2 ? peelInnerMat : peelMat,
        ); // alternate skin / pale inside
        strip.position.set(0, 0, 0.24); // reach outward from the lump
        strip.rotation.x = Math.PI / 2 - 0.32; // lie flat, outer tip curling up
        strip.castShadow = true;
        pivot.add(strip);
        g.add(pivot);
      }
      return g;
    }
    // oil slick = the SAME wobbly extruded PUDDLE blob the slippery cells use
    // (city.js / fossilfalls.js), just skinned BLACK: a near-black pool with a
    // faint iridescent oily sheen instead of cartoon-turquoise water.
    function _oilCanvas() {
      const S = 256,
        cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const ctx = cv.getContext("2d"),
        img = ctx.createImageData(S, S),
        d = img.data;
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const u = x / S,
            v = y / S;
          let n =
            0.5 +
            0.3 * Math.sin(2 * Math.PI * (u + v)) +
            0.2 * Math.sin(2 * Math.PI * (2 * u - v) + 1.3);
          n = Math.max(0, Math.min(1, 0.5 + (n - 0.5) * 0.7));
          // a slow rainbow sheen riding on the near-black base (oil-slick shimmer)
          const sheen =
            0.5 + 0.5 * Math.sin(2 * Math.PI * (u * 3 + v * 2) + n * 3.0);
          const i = (y * S + x) * 4;
          d[i] = 6 + 20 * n + 16 * sheen; // purple glints
          d[i + 1] = 6 + 14 * n + 20 * (1 - sheen) * n; // teal glints
          d[i + 2] = 10 + 26 * n + 22 * sheen;
          d[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
      return cv;
    }
    function oilShape() {
      const s = new THREE.Shape();
      const ph1 = Math.random() * 6.283,
        ph2 = Math.random() * 6.283;
      const rr = 0.6; // ~TRAP_R across
      for (let i = 0, n = 72; i <= n; i++) {
        const th = (i / n) * Math.PI * 2;
        const w =
          1 + 0.08 * Math.sin(th * 3 + ph1) + 0.045 * Math.sin(th * 5 + ph2);
        const x = Math.cos(th) * rr * w,
          y = Math.sin(th) * rr * w;
        if (i === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
      }
      return s;
    }
    const oilTex = trackTexture(new THREE.CanvasTexture(_oilCanvas()));
    oilTex.colorSpace = THREE.SRGBColorSpace;
    oilTex.wrapS = oilTex.wrapT = THREE.RepeatWrapping;
    oilTex.repeat.set(1.4, 1.4);
    oilTex.anisotropy = maxAniso;
    const oilMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: oilTex,
        transparent: true,
        opacity: 0.95,
        roughness: 0.12,
        metalness: 0.55,
        emissive: 0x0a0a12,
        emissiveIntensity: 0.15,
        depthWrite: false,
      }),
    );
    function makeOil() {
      const g = new THREE.Group();
      const slick = new THREE.Mesh(
        track(
          new THREE.ExtrudeGeometry(oilShape(), {
            depth: 0.05,
            bevelEnabled: true,
            bevelThickness: 0.03,
            bevelSize: 0.04,
            bevelSegments: 2,
          }),
        ),
        oilMat,
      );
      slick.rotation.x = -Math.PI / 2; // lay the blob flat on the sand
      slick.position.y = 0.03;
      slick.renderOrder = 3;
      slick.receiveShadow = true;
      g.add(slick);
      return g;
    }
    const trapProto = { banana: makeBanana(), oil: makeOil() };
    const trapMeshes = new Map();
    function syncTraps(frame, t) {
      oilTex.offset.x = t * 0.008; // slow living oily shimmer
      oilTex.offset.y = Math.sin(t * 0.2) * 0.03;
      const active = new Set();
      for (const tr of frame?.traps || []) {
        active.add(tr.id);
        let m = trapMeshes.get(tr.id);
        if (!m) {
          m = (trapProto[tr.kind] || trapProto.banana).clone();
          m.position.set(tr.pos[0], 0, tr.pos[1]);
          m.rotation.y = (tr.id * 1.7) % (Math.PI * 2); // vary each peel / slick
          group.add(m);
          trapMeshes.set(tr.id, m);
        }
      }
      for (const [id, m] of trapMeshes) {
        if (active.has(id)) continue;
        group.remove(m);
        trapMeshes.delete(id);
      }
    }

    // ---- Bowser's Airship + the objects he HURLS at the board ----------------
    // The ship hangs over the north edge (where the town's top row used to be).
    // Bowser stands at its prow and slides side to side (driven by frame.ship.x),
    // pausing to lob objects at random board spots (a "throw" event -> a lunge).
    // ONE place to tune the ship + Bowser. Broadside (ry 90deg), low over the north
    // edge; it FLOATS (bob + roll) and drifts a little to frame.ship.x, Bowser riding
    // along on the deck. Positioned per the user's dev-tool placement.
    const SHIP = { x: C, y: 2.5, z: -1.5, size: 12, ry: Math.PI / 2 };
    const SHIP_DECK_Y = SHIP.y + 2.55; // Bowser's feet on the deck
    const SHIP_DECK_Z = SHIP.z; // centred on the deck
    // fine offsets for Bowser on the deck (flip a sign if a direction is backwards):
    const BOWSER_OFFSET_X = -0.35; // - = viewer's LEFT
    const BOWSER_OFFSET_Z = 1.0; // + = toward the camera (deck edge)
    const CARPET_LIFT = 0.01; // raise the deck carpet a hair
    const shipState = { obj: null, curX: C }; // the ship group + smoothed x
    const bowser = { obj: null, throwT: 99 }; // the Bowser model + lunge timer
    // the airship, skinned with its OWN textures. Each DAE material name (…MT) maps to
    // its real Ship<X>_alb.png, so hull/sails/cloth/gold all show their true colours.
    {
      const AIRSHIP_DIR = OBJ + "Bowser's Airship/";
      // material-name (lower-case) -> albedo texture base + whether it's metallic
      const SHIP_TEX = {
        metalmt: ["ShipMetal", 0.4],
        woodmt00: ["ShipWood00", 0],
        woodmt01: ["ShipWood01", 0],
        goldmt00: ["ShipGold00", 0.85],
        goldmt01: ["ShipGold01", 0.85],
        koopamt: ["ShipKoopaMetal", 0.6],
        framemt: ["ShipFrame", 0.4],
        decoclothmt: ["ShipDecoCloth", 0],
        flagmt: ["ShipFlag", 0],
        sailmt: ["ShipSail", 0],
        carpetmt00: ["ShipCarpet00", 0],
        carpetmt01: ["ShipCarpet01", 0],
        ropemt: ["ShipRope", 0],
        moontankglass00mt: ["MoonTankGlass", 0.3],
        packunmt: ["PeachBouquetPackun", 0],
        tankmt: ["Tank", 0.3],
      };
      const KEYS = Object.keys(SHIP_TEX).sort((a, b) => b.length - a.length); // longest first
      const shipTexCache = {},
        shipMatCache = {};
      const shipTex = (base) => {
        if (!shipTexCache[base]) {
          const tex = trackTexture(
            texLoader.load(
              encodeURI(AIRSHIP_DIR + base + "_alb.png"),
              undefined,
              undefined,
              () => {},
            ),
          );
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = maxAniso;
          shipTexCache[base] = tex;
        }
        return shipTexCache[base];
      };
      const shipMaterialFor = (name) => {
        const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const key = KEYS.find((k) => n.includes(k)) || "metalmt";
        if (!shipMatCache[key]) {
          const [base, metal] = SHIP_TEX[key];
          shipMatCache[key] = track(
            new THREE.MeshStandardMaterial({
              map: shipTex(base),
              roughness: metal > 0.3 ? 0.4 : 0.8,
              metalness: metal,
              side: THREE.DoubleSide,
            }),
          );
        }
        return shipMatCache[key];
      };
      collada
        .loadAsync(encodeURI(AIRSHIP_DIR + "KoopaShip.dae"))
        .then((asset) => {
          if (disposed) return;
          const root = deskinObj(asset.scene);
          const carpets = [];
          root.traverse((o) => {
            if (!o.isMesh) return;
            track(o.geometry);
            const mn =
              (Array.isArray(o.material) ? o.material[0] : o.material)?.name ||
              "";
            const combined = (mn + " " + (o.name || "")).toLowerCase();
            o.material = shipMaterialFor(combined);
            if (combined.includes("carpet")) carpets.push(o); // lift these off the deck
            o.castShadow = false;
            o.receiveShadow = false;
          });
          const wrap = fitObj(root, SHIP.size, false); // small
          wrap.rotation.y = SHIP.ry; // 90deg: broadside to the board
          wrap.position.set(SHIP.x, SHIP.y, SHIP.z);
          // nudge the deck carpet up a hair (world units -> model units via the scale)
          // so it sits ABOVE the planks instead of z-fighting into them
          const s = wrap.scale.x || 1;
          for (const cp of carpets) cp.position.y += CARPET_LIFT / s;
          shipState.obj = wrap;
          group.add(wrap);
        })
        .catch(() => {}); // missing/huge model -> no ship
    }
    // Bowser himself (the real board character, idx 6), standing on the deck
    loadBoardWalker(6)
      .then((bw) => {
        if (disposed || !bw?.group) return;
        bw.group.scale.setScalar(1.5);
        bw.group.position.set(SHIP.x, SHIP_DECK_Y, SHIP_DECK_Z);
        bowser.obj = bw.group;
        group.add(bw.group);
      })
      .catch(() => {});

    // ---- the thrown objects (Bob-omb-like), pooled by id ---------------------
    function makeHazard(kind) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.42, 16, 12)),
        track(
          new THREE.MeshStandardMaterial({
            color: kind === 1 ? 0x39414d : 0x161619,
            roughness: 0.5,
            metalness: 0.5,
          }),
        ),
      );
      body.castShadow = true;
      g.add(body);
      const fuse = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6)),
        track(
          new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7 }),
        ),
      );
      fuse.position.y = 0.5;
      g.add(fuse);
      const spark = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.08, 8, 6)),
        track(
          new THREE.MeshStandardMaterial({
            color: 0xffd873,
            emissive: 0xffa020,
            emissiveIntensity: 1.3,
          }),
        ),
      );
      spark.position.y = 0.66;
      g.add(spark);
      return g;
    }
    const hazardProto = [makeHazard(0), makeHazard(1), makeHazard(2)];
    const hazardMeshes = new Map();
    function syncHazards(frame, dt) {
      const active = new Set();
      for (const h of frame?.hazards || []) {
        active.add(h.id);
        let m = hazardMeshes.get(h.id);
        if (!m) {
          m = hazardProto[(h.kind || 0) % 3].clone();
          m.userData.rx = h.pos[0];      // rendered position, smoothed toward the sim
          m.userData.rz = h.pos[1];
          group.add(m);
          hazardMeshes.set(h.id, m);
        }
        // the sim advances the bomb in coarse snapshot jumps; DEAD-RECKON toward the
        // next sim spot using its velocity, then ease onto the exact position, so the
        // flight reads smooth (not jumpy) at the same average speed.
        m.userData.rx += h.vel[0] * dt;
        m.userData.rz += h.vel[1] * dt;
        const k = 1 - Math.exp(-dt * 10);
        m.userData.rx += (h.pos[0] - m.userData.rx) * k;
        m.userData.rz += (h.pos[1] - m.userData.rz) * k;
        // arc: launched at cannon height near the ship, arcing down onto the board
        const zFromShip = m.userData.rz - (SHIP.z + 1.9);
        const y = Math.max(1.0, CANNON_Y - Math.max(0, zFromShip) * 0.45);
        m.position.set(m.userData.rx, y, m.userData.rz);
        m.rotation.y += dt * 5;
        m.rotation.x += dt * 3;
      }
      for (const [id, m] of hazardMeshes) {
        if (active.has(id)) continue;
        group.remove(m);
        hazardMeshes.delete(id);
      }
    }
    // ---- cannon fire: a muzzle flash + smoke puff when the ship lobs a bomb --
    const CANNON_Y = SHIP.y + 1.05; // cannon height on the board-facing hull
    const CANNON_Z = SHIP.z + 1.9; //  board-facing side (toward the camera)
    const cannonFx = [];
    const flashGeo = track(new THREE.SphereGeometry(0.45, 10, 8));
    const smokeGeo = track(new THREE.SphereGeometry(0.34, 8, 6));
    function spawnCannonFire() {
      const cx = shipState.curX + [-1.1, 0, 1.1][Math.floor(Math.random() * 3)]; // a cannon
      const flash = new THREE.Mesh(
        flashGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffcf5a, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      flash.position.set(cx, CANNON_Y, CANNON_Z);
      group.add(flash);
      cannonFx.push({ m: flash, life: 0, dur: 0.16, kind: "flash" });
      for (let i = 0; i < 3; i++) {
        const sm = new THREE.Mesh(
          smokeGeo,
          new THREE.MeshStandardMaterial({
            color: 0x6a6a6a, transparent: true, opacity: 0.55, depthWrite: false,
          }),
        );
        sm.position.set(cx, CANNON_Y, CANNON_Z);
        sm.userData.v = [
          (Math.random() - 0.5) * 1.2, 0.7 + Math.random() * 0.7,
          1.4 + Math.random() * 1.2, // drift toward the board + up
        ];
        group.add(sm);
        cannonFx.push({ m: sm, life: 0, dur: 0.85, kind: "smoke" });
      }
    }
    function updateCannonFx(dt) {
      for (let i = cannonFx.length - 1; i >= 0; i--) {
        const f = cannonFx[i];
        f.life += dt;
        const u = f.life / f.dur;
        if (f.kind === "flash") {
          f.m.scale.setScalar(1 + u * 2.2);
          f.m.material.opacity = Math.max(0, 1 - u);
        } else {
          const v = f.m.userData.v;
          f.m.position.x += v[0] * dt;
          f.m.position.y += v[1] * dt;
          f.m.position.z += v[2] * dt;
          f.m.scale.setScalar(1 + u * 1.6);
          f.m.material.opacity = 0.55 * Math.max(0, 1 - u);
        }
        if (u >= 1) {
          group.remove(f.m);
          f.m.material.dispose();
          cannonFx.splice(i, 1);
        }
      }
    }
    // ---- bomb-impact EXPLOSION: the EXACT toon-fire blast ported from R4
    // (ruined.js): a blob cluster + burst star + additive core sprite + pale dust
    // puffs + a brief point light. Geometry/textures are shared; each blast owns
    // only its animated materials.
    const MAX_EXPLOSION_FX = 8, MAX_EXPLOSION_LIGHTS = 4;
    const explosionFx = [];
    const toonGradient = (() => {
      const cv = document.createElement("canvas");
      cv.width = 4; cv.height = 1;
      const g = cv.getContext("2d");
      ["#3a3a3a", "#797979", "#b9b9b9", "#ffffff"].forEach((color, i) => {
        g.fillStyle = color; g.fillRect(i, 0, 1, 1);
      });
      const tx = trackTexture(new THREE.CanvasTexture(cv));
      tx.minFilter = THREE.NearestFilter; tx.magFilter = THREE.NearestFilter;
      tx.generateMipmaps = false;
      return tx;
    })();
    const explosionBlobGeometry = (() => {
      const geometry = track(new THREE.IcosahedronGeometry(0.5, 4));
      const position = geometry.attributes.position, normal = geometry.attributes.normal;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        const length = Math.max(0.0001, Math.hypot(x, y, z));
        const nx = x / length, ny = y / length, nz = z / length;
        const wobble = 1 + Math.sin(nx * 8.7 + ny * 4.1 - nz * 2.3) * 0.06
          + Math.sin(nz * 10.3 - nx * 3.7 + ny * 2.9) * 0.035;
        position.setXYZ(i, x * wobble, y * wobble, z * wobble);
        normal.setXYZ(i, nx, ny, nz);
      }
      position.needsUpdate = true; normal.needsUpdate = true;
      return geometry;
    })();
    const explosionBurstGeometry = (() => {
      const positions = [], colors = [];
      const innerColor = new THREE.Color(0xda9e51), tipColor = new THREE.Color(0xf6de4a);
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const inner = 0.28 + (i % 3) * 0.025, outer = i % 2 ? 1.08 : 1.42;
        const halfWidth = i % 2 ? 0.046 : 0.062;
        positions.push(
          Math.cos(angle - halfWidth) * inner, 0, Math.sin(angle - halfWidth) * inner,
          Math.cos(angle) * outer, 0, Math.sin(angle) * outer,
          Math.cos(angle + halfWidth) * inner, 0, Math.sin(angle + halfWidth) * inner);
        colors.push(innerColor.r, innerColor.g, innerColor.b,
          tipColor.r, tipColor.g, tipColor.b, innerColor.r, innerColor.g, innerColor.b);
      }
      const geometry = track(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      return geometry;
    })();
    const explosionCoreTexture = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 128;
      const g = cv.getContext("2d");
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.18, "rgba(255,251,208,1)");
      grad.addColorStop(0.46, "rgba(245,235,85,.86)");
      grad.addColorStop(0.7, "rgba(221,130,101,.34)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      const tx = trackTexture(new THREE.CanvasTexture(cv));
      tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = maxAniso;
      return tx;
    })();
    const FIRE_CORE = new THREE.Color(0xfffbd0), FIRE_HOT = new THREE.Color(0xf5eb55);
    const FIRE_GOLD = new THREE.Color(0xda9e51), FIRE_CORAL = new THREE.Color(0xdd8265);
    const FIRE_BURNT = new THREE.Color(0xac4b40);
    function disposeExplosion(fx) {
      group.remove(fx.group);
      fx.coreMat.dispose(); fx.burstMat.dispose();
      for (const layer of fx.fireLayers) layer.material.dispose();
      for (const layer of fx.dustLayers) layer.material.dispose();
    }
    function spawnExplosion(x, z) {
      while (explosionFx.length >= MAX_EXPLOSION_FX) disposeExplosion(explosionFx.shift());
      const p = { x, z };
      const blast = new THREE.Group();
      blast.position.set(p.x, 0.88, p.z);
      const isHit = false;                                 // a bomb hits the sand -> dust
      const coreMat = new THREE.SpriteMaterial({
        map: explosionCoreTexture, color: 0xffffff, transparent: true, opacity: 1,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const core = new THREE.Sprite(coreMat);
      core.scale.setScalar(0.32); core.renderOrder = 34;
      blast.add(core);
      const burstMat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 1, depthWrite: false,
        depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const burst = new THREE.Mesh(explosionBurstGeometry, burstMat);
      burst.position.y = 0.035; burst.rotation.y = Math.random() * Math.PI * 2;
      burst.scale.setScalar(0.42); burst.renderOrder = 33;
      blast.add(burst);
      const fireLayers = [];
      const fireCount = isHit ? 8 : 7, blastScale = isHit ? 1.13 : 1.09;
      for (let i = 0; i < fireCount; i++) {
        const emissivePeak = i === 0 ? 1.02 : i === 1 ? 0.7 : 0.48 + Math.random() * 0.13;
        const material = new THREE.MeshToonMaterial({
          color: FIRE_CORE, gradientMap: toonGradient, emissive: FIRE_HOT,
          emissiveIntensity: emissivePeak, transparent: true, opacity: 0,
          depthWrite: false, depthTest: true, toneMapped: false,
        });
        const mesh = new THREE.Mesh(explosionBlobGeometry, material);
        const angle = i === 0 ? 0 : i * 2.399963229728653 + (Math.random() - 0.5) * 0.62;
        const radius = (i === 0 ? 0 : i === 1 ? 0.2 + Math.random() * 0.12
          : 0.48 + Math.random() * 0.3) * 1.08;
        const origin = new THREE.Vector3(Math.cos(angle) * radius,
          i === 0 ? 0.12 : -0.08 + Math.random() * 0.5, Math.sin(angle) * radius);
        mesh.position.copy(origin);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        mesh.scale.setScalar(0.001);
        mesh.renderOrder = 29;
        blast.add(mesh);
        const size = (i === 0 ? 1.5 : i === 1 ? 1.3 + Math.random() * 0.14
          : 1.1 + Math.random() * 0.34) * blastScale;
        fireLayers.push({
          mesh, material, origin,
          delay: i === 0 ? 0 : 0.018 + Math.random() * 0.045,
          life: i === 0 ? 0.42 : 0.34 + Math.random() * 0.05,
          maxScale: new THREE.Vector3(size * (0.9 + Math.random() * 0.18),
            size * (0.82 + Math.random() * 0.22), size * (0.9 + Math.random() * 0.18)),
          maxOpacity: i === 0 ? 1 : 0.94,
          heatOffset: i === 0 ? -0.1 : i === 1 ? 0.06 : 0.14 + Math.random() * 0.12,
          emissivePeak,
          spin: new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.7,
            (Math.random() - 0.5) * 1.5),
          drift: new THREE.Vector3(Math.cos(angle) * (0.12 + Math.random() * 0.17),
            0.04 + Math.random() * 0.13, Math.sin(angle) * (0.12 + Math.random() * 0.17)),
        });
      }
      const dustLayers = [];
      if (!isHit) {
        const outward = new THREE.Vector3(p.x - C, 0, p.z - C);
        if (outward.lengthSq() < 0.001) outward.set(0, 0, 1);
        outward.normalize();
        const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
        const dustPalette = [0xf4efe5, 0xe7e0d3, 0xd2ccc4, 0xb7b0aa];
        for (let i = 0; i < 8; i++) {
          const color = dustPalette[i % dustPalette.length];
          const material = new THREE.MeshToonMaterial({
            color, gradientMap: toonGradient, emissive: color, emissiveIntensity: 0.08,
            transparent: true, opacity: 0, depthWrite: false, depthTest: true, toneMapped: false,
          });
          const mesh = new THREE.Mesh(explosionBlobGeometry, material);
          const side = (Math.random() - 0.5) * 1.6;
          const origin = new THREE.Vector3().addScaledVector(tangent, side)
            .addScaledVector(outward, (Math.random() - 0.5) * 0.16);
          origin.y = -0.14 + Math.random() * 0.55;
          mesh.position.copy(origin);
          mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
          mesh.scale.setScalar(0.001); mesh.renderOrder = 21 + i;
          blast.add(mesh);
          const width = 0.55 + Math.random() * 0.34;
          dustLayers.push({
            mesh, material, origin,
            delay: 0.27 + Math.random() * 0.045, life: 0.39 + Math.random() * 0.05,
            maxScale: new THREE.Vector3(width, 0.5 + Math.random() * 0.4, 0.44 + Math.random() * 0.28),
            maxOpacity: 0.58 + Math.random() * 0.16,
            spin: new THREE.Vector3((Math.random() - 0.5) * 0.65, (Math.random() - 0.5) * 0.75,
              (Math.random() - 0.5) * 0.65),
            drift: new THREE.Vector3().addScaledVector(tangent, (Math.random() - 0.5) * 0.32)
              .addScaledVector(outward, -0.08 - Math.random() * 0.16)
              .add(new THREE.Vector3(0, 0.32 + Math.random() * 0.42, 0)),
          });
        }
      }
      const hasLightBudget = explosionFx.filter((fx) => fx.light).length < MAX_EXPLOSION_LIGHTS;
      const light = hasLightBudget
        ? new THREE.PointLight(0xffdc57, isHit ? 18 : 15, isHit ? 9 : 8, 2) : null;
      if (light) { light.position.y = 0.45; light.castShadow = false; blast.add(light); }
      group.add(blast);
      const duration = Math.max(0.52, ...fireLayers.map((l) => l.delay + l.life),
        ...dustLayers.map((l) => l.delay + l.life)) + 0.06;
      explosionFx.push({
        group: blast, core, coreMat, burst, burstMat, fireLayers, dustLayers,
        light, lightPeak: isHit ? 18 : 15, age: 0, duration,
      });
    }
    function updateExplosions(dt) {
      const smooth = THREE.MathUtils.smoothstep;
      for (let i = explosionFx.length - 1; i >= 0; i--) {
        const fx = explosionFx[i];
        fx.age += dt;
        const u = Math.min(1, fx.age / fx.duration);
        const coreU = Math.min(1, fx.age / 0.29);
        fx.core.scale.setScalar(0.32 + 1.48 * (1 - Math.exp(-coreU * 7.5)));
        fx.coreMat.opacity = 1 - smooth(coreU, 0.22, 1);
        const burstU = Math.min(1, fx.age / 0.2);
        fx.burst.scale.setScalar(0.42 + 0.78 * (1 - Math.pow(1 - burstU, 3)));
        fx.burst.rotation.y += dt * 1.2;
        fx.burstMat.opacity = 1 - smooth(burstU, 0.16, 1);
        for (const layer of fx.fireLayers) {
          const local = (fx.age - layer.delay) / layer.life;
          if (local <= 0 || local >= 1) { layer.material.opacity = 0; continue; }
          const appear = smooth(local, 0, 0.075), fade = 1 - smooth(local, 0.56, 1);
          const enter = Math.min(1, local / 0.18), pop = 1 - Math.pow(1 - enter, 3);
          const contract = 1 - 0.62 * smooth(local, 0.54, 1);
          layer.mesh.scale.copy(layer.maxScale).multiplyScalar(Math.max(0.001, pop * contract));
          const move = smooth(local, 0.12, 1);
          layer.mesh.position.copy(layer.origin).addScaledVector(layer.drift, move);
          layer.mesh.rotation.x += layer.spin.x * dt;
          layer.mesh.rotation.y += layer.spin.y * dt;
          layer.mesh.rotation.z += layer.spin.z * dt;
          layer.material.opacity = appear * fade * layer.maxOpacity;
          const heat = THREE.MathUtils.clamp(local + layer.heatOffset, 0, 1);
          if (heat < 0.2) layer.material.color.lerpColors(FIRE_CORE, FIRE_HOT, heat / 0.2);
          else if (heat < 0.48) layer.material.color.lerpColors(FIRE_HOT, FIRE_GOLD, (heat - 0.2) / 0.28);
          else if (heat < 0.75) layer.material.color.lerpColors(FIRE_GOLD, FIRE_CORAL, (heat - 0.48) / 0.27);
          else layer.material.color.lerpColors(FIRE_CORAL, FIRE_BURNT, (heat - 0.75) / 0.25);
          layer.material.emissive.copy(layer.material.color);
          layer.material.emissiveIntensity = 0.04 + layer.emissivePeak * (1 - smooth(local, 0.1, 0.68));
        }
        for (const layer of fx.dustLayers) {
          const local = (fx.age - layer.delay) / layer.life;
          if (local <= 0 || local >= 1) { layer.material.opacity = 0; continue; }
          const appear = smooth(local, 0, 0.13), fade = 1 - smooth(local, 0.56, 1);
          const grow = 1 - Math.pow(1 - Math.min(1, local / 0.32), 3);
          layer.mesh.scale.copy(layer.maxScale).multiplyScalar(Math.max(0.001, grow));
          layer.mesh.position.copy(layer.origin).addScaledVector(layer.drift, local);
          layer.mesh.rotation.x += layer.spin.x * dt;
          layer.mesh.rotation.y += layer.spin.y * dt;
          layer.mesh.rotation.z += layer.spin.z * dt;
          layer.material.opacity = appear * fade * layer.maxOpacity;
        }
        if (fx.light) fx.light.intensity = fx.lightPeak * Math.exp(-fx.age * 10.5);
        if (u >= 1) { disposeExplosion(fx); explosionFx.splice(i, 1); }
      }
    }
    function updateBowser(frame, t, dt) {
      // the ship FLOATS (gentle bob + roll) and drifts a little to frame.ship.x;
      // Bowser STANDS on the deck (the cannons fire), just riding the ship's motion.
      const targetX = frame?.ship ? frame.ship.x : C;
      shipState.curX += (targetX - shipState.curX) * (1 - Math.exp(-dt * 5));
      const bobY = Math.sin(t * 0.9) * 0.3; // up-down float
      const roll = Math.sin(t * 0.65) * 0.045; // side roll
      const pitch = Math.sin(t * 0.5 + 1.0) * 0.02; // fore-aft pitch
      if (shipState.obj) {
        shipState.obj.position.set(shipState.curX, SHIP.y + bobY, SHIP.z);
        shipState.obj.rotation.set(pitch, SHIP.ry, roll);
      }
      if (bowser.obj) {
        bowser.obj.position.set(
          shipState.curX + BOWSER_OFFSET_X,
          SHIP_DECK_Y + bobY,
          SHIP_DECK_Z + BOWSER_OFFSET_Z,
        );
        bowser.obj.rotation.set(pitch, 0, roll); // just rides the roll
      }
      updateCannonFx(dt);
      updateExplosions(dt);
    }

    // ---- crate-break shards (wooden debris flung out when a crate is smashed)
    const shardGeo = track(new THREE.BoxGeometry(0.16, 0.16, 0.16));
    const shardMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xba7a32,
        roughness: 0.85,
      }),
    );
    const shards = [];
    function spawnShards(x, z) {
      for (let i = 0; i < 11; i++) {
        const s = new THREE.Mesh(shardGeo, shardMat);
        s.position.set(x, 0.35, z);
        const ang = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 3.5;
        s.userData.v = [
          Math.cos(ang) * sp,
          2.6 + Math.random() * 2.6,
          Math.sin(ang) * sp,
        ];
        s.userData.rv = [
          Math.random() * 9,
          Math.random() * 9,
          Math.random() * 9,
        ];
        s.userData.life = 0;
        s.castShadow = true;
        group.add(s);
        shards.push(s);
      }
    }
    function updateShards(dt) {
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        const v = s.userData.v;
        v[1] -= 13 * dt; // gravity
        s.position.x += v[0] * dt;
        s.position.y += v[1] * dt;
        s.position.z += v[2] * dt;
        if (s.position.y < 0.08) {
          // bounce + settle
          s.position.y = 0.08;
          v[0] *= 0.6;
          v[2] *= 0.6;
          v[1] *= -0.32;
        }
        s.rotation.x += s.userData.rv[0] * dt;
        s.rotation.y += s.userData.rv[1] * dt;
        s.rotation.z += s.userData.rv[2] * dt;
        s.userData.life += dt;
        if (s.userData.life >= 0.75) {
          group.remove(s);
          shards.splice(i, 1);
        }
      }
    }

    // ---- the Chain-Chomp, driven by the live snapshot's `chains` list -------
    // The backend THROWS the chomp head out (phase "out") then latches + reels the
    // rival in (phase "reel"); here we just draw a real, densely-linked CHAIN from the
    // thrower to the head each frame - interlocked torus links (alternating 90deg),
    // not a few floating rings, with the black chomp ball at the head.
    const chainMeshes = new Map(); // chain id -> {g, links, head, ...}
    const CHAIN_LINK_SPACING = 0.26,
      CHAIN_MAX_LINKS = 60;
    const chainLinkGeo = track(new THREE.TorusGeometry(0.115, 0.05, 7, 12));
    function makeChain() {
      const g = new THREE.Group();
      const linkMat = new THREE.MeshStandardMaterial({
        color: 0x3a3a3a,
        roughness: 0.4,
        metalness: 0.85,
      });
      const links = [];
      for (let i = 0; i < CHAIN_MAX_LINKS; i++) {
        const l = new THREE.Mesh(chainLinkGeo, linkMat);
        l.visible = false;
        l.castShadow = true;
        g.add(l);
        links.push(l);
      }
      const headMat = new THREE.MeshStandardMaterial({
        color: 0x161616,
        roughness: 0.35,
        metalness: 0.35,
      });
      const headGeo = new THREE.SphereGeometry(0.44, 18, 14);
      const head = new THREE.Mesh(headGeo, headMat);
      head.castShadow = true;
      g.add(head);
      group.add(g);
      return { g, links, head, linkMat, headMat, headGeo };
    }
    function disposeChainObj(c) {
      group.remove(c.g);
      c.linkMat.dispose();
      c.headMat.dispose();
      c.headGeo.dispose();
    }
    function syncChains(frame, dt) {
      const active = new Set();
      for (const ch of frame?.chains || []) {
        active.add(ch.id);
        let c = chainMeshes.get(ch.id);
        if (!c) {
          c = makeChain();
          chainMeshes.set(ch.id, c);
        }
        const from = frame?.[ch.owner]; // chain is anchored at the thrower
        const head = ch.head;
        if (!from || !head) continue;
        const dx = head[0] - from[0],
          dz = head[1] - from[1];
        const dist = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        const n = Math.max(
          2,
          Math.min(CHAIN_MAX_LINKS, Math.round(dist / CHAIN_LINK_SPACING) + 1),
        );
        for (let k = 0; k < c.links.length; k++) {
          const l = c.links[k];
          if (k >= n) {
            l.visible = false;
            continue;
          }
          const f = k / (n - 1);
          l.visible = true;
          l.position.set(
            from[0] + dx * f,
            0.8 + Math.sin(f * Math.PI) * 0.1,
            from[1] + dz * f,
          );
          // interlock: alternate a horizontal ring and a vertical ring facing the run
          if (k % 2) l.rotation.set(0, yaw + Math.PI / 2, 0);
          else l.rotation.set(Math.PI / 2, 0, 0);
        }
        c.head.position.set(head[0], 0.85, head[1]);
        c.head.rotation.y += dt * 8;
      }
      for (const [id, c] of chainMeshes) {
        if (active.has(id)) continue;
        disposeChainObj(c);
        chainMeshes.delete(id);
      }
    }

    function updateCTF(t, dt, frame) {
      // the flag: the POLE stays planted at the centre; only the CLOTH travels - it
      // rests on the pole when free and flies to ride above the carrier when held.
      const f = frame?.flag;
      const holder = f?.holder ?? frame?.flagHolder ?? null;
      const held = holder === "red" || holder === "blue";
      const carrier = held ? frame?.[holder] : null;
      if (flag.clothWrap && flag.clothHome) {
        const home = flag.clothHome;
        const tx = held && carrier ? carrier[0] : home.x;
        const tz = held && carrier ? carrier[1] : home.z;
        // carried just above the character's head, not floating high in the air
        const ty = held ? 0.9 + Math.sin(t * 5) * 0.08 : home.y;
        const rate = held ? 1 - Math.exp(-dt * 14) : 0.12;
        flag.clothWrap.position.x += (tx - flag.clothWrap.position.x) * rate;
        flag.clothWrap.position.y += (ty - flag.clothWrap.position.y) * rate;
        flag.clothWrap.position.z += (tz - flag.clothWrap.position.z) * rate;
        flag.clothWrap.rotation.z = held ? Math.sin(t * 3) * 0.12 : 0; // lean while carried
      }
      // WIND on the cloth only (the FlagMT mesh): a vertex ripple growing from the
      // pole to the free edge; the BodyMT pole is untouched.
      if (flag.cloth && flag.wave) {
        const g = flag.cloth.geometry;
        const pos = g.attributes.position;
        const b = flag.clothBase;
        const { normalAxis, lenAxis, lo, range } = flag.wave;
        const amp = range * (held ? 0.06 : 0.045); // flaps harder when carried
        for (let i = 0; i < pos.count; i++) {
          const along = (b[i * 3 + lenAxis] - lo) / range; // 0 at pole .. 1 at edge
          const disp = Math.sin(along * 5.0 - t * 7) * amp * along;
          pos.array[i * 3 + normalAxis] = b[i * 3 + normalAxis] + disp;
        }
        pos.needsUpdate = true;
      }

      // home bases: just a gentle glow pulse (capture COUNT is shown in the HUD)
      for (const side of ["red", "blue"]) {
        const ph = side === "red" ? 0 : 1.5;
        baseVis[side].glow.intensity = 0.6 + Math.sin(t * 3 + ph) * 0.2;
      }

      // stun stars, per side (spun overhead while an agent is stunned)
      const stun = frame?.stun || {};
      for (const side of ["red", "blue"]) {
        const p = frame?.[side];
        const a = aura[side];
        const wasVisible = a.stars.visible;
        a.stars.visible = (stun[side] || 0) > 0 && !!p;
        if (a.stars.visible) {
          // An oil-slick stun BEGINS with a knock-back: live.js is still flying the
          // character over from where it stood, so appear THERE and glide to the
          // landing with it, instead of popping up over empty sand. A jump beyond
          // any real knock-back means a replay seek - appear in place instead.
          if (!wasVisible) {
            const from =
              a.lastPos &&
              Math.hypot(p[0] - a.lastPos[0], p[1] - a.lastPos[1]) <= 4.5
                ? a.lastPos
                : p;
            a.stars.position.set(from[0], 2.35, from[1]);
          } else {
            const follow = 1 - Math.exp(-dt * 7); // ~the walker's 0.55s flight
            a.stars.position.x += (p[0] - a.stars.position.x) * follow;
            a.stars.position.z += (p[1] - a.stars.position.z) * follow;
          }
          a.stars.rotation.y += dt * 5.5; // whirl the dizzy ring
          a.stars.children.forEach(
            (
              s,
              i, // + a little bob per star
            ) => (s.position.y = Math.sin(t * 6 + i * 2.1) * 0.12),
          );
        }
        if (p) a.lastPos = [p[0], p[1]];
      }

      // crates, flying shells, laid traps, thrown chains, Bowser + his objects
      syncCrates(frame, t, dt);
      syncShells(frame, t, dt);
      syncTraps(frame, t);
      syncChains(frame, dt);
      syncHazards(frame, dt);
      updateBowser(frame, t, dt);
      for (const ev of frame?.ctfEvents || []) {
        if (!rememberEvent(ev.id)) continue;
        if (ev.type === "crate" && ev.pos) {
          spawnShards(ev.pos[0], ev.pos[1]); // the smash burst
        } else if (ev.type === "throw") {
          spawnCannonFire(); // a cannon flashes + smokes as the bomb is fired
        } else if (ev.type === "bombhit" && ev.pos) {
          spawnExplosion(ev.pos[0], ev.pos[1]); // the bomb lands + explodes
        }
      }
      updateShards(dt);
    }

    function resetEffects(frameToSuppress = null) {
      seenEvents.clear();
      seenOrder.length = 0;
      for (const [, c] of chainMeshes) disposeChainObj(c);
      chainMeshes.clear();
      // clear transient weapon props so a new episode starts clean
      for (const s of shards) group.remove(s);
      shards.length = 0;
      for (const [, m] of shellMeshes) group.remove(m);
      shellMeshes.clear();
      for (const [, m] of trapMeshes) group.remove(m);
      trapMeshes.clear();
      for (const [, m] of hazardMeshes) group.remove(m);
      hazardMeshes.clear();
      for (const f of cannonFx) { group.remove(f.m); f.m.material.dispose(); }
      cannonFx.length = 0;
      for (const fx of explosionFx) disposeExplosion(fx);
      explosionFx.length = 0;
      // absorb events already present in a restored frame so they don't re-fire
      for (const ev of frameToSuppress?.ctfEvents || []) rememberEvent(ev.id);
    }

    // ---- animation + teardown ---------------------------------------------
    function update(t, dt, frame) {
      // the Inverted Pyramid hovers + turns
      if (pyramid) {
        pyramid.w.position.y = pyramid.y + Math.sin(t * 0.5) * 0.35;
        pyramid.w.rotation.y += dt * 0.06;
      }

      // --- dusk atmosphere ---
      // blowing sand streams across the plaza, wrapping around the far edge
      const dp = dust.pos;
      for (let i = 0; i < dust.N; i++) {
        dp[i * 3] += dust.wind * dt;
        dp[i * 3 + 2] += Math.sin(t * 0.3 + i) * dt * 0.5;
        if (dp[i * 3] > C + 37) dp[i * 3] -= 74;
      }
      dust.pts.geometry.attributes.position.needsUpdate = true;

      // the tumbleweed rolls across on the wind every so often, then is hidden
      // until the next pass (the SAME path every time - no randomised lane)
      const CYCLE = 12,
        CROSS = 6.2;
      const cyc = t % CYCLE;
      if (cyc < CROSS) {
        const p = cyc / CROSS; // 0..1 across the desert, west -> east
        // start + end well OFF-SCREEN so it rolls IN from outside and exits
        // outside - never popping into existence mid-frame
        const x = -16 + (A + 32) * p;
        // ALWAYS the same lane, right up FRONT near the camera: high z is the
        // south foreground, which sits LOW on the screen (this is the "lower"
        // that was wanted - screen position, not world height). Fixed per pass.
        // A+4 is the lowest lane still readable - past this the camera crops it
        // off the bottom edge of the frame (verified by render).
        const z = A + 4;
        // rolls ON the sand with a natural bounce (height was never the issue)
        const hop = Math.abs(Math.sin(p * 6.5 * Math.PI)) * 0.35;
        tumble.visible = true;
        tumble.position.set(x, TUMBLE_R * 0.78 + hop, z);
        tumble.rotation.z -= dt * 6.5; // forward roll
        tumble.rotation.x += dt * 2.4; // wobble
      } else {
        tumble.visible = false;
      }

      // the Capture-the-Flag props (flag / crates / bases / auras / chain FX)
      updateCTF(t, dt, frame);
    }

    function dispose() {
      disposed = true;
      for (const [, c] of chainMeshes) disposeChainObj(c);
      chainMeshes.clear();
      for (const [, m] of crateMeshes) group.remove(m);
      crateMeshes.clear();
      // remove the pooled weapon props (their shared geo/mat are freed via `trash`)
      for (const [, m] of shellMeshes) group.remove(m);
      shellMeshes.clear();
      for (const [, m] of trapMeshes) group.remove(m);
      trapMeshes.clear();
      for (const [, m] of hazardMeshes) group.remove(m);
      hazardMeshes.clear();
      for (const f of cannonFx) { group.remove(f.m); f.m.material.dispose(); }
      cannonFx.length = 0;
      for (const fx of explosionFx) disposeExplosion(fx);
      explosionFx.length = 0;
      for (const s of shards) group.remove(s);
      shards.length = 0;
      const disposeTree = (obj) =>
        obj?.traverse?.((o) => {
          if (!o.isMesh) return;
          o.geometry?.dispose?.();
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const mm of ms) mm?.dispose?.();
        });
      if (crateProtoObj) {
        disposeTree(crateProtoObj);
        crateProtoObj = null;
      }
      disposeTree(flag.poleWrap);
      if (flag.clothWrap) {
        disposeTree(flag.clothWrap);
        flag.clothWrap = null;
      }
      scene.remove(group);
      for (const o of trash) o.dispose?.();
    }

    return { group, update, resetEffects, dispose };
  },
};
