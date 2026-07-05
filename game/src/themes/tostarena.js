// Round 5 — Tostarena (Sand Kingdom): the SEQUENTIAL continuous arena.
//
// A STREET-LEVEL town square, composed like the city round (round 2), not the
// floating-island rounds: the arena is Tostarena's sandy plaza, the town's
// adobe buildings RING it on every side at ground level, and the desert runs
// to the fog. There is no grid: the round is a CHECKPOINT RALLY - each racer's
// ordered tour (near-side oasis -> far-side ruin gate -> the pyramid finish)
// is drawn straight onto the sand as a dashed racing line in its own colour,
// with glowing rings at every waypoint and a light beacon standing on whichever
// ring is that racer's CURRENT target (driven live from the snapshot's
// redCp/blueCp). The town FOUNTAIN stands in the middle of the plaza, its
// shallow pool doubling as the env's central slow-zone; the two outer QUICKSAND
// pools swirl where the env slows the racers, and two procedural DUST DEVILS
// roam, mirroring the env's deterministic orbit. The Inverted Pyramid hovers
// tip-down beyond the north edge as the finish monument.
//
// Nothing may cover the y=0 arena surface above ~0.16 (the racers' feet).
// Models come from the vendored Sand Kingdom OBJ/MTL pack in
// assets/models/tostarena (Models Resource rip, same pipeline as ruined.js).

import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";

const ASSETS = "./assets/models/tostarena/";

function hash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

export const tostarena = {
  name: "tostarena",
  title: "Tostarena",
  subtitle: "Desert Checkpoint Rally",
  // hot desert noon: deep blue zenith over a sand-glow horizon, warm haze
  sky: ["#2f6cc0", "#7db4e8", "#f4e2bd"],
  fog: 0xecd8ae,
  // street-level scene: the desert floor melts into warm haze much closer
  // than the floating rounds' backdrops
  fogNear: 70,
  fogFar: 300,
  hemi: [0xcfe0f2, 0x8a6f4d, 0.62],
  sun: 0xfff2cf,
  sunIntensity: 3.4,
  fill: 0xa8c4ea,
  fillIntensity: 0.22,
  exposure: 1.04,
  bloom: { strength: 0.2, radius: 0.42, threshold: 0.86 },
  env: "./assets/hdri/qwantani_noon_2k.hdr", // the vendored noon HDRI is already a desert
  envIntensity: 0.5,
  envBackground: false,
  camera: { startDist: 38, maxDist: 38 },
  redName: "DQN",
  blueName: "Dueling-DQN",

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
    const tours = world.tours || {
      red: [
        [4.0, 12.5, 1.3],
        [16.0, 8.0, 1.3],
        [C, 2.6, 1.5],
      ],
      blue: [
        [16.0, 12.5, 1.3],
        [4.0, 8.0, 1.3],
        [C, 2.6, 1.5],
      ],
    };
    const quicksand = world.quicksand || [];
    const spawns = world.spawns || { red: [7, A - 2.5], blue: [13, A - 2.5] };
    const finish = tours.red[tours.red.length - 1];

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
    const TOP = 0; // the ground plane IS the play surface
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

    // a low sun-bleached kerb marking the [0,A] arena square, so the physics
    // walls the racers bounce off are VISIBLE on the wider plate
    {
      const kerbMat = track(
        new THREE.MeshStandardMaterial({ color: 0xecd6ac, roughness: 0.9 }),
      );
      const kx = track(new THREE.BoxGeometry(A + 0.4, 0.1, 0.16));
      const kz = track(new THREE.BoxGeometry(0.16, 0.1, A + 0.4));
      for (const [gx, gz, geo] of [
        [C, -0.08, kx],
        [C, A + 0.08, kx],
        [-0.08, C, kz],
        [A + 0.08, C, kz],
      ]) {
        const k = new THREE.Mesh(geo, kerbMat);
        k.position.set(gx, TOP + 0.05, gz);
        k.castShadow = true;
        k.receiveShadow = true;
        group.add(k);
      }
    }

    // soft tonal patches (windblown dark scars + sun-bleached streaks) break
    // the near-uniform red of the pack's sand without covering any marker
    {
      const patchGeo = track(new THREE.CircleGeometry(1, 22));
      const mats = [
        track(
          new THREE.MeshBasicMaterial({
            color: 0x8a3a24,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
          }),
        ),
        track(
          new THREE.MeshBasicMaterial({
            color: 0xffd9a8,
            transparent: true,
            opacity: 0.13,
            depthWrite: false,
          }),
        ),
      ];
      for (let i = 0; i < 20; i++) {
        const m = new THREE.Mesh(patchGeo, mats[i % 2]);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = hashFloat(i, 1, 401) * Math.PI;
        m.scale.set(
          0.9 + hashFloat(i, 2, 402) * 1.6,
          0.5 + hashFloat(i, 3, 403) * 0.9,
          1,
        );
        m.position.set(
          1.5 + hashFloat(i, 4, 404) * (A - 3),
          TOP + 0.008,
          1.5 + hashFloat(i, 5, 405) * (A - 3),
        );
        m.renderOrder = 1;
        group.add(m);
      }
    }

    // ---- the RACING LINES: each side's tour dashed onto the sand -----------
    const lineMats = {
      red: track(
        new THREE.MeshBasicMaterial({
          color: 0xff7a5c,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      ),
      blue: track(
        new THREE.MeshBasicMaterial({
          color: 0x6fb4ff,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      ),
    };
    const dashGeo = track(new THREE.PlaneGeometry(0.5, 0.2));
    function dashLine(from, to, mat) {
      const dx = to[0] - from[0],
        dz = to[1] - from[1];
      const len = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      const n = Math.max(2, Math.floor(len / 0.85));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const m = new THREE.Mesh(dashGeo, mat);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -ang;
        m.position.set(from[0] + dx * t, 0.055, from[1] + dz * t);
        m.renderOrder = 1;
        group.add(m);
      }
    }
    for (const side of ["red", "blue"]) {
      let prev = spawns[side];
      for (const wp of tours[side]) {
        dashLine(prev, wp, lineMats[side]);
        prev = wp;
      }
    }

    // ---- CHECKPOINT RINGS + the two current-target BEACONS -----------------
    // rings[side][k] pulses while k is that side's live target (frame.redCp /
    // frame.blueCp), holds steady while upcoming, and fades once passed.
    const RING_COLORS = { red: 0xff6a4a, blue: 0x58a8ff };
    const rings = { red: [], blue: [] };
    function addRing(x, z, r, color, width = 0.16, y = 0.062) {
      const geo = track(new THREE.RingGeometry(r - width, r, 48));
      const mat = track(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.renderOrder = 2;
      group.add(m);
      return { mesh: m, mat, base: 0.55 };
    }
    for (const side of ["red", "blue"]) {
      const tour = tours[side];
      for (let k = 0; k < tour.length - 1; k++) {
        const [x, z, r] = tour[k];
        rings[side].push(addRing(x, z, r, RING_COLORS[side]));
      }
    }
    // the shared finish: one gold ring + per-side accents just outside it
    const [fx, fz, fr] = finish;
    const goldRing = addRing(fx, fz, fr, 0xffd24a, 0.2);
    rings.red.push(addRing(fx, fz, fr + 0.3, RING_COLORS.red, 0.07));
    rings.blue.push(addRing(fx, fz, fr + 0.55, RING_COLORS.blue, 0.07));

    // one light beacon per side, standing on that racer's CURRENT target ring
    const beacons = {};
    for (const side of ["red", "blue"]) {
      const geo = track(
        new THREE.CylinderGeometry(0.34, 0.5, 3.4, 18, 1, true),
      );
      const mat = track(
        new THREE.MeshBasicMaterial({
          color: RING_COLORS[side],
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 3;
      m.traverse((o) => (o.userData.excludeBloom = true));
      const [bx, bz] = tours[side][0];
      m.position.set(bx, 1.72, bz);
      group.add(m);
      beacons[side] = { mesh: m, mat };
    }

    // ---- QUICKSAND pools: swirling discs of the pack's own texture ---------
    // The slow-zone nearest the plaza centre is NOT drawn as quicksand - the
    // town fountain (below) stands in it and its wading pool plays that part.
    const centerIdx = quicksand.reduce(
      (best, q, i) =>
        Math.hypot(q[0] - C, q[1] - C) <
        Math.hypot(quicksand[best]?.[0] - C, quicksand[best]?.[1] - C)
          ? i
          : best,
      0,
    );
    const sandSwirls = [];
    for (let qi = 0; qi < quicksand.length; qi++) {
      if (qi === centerIdx) continue;
      const [qx, qz, qr] = quicksand[qi];
      const tex = assetTexture("QuickSand00_alb.png", 1, 1);
      tex.center.set(0.5, 0.5);
      const mat = track(
        new THREE.MeshStandardMaterial({
          map: tex,
          color: 0xd8b078,
          roughness: 1,
          metalness: 0,
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
        }),
      );
      const m = new THREE.Mesh(
        track(new THREE.CircleGeometry(qr * 1.08, 40)),
        mat,
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(qx, 0.05, qz);
      m.renderOrder = 1;
      m.receiveShadow = true;
      group.add(m);
      // a darker sunken rim so the pool reads as a depression
      const rim = new THREE.Mesh(
        track(new THREE.RingGeometry(qr * 1.02, qr * 1.22, 40)),
        track(
          new THREE.MeshBasicMaterial({
            color: 0x8a6a42,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
          }),
        ),
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(qx, 0.053, qz);
      rim.renderOrder = 1;
      group.add(rim);
      sandSwirls.push({
        tex,
        speed: 0.05 + hashFloat(qx * 7, qz * 13, 3) * 0.04,
      });
    }

    // ---- DUST DEVILS: two procedural tornados driven by the live frame -----
    // The env moves them on a deterministic mirrored orbit; between snapshot
    // polls we ease toward the latest reported position (same trick live.js
    // uses for the racers), falling back to the local formula when no frame
    // has arrived yet (start menu / preview).
    const TOR = { D0: 2.2, D1: 1.8, Z0: 9.0, Z1: 3.5, WD: 0.055, WZ: 0.031 };
    function tornadoFormula(steps) {
      const d = TOR.D0 + TOR.D1 * Math.sin(TOR.WD * steps);
      const z = TOR.Z0 + TOR.Z1 * Math.sin(TOR.WZ * steps + 1.1);
      return [
        [C - d, z],
        [C + d, z],
      ];
    }
    const devilMatBase = {
      color: 0xdcbd8f,
      transparent: true,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    };
    const devils = [];
    function dustDevil(seed) {
      const g = new THREE.Group();
      const spinners = [];
      for (let i = 0; i < 6; i++) {
        const f = i / 5;
        const r = 0.3 + f * 0.8;
        const geo = track(
          new THREE.CylinderGeometry(r * 1.08, r * 0.78, 0.6, 12, 1, true),
        );
        const mat = track(
          new THREE.MeshStandardMaterial({
            ...devilMatBase,
            opacity: 0.34 - f * 0.04,
          }),
        );
        const m = new THREE.Mesh(geo, mat);
        m.position.y = 0.32 + i * 0.55;
        m.position.x = (hashFloat(seed, i, 61) - 0.5) * 0.16;
        m.position.z = (hashFloat(seed, i, 62) - 0.5) * 0.16;
        m.userData.spin = 5.5 - f * 2.4;
        g.add(m);
        spinners.push(m);
      }
      // dusty skirt at the foot
      const skirt = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.8, 12, 8)),
        track(
          new THREE.MeshStandardMaterial({ ...devilMatBase, opacity: 0.24 }),
        ),
      );
      skirt.scale.set(1.5, 0.4, 1.5);
      skirt.position.y = 0.22;
      g.add(skirt);
      // orbiting debris chips
      const chips = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const chip = new THREE.Mesh(
          track(new THREE.PlaneGeometry(0.16, 0.12)),
          track(
            new THREE.MeshStandardMaterial({ ...devilMatBase, opacity: 0.6 }),
          ),
        );
        const a = (i / 6) * Math.PI * 2;
        const rr = 0.7 + hashFloat(seed, i, 63) * 0.5;
        chip.position.set(
          Math.cos(a) * rr,
          0.5 + hashFloat(seed, i, 64) * 2.4,
          Math.sin(a) * rr,
        );
        chip.rotation.set(a, a * 1.7, a * 0.6);
        chips.add(chip);
      }
      g.add(chips);
      g.traverse((o) => (o.userData.excludeBloom = true));
      group.add(g);
      devils.push({ g, spinners, chips, target: null });
      return g;
    }
    {
      const [p0, p1] = tornadoFormula(0);
      dustDevil(11).position.set(p0[0], 0, p0[1]);
      dustDevil(23).position.set(p1[0], 0, p1[1]);
    }

    // ---- LANDMARKS ---------------------------------------------------------
    // the Inverted Pyramid: the finish monument, hovering beyond the north rim,
    // slowly turning like it does over Tostarena
    let pyramid = null;
    placeObj("Pyramid000", C, -12, {
      footprint: 15,
      baseY: 8.5, // clears the big town blocks' rooftops below it
      ry: 0.4,
      onPlaced: (w) => {
        // backdrop monument: at this size its shadow is a black lake on the
        // desert, so it doesn't cast (same rule as the fossilfalls backdrop)
        w.traverse((o) => (o.castShadow = false));
        pyramid = { w, y: 8.5 };
      },
    });

    // oasis water + palms at each side's first checkpoint
    for (const side of ["red", "blue"]) {
      const [ox, , or_] = tours[side][0];
      const oz = tours[side][0][1];
      // the oasis model is nearly FLAT - keep its base above the mesa's real
      // top surface or the whole pool vanishes into the plate
      placeObj("WaterOasis", ox, oz, { footprint: or_ * 2.4, baseY: 0.04 });
      // the palm's crown is only the top ~18% of the model, so palms need to
      // stand TALL (and a bit fat) for the fronds to read at arena scale
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (side === "red" ? 0.6 : 2.7);
        const rr = or_ * 1.7 + hashFloat(ox * 3, i, 71) * 0.5;
        placeObj("TreePalm000", ox + Math.cos(a) * rr, oz + Math.sin(a) * rr, {
          height: 3.2 + hashFloat(ox * 5, i, 72) * 1.0,
          ry: hashFloat(ox * 7, i, 73) * Math.PI * 2,
        });
      }
    }

    // ruin markers at each side's second checkpoint. StonePillar000 is itself
    // a CLUSTER of three pillars, so ONE placement per gate is a whole ruin -
    // offset toward the nearest rim so the racers never clip through it
    for (const side of ["red", "blue"]) {
      const [gx, gz] = tours[side][1];
      const outX = gx > C ? gx + 2.3 : gx - 2.3;
      placeObj("StonePillar000", outX, gz, {
        footprint: 3.0,
        height: 2.4,
        ry: hashFloat(gx, 1, 81) * 0.6 + (gx > C ? 0.3 : -0.3),
      });
    }

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
    };
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
      if (keep.length === triCount) return geo; // whole mesh is on this side
      if (!keep.length) return null;
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
    function placeTownHalf(which) {
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
          const g2 = splitGeometryX(o.geometry, midX, which === "left");
          if (!g2) {
            o.visible = false;
            return;
          }
          if (g2 !== o.geometry) o.geometry = track(g2);
        });
        inst.position.set(-ctr.x, -box.min.y, -ctr.z);
        const s = TOWN.size / Math.max(size.x, size.z, 0.001);
        const wrap = new THREE.Group();
        wrap.add(inst);
        wrap.scale.setScalar(s);
        const p = TOWN[which];
        wrap.rotation.y = p.ry;
        wrap.position.set(p.x, p.y ?? TOWN.y, p.z);
        group.add(wrap);
      });
    }
    placeTownHalf("left");
    placeTownHalf("right");

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

    // ---- the CENTRE PIECE: the town fountain in the middle of the plaza ----
    // It stands inside the env's central slow-zone (the one skipped by the
    // quicksand loop above), so its shallow pool IS the hazard: wade through
    // the fountain square and you lose speed.
    const centerPool = quicksand[centerIdx] || null;
    if (centerPool) {
      const [fxc, fzc, frc] = centerPool;
      placeObj("WaterFountain", fxc, fzc, { footprint: frc * 1.5, baseY: TOP });
      // the shallow wading pool around it: teal water out to the slow radius
      const pool = new THREE.Mesh(
        track(new THREE.CircleGeometry(frc * 1.04, 48)),
        oasisWaterMat,
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(fxc, TOP + 0.055, fzc);
      pool.renderOrder = 2;
      group.add(pool);
      // a pale stone lip so the pool reads deliberate, not spilled
      const lip = new THREE.Mesh(
        track(new THREE.RingGeometry(frc * 1.02, frc * 1.16, 48)),
        track(
          new THREE.MeshStandardMaterial({ color: 0xead8b4, roughness: 0.85 }),
        ),
      );
      lip.rotation.x = -Math.PI / 2;
      lip.position.set(fxc, TOP + 0.06, fzc);
      lip.receiveShadow = true;
      group.add(lip);
    }

    // ---- animation + teardown ---------------------------------------------
    let simSteps = 0; // formula clock while no live frame is available
    function update(t, dt, frame) {
      // checkpoint rings + beacons track each side's live tour progress
      const prog = {
        red: frame && Number.isInteger(frame.redCp) ? frame.redCp : 0,
        blue: frame && Number.isInteger(frame.blueCp) ? frame.blueCp : 0,
      };
      for (const side of ["red", "blue"]) {
        const list = rings[side];
        const k = Math.min(prog[side], list.length - 1);
        for (let i = 0; i < list.length; i++) {
          const ring = list[i];
          if (i < prog[side]) {
            ring.mat.opacity = 0.1; // passed: a faint memory on the sand
          } else if (i === k) {
            // the live target breathes
            ring.mat.opacity = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3.2));
            ring.mesh.scale.setScalar(1 + 0.05 * Math.sin(t * 3.2));
          } else {
            ring.mat.opacity = 0.3;
          }
        }
        // the beacon stands on the current target
        const tour = tours[side];
        const [bx, bz] = tour[Math.min(prog[side], tour.length - 1)];
        const b = beacons[side];
        const bob = 0.12 * Math.sin(t * 2.1 + (side === "red" ? 0 : 2));
        b.mesh.position.set(
          bx +
            (side === "red" ? -0.2 : 0.2) *
              (prog[side] === tours[side].length - 1 ? 1 : 0),
          1.72 + bob,
          bz,
        );
        b.mat.opacity = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 2.6));
        b.mesh.visible = !(frame && frame.winner); // hide once the race is decided
      }
      goldRing.mat.opacity = 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.2));

      // dust devils: ease toward the env's reported positions (or the local
      // deterministic orbit before the first frame arrives)
      simSteps += dt / 0.05;
      const targets =
        frame && Array.isArray(frame.tornados) && frame.tornados.length >= 2
          ? frame.tornados
          : tornadoFormula(simSteps);
      devils.forEach((dv, i) => {
        const [tx, tz] = targets[i];
        dv.g.position.x += (tx - dv.g.position.x) * Math.min(1, dt * 6);
        dv.g.position.z += (tz - dv.g.position.z) * Math.min(1, dt * 6);
        for (const s of dv.spinners) s.rotation.y += dt * s.userData.spin;
        dv.chips.rotation.y += dt * 3.4;
        dv.g.rotation.y += dt * 0.4;
      });

      // quicksand slowly swirls
      for (const s of sandSwirls) s.tex.rotation -= dt * s.speed * 6;

      // the Inverted Pyramid hovers + turns
      if (pyramid) {
        pyramid.w.position.y = pyramid.y + Math.sin(t * 0.5) * 0.35;
        pyramid.w.rotation.y += dt * 0.06;
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
