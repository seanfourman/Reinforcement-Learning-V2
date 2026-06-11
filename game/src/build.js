import * as THREE from 'three';
import { TILE_H, WALL_H, OUTER_WALL_H, PALETTE, BANNER_COLORS } from './config.js';
import { mulberry32 } from './generate.js';

// Turns a generated world layout into meshes. Everything repeated is
// instanced so the whole scene stays at a few dozen draw calls.

const dummy = new THREE.Object3D();

export function buildWorld(world, T) {
  const group = new THREE.Group();
  const { size, wall, gates, crystals, decals, outerGate, rng } = world;
  // Everything OUTSIDE the castle (ground, trees, rocks, fog) is decoration and
  // must look the same every time, so it runs off a fixed seed instead of the
  // per-regeneration world seed. Only the interior puzzle reshuffles.
  const nrng = mulberry32(0x5eed1ace);
  const animated = { crystalMats: [], energyMats: [], torches: [], banners: [], fog: [], water: [], ducks: [] };
  const disposables = [];

  const track = (obj) => {
    disposables.push(obj);
    return obj;
  };
  const mat = (opts) => track(new THREE.MeshStandardMaterial(opts));
  const geo = (g) => track(g);

  function instanced(geometry, material, items, { cast = true, receive = true } = {}) {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
      dummy.scale.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  }

  const tint = (hex, jitter = 0.04) =>
    new THREE.Color(hex).offsetHSL(0, 0, (rng() - 0.5) * jitter * 2);

  // smooth value noise on a FIXED lattice — large-scale ground variation that
  // is identical every regeneration
  const noiseN = 48;
  const noiseGrid = new Float32Array(noiseN * noiseN);
  for (let i = 0; i < noiseGrid.length; i++) noiseGrid[i] = nrng();
  const smooth = (t) => t * t * (3 - 2 * t);
  const gridAt = (a, b) =>
    noiseGrid[(((a % noiseN) + noiseN) % noiseN) * noiseN + (((b % noiseN) + noiseN) % noiseN)];
  function noise2(x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const tx = smooth(x - x0), tz = smooth(z - z0);
    const a = THREE.MathUtils.lerp(gridAt(x0, z0), gridAt(x0 + 1, z0), tx);
    const b = THREE.MathUtils.lerp(gridAt(x0, z0 + 1), gridAt(x0 + 1, z0 + 1), tx);
    return THREE.MathUtils.lerp(a, b, tz);
  }
  const fbm = (x, z) =>
    noise2(x, z) * 0.6 + noise2(x * 2.3 + 5, z * 2.3 + 5) * 0.3 + noise2(x * 4.7, z * 4.7) * 0.1;

  // ------------------------------------------------------------ ground
  const grout = new THREE.Mesh(
    geo(new THREE.PlaneGeometry(size, size)),
    mat({ map: T.ground, roughness: 1 })
  );
  grout.rotation.x = -Math.PI / 2;
  grout.position.set(size / 2, 0.015, size / 2);
  grout.receiveShadow = true;
  group.add(grout);

  const OUT = size + 150;
  const outsideTex = track(T.outsideGround.clone());
  outsideTex.repeat.set(OUT / 26, OUT / 26); // big tiles, hidden by vertex colors
  const outGeo = geo(new THREE.PlaneGeometry(OUT, OUT, 90, 90));
  {
    const pos = outGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cA = new THREE.Color(0x55683c); // base green
    const cB = new THREE.Color(0x728a52); // lighter green
    const cC = new THREE.Color(0x6c5a3b); // earthy brown
    const tmp = new THREE.Color();
    const cx = size / 2, cz = size / 2;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i);
      const wx = cx + px, wz = cz - py; // world coords after the -90° X rotation
      const shade = fbm(wx * 0.05 + 10, wz * 0.05 + 10);
      const dirt = fbm(wx * 0.13, wz * 0.13);
      tmp.copy(cA).lerp(cB, smooth(shade));
      tmp.lerp(cC, Math.max(0, dirt - 0.55) * 0.9);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
      // gentle rolling hills, but only well past the castle so walls stay put
      const d = Math.hypot(px, py);
      const amp = Math.min(Math.max(0, d - 30) * 0.13, 4.5);
      pos.setZ(i, (fbm(wx * 0.06 + 3, wz * 0.06 + 3) - 0.5) * amp);
    }
    outGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    outGeo.computeVertexNormals();
  }
  const outside = new THREE.Mesh(outGeo, mat({ map: outsideTex, roughness: 1, vertexColors: true }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(size / 2, -0.06, size / 2);
  outside.receiveShadow = true;
  group.add(outside);

  // ------------------------------------------------------------ floor tiles
  const tileGeo = geo(new THREE.BoxGeometry(0.94, TILE_H, 0.94));
  const tileSide = mat({ map: T.floorSide, roughness: 0.95 });
  const tileTop = mat({ map: T.floor, roughness: 0.85 });
  const tileMats = [tileSide, tileSide, tileTop, tileSide, tileSide, tileSide];
  const tiles = [];
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      if (wall[x][z]) continue;
      const roll = rng();
      const base =
        roll < 0.7 ? PALETTE.tileBase : roll < 0.84 ? PALETTE.tileWarm : roll < 0.92 ? PALETTE.tileRose : PALETTE.tileCool;
      tiles.push({
        x: x + 0.5,
        y: TILE_H / 2 + 0.02 + (rng() - 0.5) * 0.015,
        z: z + 0.5,
        ry: ((rng() * 4) | 0) * (Math.PI / 2),
        s: 1 + (rng() - 0.5) * 0.02,
        color: tint(base, 0.03),
      });
    }
  }
  instanced(tileGeo, tileMats, tiles, { cast: false });

  // ------------------------------------------------------------ inner walls
  const wallGeo = geo(new THREE.BoxGeometry(0.98, WALL_H, 0.98));
  const wallSide = mat({ map: T.wall, roughness: 0.95 });
  const wallTopM = mat({ map: T.wallTop, roughness: 0.95 });
  const wallMats = [wallSide, wallSide, wallTopM, wallSide, wallSide, wallSide];
  const capGeo = geo(new THREE.BoxGeometry(1.08, 0.13, 1.08));
  const wallCells = [];
  const caps = [];
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      if (!wall[x][z]) continue;
      wallCells.push({
        x: x + 0.5,
        y: WALL_H / 2 + 0.02,
        z: z + 0.5,
        color: tint(0xffffff, 0.06),
      });
      caps.push({
        x: x + 0.5,
        y: WALL_H + 0.08,
        z: z + 0.5,
        ry: ((rng() * 4) | 0) * (Math.PI / 2),
        color: tint(PALETTE.wallCap, 0.05).multiplyScalar(1.55),
      });
    }
  }
  instanced(wallGeo, wallMats, wallCells);
  instanced(capGeo, wallTopM, caps);

  // ============================================================ castle
  // Storybook fortress: curtain walls on a stone plinth with a walkway and
  // crenellated parapet, buttressed faces, four tapered drum towers with teal
  // cone roofs and pennants, and a twin-towered gatehouse whose doors stand
  // open onto a cobbled path. (The torches survived the remodel untouched.)
  const addBox = (g, m, x, y, z) => {
    const b = new THREE.Mesh(g, m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    group.add(b);
    return b;
  };
  const brickFit = (u, v) => {
    const t = track(T.outerWall.clone());
    t.repeat.set(u, v);
    return t;
  };
  const stoneFit = (u, v) => {
    const t = track(T.wallTop.clone());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(u, v);
    return t;
  };
  const roofFit = (u, v) => {
    const t = track(T.roof.clone());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(u, v);
    return t;
  };

  const H = 1.3; // wall-walk height (kept low so the bottom grid row stays visible)
  const TH = 1.0; // curtain wall thickness
  const PL = 0.55; // plinth height
  const northZ = -0.5, southZ = size + 0.5;
  const GAP = 2.2; // half-width of the gate opening (north-wall centre)
  const doorH = 1.45; // gate opening height (arch crown)
  // north wall runs end 0.4 INSIDE the gatehouse towers (never flush with the
  // tower faces — coplanar faces z-fight)
  const segW = size / 2 - GAP + 0.6;
  const segLcx = (-1 + size / 2 - GAP - 0.4) / 2;
  const segRcx = (size / 2 + GAP + 0.4 + size + 1) / 2;

  const wallMatLong = mat({ map: brickFit(17, 1.05), roughness: 0.95 });
  const wallMatShort = mat({ map: brickFit(7, 1.05), roughness: 0.95 });
  const towerMat = mat({ map: brickFit(6.5, 2.4), roughness: 0.95 });
  const gateTowerMat = mat({ map: brickFit(1.4, 2.1), roughness: 0.95 });
  const bridgeMat = mat({ map: brickFit(4.6, 1.1), roughness: 0.95 });
  const plinthMat = mat({ map: stoneFit(15, 0.5), color: 0xb5a292, roughness: 1 });
  const gatePlinthMat = mat({ map: stoneFit(1.6, 0.45), color: 0xb5a292, roughness: 1 });
  const stoneMat = mat({ map: T.wallTop, roughness: 0.95 });
  const walkMatX = mat({ map: stoneFit(15, 1), color: 0xddd2c4, roughness: 0.95 });
  const walkMatZ = mat({ map: stoneFit(1, 15), color: 0xddd2c4, roughness: 0.95 });
  // parapets + merlons continue the brick coursing so the masonry wraps the
  // whole wall instead of ending in a smeared light cap
  const parMatLong = mat({ map: brickFit(17, 0.21), roughness: 0.95 });
  const parMatShort = mat({ map: brickFit(7, 0.21), roughness: 0.95 });
  const merlonMat = mat({ map: brickFit(0.36, 0.29), roughness: 0.95 });
  const corbelMat = mat({ map: stoneFit(7, 1), roughness: 0.95 });
  const roofConeMat = mat({ map: roofFit(8, 1.4), roughness: 0.8 });
  const roofPyrMat = mat({ map: roofFit(6, 1), roughness: 0.8 });
  const finialMat = mat({ color: PALETTE.finial, emissive: PALETTE.finial, emissiveIntensity: 0.3, roughness: 0.4 });
  const finialGeo = geo(new THREE.SphereGeometry(0.16, 8, 8));
  const goldMat = mat({ color: 0xd8b25a, roughness: 0.5, metalness: 0.35 });
  const darkMat = mat({ color: 0x352f2a, roughness: 0.9 });
  const winMat = mat({ color: 0x3a2c1e, emissive: PALETTE.lantern, emissiveIntensity: 1.1, roughness: 0.6 });
  const bcol = (i) => new THREE.Color(BANNER_COLORS[i % BANNER_COLORS.length]);

  // shared detail lists, instanced once at the end of the section
  const merlons = []; // crenellation teeth
  const windows = []; // warm lit windows
  const sills = [];
  const btLow = [], btUp = [], btCap = []; // buttress stages

  // --- the swaying bits: tower pennants + hung cloth banners ----------------
  const penShape = new THREE.Shape();
  penShape.moveTo(0, 0);
  penShape.lineTo(0.66, 0.1);
  penShape.lineTo(0, 0.2);
  penShape.closePath();
  const penGeo = geo(new THREE.ShapeGeometry(penShape));
  function buildPennant(x, y, z, color) {
    const g = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.add(new THREE.Mesh(penGeo, mat({ color, side: THREE.DoubleSide, roughness: 0.85 })));
    g.add(pivot);
    g.position.set(x, y, z);
    g.rotation.y = -0.6 + (rng() - 0.5) * 0.5; // one prevailing wind
    group.add(g);
    animated.banners.push({ pivot, phase: rng() * 6.28 });
  }
  const bShape = new THREE.Shape();
  bShape.moveTo(-0.3, 0);
  bShape.lineTo(0.3, 0);
  bShape.lineTo(0.3, -0.92);
  bShape.lineTo(0, -1.12);
  bShape.lineTo(-0.3, -0.92);
  bShape.closePath();
  const bannerGeo = geo(new THREE.ShapeGeometry(bShape));
  const rodGeo = geo(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6));
  const rodEndGeo = geo(new THREE.SphereGeometry(0.05, 8, 6));
  const bandGeoB = geo(new THREE.PlaneGeometry(0.56, 0.13));
  const emblemGeo = geo(new THREE.CircleGeometry(0.105, 4));
  function buildBanner(x, y, z, ry, color, s = 1) {
    const g = new THREE.Group();
    g.scale.setScalar(s);
    const rod = new THREE.Mesh(rodGeo, goldMat);
    rod.rotation.z = Math.PI / 2;
    g.add(rod);
    for (const e of [-0.4, 0.4]) {
      const tip = new THREE.Mesh(rodEndGeo, goldMat);
      tip.position.x = e;
      g.add(tip);
    }
    const pivot = new THREE.Group();
    const cloth = new THREE.Mesh(bannerGeo, mat({ color, side: THREE.DoubleSide, roughness: 0.9 }));
    const band = new THREE.Mesh(bandGeoB, goldMat);
    band.position.set(0, -0.16, 0.012);
    const em = new THREE.Mesh(emblemGeo, goldMat);
    em.position.set(0, -0.58, 0.012);
    em.rotation.z = Math.PI / 4;
    pivot.add(cloth, band, em);
    pivot.position.y = -0.04;
    // lean the cloth away from the wall it hangs on, so the wind sway
    // (rotation.x up to ~0.15) never pushes it INTO the wall
    const lean = new THREE.Group();
    lean.rotation.x = -0.16;
    lean.add(pivot);
    g.add(lean);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    group.add(g);
    animated.banners.push({ pivot, phase: rng() * 6.28 });
  }

  // --- curtain walls: plinth, body, walkway slab, parapet + merlons ----------
  const towerCorners = [[-1.4, -1.4], [size + 1.4, -1.4], [-1.4, size + 1.4], [size + 1.4, size + 1.4]];
  const nearTower = (x, z, d) => towerCorners.some(([tx, tz]) => (x - tx) ** 2 + (z - tz) ** 2 < d * d);
  const runs = [
    { axis: 'x', cx: size / 2, cz: southZ, L: size + 2, out: 1, m: wallMatLong, wm: walkMatX, pm: parMatLong, bt: [-7.5, -3.75, 0, 3.75, 7.5] },
    { axis: 'z', cx: -0.5, cz: size / 2, L: size, out: -1, m: wallMatLong, wm: walkMatZ, pm: parMatLong, bt: [-7, -3.5, 0, 3.5, 7] },
    { axis: 'z', cx: size + 0.5, cz: size / 2, L: size, out: 1, m: wallMatLong, wm: walkMatZ, pm: parMatLong, bt: [-7, -3.5, 0, 3.5, 7] },
    { axis: 'x', cx: segLcx, cz: northZ, L: segW, out: -1, m: wallMatShort, wm: walkMatX, pm: parMatShort, bt: [-2.2, 2.2], pio: 0.5 },
    { axis: 'x', cx: segRcx, cz: northZ, L: segW, out: -1, m: wallMatShort, wm: walkMatX, pm: parMatShort, bt: [-2.2, 2.2], pio: -0.5 },
  ];
  for (const r of runs) {
    const ax = r.axis === 'x';
    const dim = (len, h, th) => (ax ? [len, h, th] : [th, h, len]);
    const at = (along, y, perp) => (ax ? [r.cx + along, y, r.cz + perp] : [r.cx + perp, y, r.cz + along]);
    const B = (len, h, th, along, y, perp, m) =>
      addBox(geo(new THREE.BoxGeometry(...dim(len, h, th))), m, ...at(along, y, perp));
    // plinth footing: ledge on the OUTSIDE only. The inner face tucks 0.06
    // INSIDE the wall (recessed, never flush — coplanar faces z-fight) so the
    // outer ring of grid tiles stays fully visible with no band at the base.
    B(ax ? r.L + 0.6 : r.L, PL, TH + 0.09, 0, PL / 2 - 0.06, 0.105 * r.out, plinthMat);
    B(r.L, H, TH, 0, H / 2 + 0.02, 0, r.m); // wall body
    // walkway floor strictly BETWEEN the parapets, never reaching the wall
    // faces -> no foreign stone band shows on the side of the wall
    B(ax ? r.L + 0.16 : r.L + 0.34, 0.12, 0.66, 0, H + 0.08, 0, r.wm);
    // matching crenellated parapets on BOTH walkway edges, flush with the wall
    // faces and seated directly on the wall body so the brick runs unbroken
    // from ground to teeth. The x-walls own the corner cells and the z-walls
    // end exactly against them, so the battlements TURN each corner instead
    // of running through one another.
    const gd = Math.sign(r.pio ?? 0); // which end faces the gatehouse (north runs)
    const rows = [
      { len: ax ? (r.cz === northZ ? r.L + 0.1 : r.L) : r.L + 1.6, off: gd * 0.05, side: 1 },
      { len: ax ? (r.cz === northZ ? r.L - 0.7 : r.L - 1.6) : r.L, off: gd * 0.45, side: -1 },
    ];
    for (const row of rows) {
      B(row.len, 0.26, 0.2, row.off, H + 0.15, row.side * 0.4 * r.out, r.pm); // parapet (brick)
      for (let a = row.off - row.len / 2 + 0.35; a <= row.off + row.len / 2 - 0.35; a += 1.0) {
        const [x, y, z] = at(a, H + 0.47, row.side * 0.37 * r.out);
        if (row.side > 0 && nearTower(x, z, 2.1)) continue;
        if (r.cz === northZ && Math.abs(x - size / 2) < 4.1) continue; // gatehouse zone
        merlons.push({ x, y, z, ry: ax ? 0 : Math.PI / 2, color: tint(0xffffff, 0.05) });
      }
    }
    for (const a of r.bt) {
      const ry = ax ? 0 : Math.PI / 2;
      let p = at(a, 0.44, (TH / 2 + 0.19) * r.out);
      btLow.push({ x: p[0], y: p[1], z: p[2], ry });
      p = at(a, H - 0.41, (TH / 2 + 0.14) * r.out);
      btUp.push({ x: p[0], y: p[1], z: p[2], ry });
      p = at(a, H - 0.01, (TH / 2 + 0.02) * r.out);
      btCap.push({ x: p[0], y: p[1], z: p[2], ry });
    }
  }

  // --- corner towers: tapered drums, corbelled crowns, teal cone roofs ------
  function buildTower(cx, cz, pi) {
    // plinth is a touch taller than the walls' so the two tops never share a
    // plane where they overlap (that causes z-fighting)
    addBox(geo(new THREE.CylinderGeometry(1.6, 1.8, PL + 0.06, 10)), plinthMat, cx, PL / 2 - 0.03, cz);
    addBox(geo(new THREE.CylinderGeometry(1.2, 1.52, 2.9, 10)), towerMat, cx, 1.94, cz); // body -> 3.39
    addBox(geo(new THREE.CylinderGeometry(1.56, 1.22, 0.45, 10)), corbelMat, cx, 3.61, cz); // corbel flare
    addBox(geo(new THREE.CylinderGeometry(1.5, 1.56, 0.62, 10)), towerMat, cx, 4.15, cz); // crown drum
    addBox(geo(new THREE.ConeGeometry(1.8, 2.1, 10)), roofConeMat, cx, 5.51, cz); // overhanging roof
    addBox(finialGeo, finialMat, cx, 6.64, cz).castShadow = false;
    addBox(geo(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6)), darkMat, cx, 7.0, cz).castShadow = false;
    buildPennant(cx, 7.26, cz, bcol(pi));
    // lit window in the crown, facing the courtyard
    const a = Math.atan2(size / 2 - cz, size / 2 - cx);
    windows.push({ x: cx + Math.cos(a) * 1.51, y: 4.15, z: cz + Math.sin(a) * 1.51, ry: Math.PI / 2 - a });
    sills.push({ x: cx + Math.cos(a) * 1.53, y: 3.92, z: cz + Math.sin(a) * 1.53, ry: Math.PI / 2 - a });
  }
  buildTower(-1.4, -1.4, 0);
  buildTower(size + 1.4, -1.4, 1);
  buildTower(-1.4, size + 1.4, 2);
  buildTower(size + 1.4, size + 1.4, 0);

  // --- twin-towered gatehouse around the north gate --------------------------
  {
    const cxg = size / 2;
    // the whole gatehouse sits NORTH of the grid line (z <= 0) so it never
    // covers the outer ring of grid tiles
    const tz = northZ - 0.5;
    for (const s of [-1, 1]) {
      const x = cxg + s * (GAP + 0.85);
      addBox(geo(new THREE.BoxGeometry(2.0, PL + 0.06, 1.92)), gatePlinthMat, x, PL / 2 - 0.03, tz - 0.04);
      addBox(geo(new THREE.BoxGeometry(1.7, 2.55, 1.7)), gateTowerMat, x, 1.765, tz); // body -> 3.04
      addBox(geo(new THREE.BoxGeometry(2.06, 0.3, 2.06)), stoneMat, x, 3.19, tz); // corbel band
      addBox(geo(new THREE.ConeGeometry(1.52, 1.5, 4)), roofPyrMat, x, 4.09, tz).rotation.y = Math.PI / 4;
      addBox(finialGeo, finialMat, x, 4.92, tz).castShadow = false;
      windows.push({ x, y: 2.3, z: tz + 0.88, ry: 0 }); // lit window toward the courtyard
      sills.push({ x, y: 2.05, z: tz + 0.9, ry: 0 });
    }
    // bridge chamber over the doorway (each face on its own plane — no two
    // pieces share one, that flickers)
    addBox(geo(new THREE.BoxGeometry(2 * GAP + 1.4, 1.3, 1.15)), bridgeMat, cxg, 2.1, northZ - 0.14);
    addBox(geo(new THREE.BoxGeometry(2 * GAP + 1.5, 0.12, 1.1)), walkMatX, cxg, 2.81, northZ - 0.125); // walk floor between the parapets
    const bridgeParMat = mat({ map: brickFit(4.6, 0.22), roughness: 0.95 });
    for (const bz of [northZ - 0.45, northZ + 0.37]) {
      addBox(geo(new THREE.BoxGeometry(2 * GAP + 1.4, 0.28, 0.18)), bridgeParMat, cxg, 2.89, bz); // parapets
      for (let a = -2.1; a <= 2.1; a += 0.84) {
        merlons.push({ x: cxg + a, y: 3.22, z: bz, ry: 0, color: tint(0xffffff, 0.05) });
      }
    }
    // doorway: one brick panel with the arch cut out of it — full-height side
    // legs down to the ground and curved spandrels above, no separate trim
    const SPRING = 0.5; // arch springing height — low, so the curve is tall and round
    const archShape = new THREE.Shape();
    archShape.moveTo(-GAP - 0.45, doorH + 0.12);
    archShape.lineTo(-GAP - 0.45, -0.05);
    archShape.lineTo(-GAP, -0.05);
    archShape.lineTo(-GAP, SPRING);
    archShape.absellipse(0, SPRING, GAP, doorH - SPRING, Math.PI, 0, true);
    archShape.lineTo(GAP, -0.05);
    archShape.lineTo(GAP + 0.45, -0.05);
    archShape.lineTo(GAP + 0.45, doorH + 0.12);
    archShape.closePath();
    const archMesh = new THREE.Mesh(
      geo(new THREE.ExtrudeGeometry(archShape, { depth: 1.01, bevelEnabled: false })),
      mat({ map: brickFit(0.78, 0.8), roughness: 0.95 })
    );
    archMesh.position.set(cxg, 0, northZ - 0.55);
    archMesh.castShadow = archMesh.receiveShadow = true;
    group.add(archMesh);
    // two BIG wooden doors flung open toward the outside, flanking the path
    const leafGeo = geo(new THREE.BoxGeometry(2.3, 1.42, 0.14));
    const bandGeo = geo(new THREE.BoxGeometry(2.3, 0.12, 0.18));
    const doorMat = mat({ color: 0x6b4a2c, roughness: 0.85 });
    const ironMat = mat({ color: 0x33302b, roughness: 0.6, metalness: 0.4 });
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(cxg + s * GAP, 0.02, northZ - 0.4);
      hinge.rotation.y = s < 0 ? Math.PI - 1.0 : 1.0; // ~120° open, sticking out beside the path
      const leaf = new THREE.Mesh(leafGeo, doorMat);
      leaf.position.set(1.15, 0.73, 0);
      leaf.castShadow = leaf.receiveShadow = true;
      hinge.add(leaf);
      for (const by of [0.4, 1.06]) {
        const band = new THREE.Mesh(bandGeo, ironMat);
        band.position.set(1.15, by, 0.0);
        hinge.add(band);
      }
      group.add(hinge);
    }
    // the banner of the keep, hung over the arch facing the courtyard
    buildBanner(cxg, 2.66, northZ + 0.48, 0, bcol(0));
  }

  // --- torches on the inner faces (unchanged — these were the keepers) -------
  const flameGeo = geo(new THREE.ConeGeometry(0.12, 0.34, 7));
  const flameMat = mat({ color: 0xffce86, emissive: 0xff9a3c, emissiveIntensity: 1.5 });
  const bracketGeo = geo(new THREE.BoxGeometry(0.12, 0.16, 0.18));
  const bracketMat = mat({ color: 0x2a2420, roughness: 0.7, metalness: 0.3 });
  const buildTorch = (x, y, z) => {
    addBox(bracketGeo, bracketMat, x, y, z).castShadow = false;
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x, y + 0.26, z);
    flame.renderOrder = 4;
    group.add(flame);
    animated.torches.push({ flame, light: null, phase: rng() * 6.28 });
  };
  const torchY = 1.0;
  // side walls: evenly spaced and symmetric about the wall centre (z=10),
  // with the flags sitting exactly mid-gap (z=5 and z=15)
  for (const t of [2.5, 7.5, 12.5, 17.5]) {
    buildTorch(0.12, torchY, t);
    buildTorch(size - 0.12, torchY, t);
  }
  // north wall: centred on the visible stretch between corner tower and gatehouse
  buildTorch(2.5, torchY, 0.12);
  buildTorch(size - 2.5, torchY, 0.12);
  // a pair greeting you at the gatehouse, on the wall face beside the opening
  buildTorch(size / 2 - GAP - 1.1, torchY, 0.12);
  buildTorch(size / 2 + GAP + 1.1, torchY, 0.12);

  // --- wall banners between the torches, then the shared detail instancing ---
  // same colors at the same position on both walls, so left/right match
  buildBanner(0.07, 1.26, 5, Math.PI / 2, bcol(1), 0.85);
  buildBanner(0.07, 1.26, 15, Math.PI / 2, bcol(2), 0.85);
  buildBanner(size - 0.07, 1.26, 5, -Math.PI / 2, bcol(1), 0.85);
  buildBanner(size - 0.07, 1.26, 15, -Math.PI / 2, bcol(2), 0.85);

  instanced(geo(new THREE.BoxGeometry(0.5, 0.38, 0.26)), merlonMat, merlons);
  instanced(geo(new THREE.BoxGeometry(0.64, 1.0, 0.5)), stoneMat, btLow);
  instanced(geo(new THREE.BoxGeometry(0.5, 0.7, 0.4)), stoneMat, btUp);
  instanced(geo(new THREE.BoxGeometry(0.74, 0.14, 0.5)), stoneMat, btCap);
  instanced(geo(new THREE.BoxGeometry(0.26, 0.4, 0.09)), winMat, windows, { cast: false });
  instanced(geo(new THREE.BoxGeometry(0.36, 0.07, 0.14)), stoneMat, sills, { cast: false });

  // ------------------------------------------------------------ room gates
  const postGeo = geo(new THREE.BoxGeometry(0.26, 1.55, 0.26));
  const lintelGeo = geo(new THREE.BoxGeometry(0.98, 0.15, 0.3));
  const orbGeo = geo(new THREE.SphereGeometry(0.07, 8, 8));
  const energyGeo = geo(new THREE.PlaneGeometry(0.72, 1.3));
  const postMat = mat({ map: T.wall, roughness: 0.9 });
  for (const gate of gates) {
    const g = new THREE.Group();
    const color = gate.locked ? PALETTE.gateRed : PALETTE.gateGreen;
    const glow = mat({ color, emissive: color, emissiveIntensity: 1.9 });
    for (const px of [-0.37, 0.37]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(px, 0.78, 0);
      p.castShadow = p.receiveShadow = true;
      g.add(p);
      const orb = new THREE.Mesh(orbGeo, glow);
      orb.position.set(px, 1.62, 0);
      g.add(orb);
    }
    const lintel = new THREE.Mesh(lintelGeo, glow);
    lintel.position.set(0, 1.56, 0);
    g.add(lintel);
    if (gate.locked) {
      const energy = mat({
        color,
        emissive: color,
        emissiveIntensity: 1.4,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const plane = new THREE.Mesh(energyGeo, energy);
      plane.position.set(0, 0.78, 0);
      g.add(plane);
      animated.energyMats.push({ mat: energy, phase: rng() * Math.PI * 2 });
    }
    g.position.set(gate.x + 0.5, 0.02, gate.z + 0.5);
    if (gate.axis === 'z') g.rotation.y = Math.PI / 2;
    group.add(g);
  }

  // ------------------------------------------------------------ crystals
  const shardGeo = geo(new THREE.IcosahedronGeometry(0.5, 0));
  const byColor = new Map();
  for (const c of crystals) {
    if (!byColor.has(c.color)) byColor.set(c.color, []);
    const shards = byColor.get(c.color);
    const cx = c.x + 0.5, cz = c.z + 0.5;
    const n = 4 + ((rng() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const main = i === 0;
      const sy = main ? 1.25 + rng() * 0.6 : 0.55 + rng() * 0.6;
      const sxz = main ? 0.52 + rng() * 0.18 : 0.26 + rng() * 0.18;
      const ang = rng() * Math.PI * 2;
      const d = main ? 0 : 0.2 + rng() * 0.22;
      shards.push({
        x: cx + Math.cos(ang) * d,
        y: 0.16 + sy * 0.3,
        z: cz + Math.sin(ang) * d,
        rx: (rng() - 0.5) * 0.45,
        ry: rng() * Math.PI,
        rz: (rng() - 0.5) * 0.45,
        sx: sxz,
        sy,
        sz: sxz,
      });
    }
  }
  for (const [color, shards] of byColor) {
    const m = mat({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.18,
      metalness: 0.05,
      flatShading: true,
    });
    instanced(shardGeo, m, shards);
    animated.crystalMats.push({ mat: m, phase: rng() * Math.PI * 2 });
  }

  // ------------------------------------------------------------ star decals
  const decalGeo = geo(new THREE.PlaneGeometry(0.78, 0.78));
  const decalMat = track(
    new THREE.MeshBasicMaterial({ map: T.decal, transparent: true, depthWrite: false, opacity: 0.95 })
  );
  instanced(
    decalGeo,
    decalMat,
    decals.map((d) => ({
      x: d.x + 0.5,
      y: TILE_H + 0.035,
      z: d.z + 0.5,
      rx: -Math.PI / 2,
      rz: rng() * Math.PI * 2,
    })),
    { cast: false, receive: false }
  );

  // ------------------------------------------------------------ outside nature
  // Everything in this block runs off the FIXED nature seed (see nrng above),
  // so the trees/rocks/bushes/fog look identical on every regeneration.
  {
  const rng = nrng;
  const tint = (hex, jitter = 0.04) =>
    new THREE.Color(hex).offsetHSL(0, 0, (rng() - 0.5) * jitter * 2);
  const GY = -0.06; // outside ground level

  // Deform a primitive into an organic shape. Critically the displacement is a
  // function of the *original vertex position*, so the duplicated vertices that
  // a non-indexed icosahedron shares all move identically — no tearing/spikes.
  const hash3 = (x, y, z) => {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };
  function deform(g, amp, squashY = 1) {
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const f = 1 + (hash3(v.x, v.y, v.z) - 0.5) * amp;
      pos.setXYZ(i, v.x * f, v.y * f * squashY, v.z * f);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }

  const rockGeo = deform(geo(new THREE.IcosahedronGeometry(1, 1)), 0.55, 0.82); // faceted boulder
  const canopyGeo = deform(geo(new THREE.IcosahedronGeometry(1, 1)), 0.22); // faceted low-poly crown
  const bushGeo = deform(geo(new THREE.IcosahedronGeometry(1, 1)), 0.5); // chunky leafy bush
  const trunkGeo = geo(new THREE.CylinderGeometry(0.12, 0.2, 1, 6, 1));
  const pineGeo = geo(new THREE.ConeGeometry(1, 1, 7));
  const logGeo = geo(new THREE.CylinderGeometry(0.2, 0.24, 1.6, 8));
  const mushStemGeo = geo(new THREE.CylinderGeometry(0.05, 0.08, 0.22, 6));
  const mushCapGeo = geo(new THREE.SphereGeometry(0.16, 9, 6));

  const greens = [0x4f7a34, 0x5d8a3c, 0x6f9a44, 0x42692c, 0x77a050];
  const pickGreen = () =>
    new THREE.Color(greens[(rng() * greens.length) | 0]).offsetHSL(
      (rng() - 0.5) * 0.04,
      (rng() - 0.5) * 0.08,
      (rng() - 0.5) * 0.08
    );

  const trunks = [], canopies = [], pines = [], rocks = [], shrubs = [];
  const logs = [], mushStems = [], mushCaps = [];

  // --- placement that is guaranteed OUTSIDE the walls, with spacing ---------
  const cx0 = size / 2, cz0 = size / 2;
  const WALL = size / 2 + 1; // outer wall distance from centre along an axis
  const placed = []; // footprints of big objects {x,z,r}
  const treeAnchors = []; // tree bases, used to clump nearby props
  const lakes = []; // {x, z, r} — defined just below, props avoid them
  const clearings = []; // {x, z, r} — keep-clear spots (e.g. the shrine)
  const outsideBy = (x, z, m) => Math.abs(x - cx0) >= WALL + m || Math.abs(z - cz0) >= WALL + m;
  const inAny = (list, x, z, pad) =>
    list.some((L) => {
      const dx = x - L.x, dz = z - L.z;
      return dx * dx + dz * dz < (L.r + pad) * (L.r + pad);
    });
  const onLake = (x, z, pad = 0) => inAny(lakes, x, z, pad);
  const blocked = (x, z, pad = 0) => inAny(lakes, x, z, pad) || inAny(clearings, x, z, pad);
  const noOverlap = (x, z, r) => {
    for (const p of placed) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < (r + p.r) * (r + p.r)) return false;
    }
    return true;
  };
  // a random point in the band outside a wall (perpendicular offset always clears)
  const bandPoint = (minClear, maxClear, bias = 1) => {
    const side = (rng() * 4) | 0;
    const off = WALL + minClear + Math.pow(rng(), bias) * (maxClear - minClear);
    const along = cx0 + (rng() - 0.5) * (size + 2 * maxClear);
    if (side === 0) return [along, cz0 - off];
    if (side === 1) return [along, cz0 + off];
    if (side === 2) return [cx0 - off, along];
    return [cx0 + off, along];
  };
  // spaced placement for big objects, clumping near existing trees when possible
  const freeSpot = (r, minClear, maxClear, clumpProb = 0, clearM = 2) => {
    for (let t = 0; t < 32; t++) {
      let x, z;
      if (clumpProb && treeAnchors.length && rng() < clumpProb) {
        const a = treeAnchors[(rng() * treeAnchors.length) | 0];
        const ang = rng() * 6.28, dd = 2.2 + rng() * 2.8;
        x = a[0] + Math.cos(ang) * dd;
        z = a[1] + Math.sin(ang) * dd;
        if (!outsideBy(x, z, clearM)) continue;
      } else {
        [x, z] = bandPoint(minClear, maxClear, 1.5);
      }
      if (blocked(x, z, 1.2)) continue;
      if (noOverlap(x, z, r)) {
        placed.push({ x, z, r });
        return [x, z];
      }
    }
    return null;
  };
  // light placement for ground cover (may overlap, but stays outside)
  const coverSpot = (minClear, maxClear, clumpProb = 0.5, spread = 2.2, clearM = 0.9) => {
    for (let t = 0; t < 8; t++) {
      let x, z;
      if (clumpProb && treeAnchors.length && rng() < clumpProb) {
        const a = treeAnchors[(rng() * treeAnchors.length) | 0];
        const ang = rng() * 6.28, dd = 0.6 + rng() * spread;
        x = a[0] + Math.cos(ang) * dd;
        z = a[1] + Math.sin(ang) * dd;
        if (!outsideBy(x, z, clearM)) continue;
      } else {
        [x, z] = bandPoint(minClear, maxClear, 1.2);
      }
      if (!blocked(x, z, 0.4)) return [x, z];
    }
    return bandPoint(maxClear * 0.6, maxClear, 1);
  };

  // ---- pond (one, NW corner so it stays in view), shore, foam, reeds, ducks -
  lakes.push({ x: cx0 - 16, z: cz0 - 16, r: 4.4 }); // north-west corner pond

  // ---- keep ALL nature clear of the towers, which project past the walls ----
  for (const [tx, tz] of [
    [-1.4, -1.4], [size + 1.4, -1.4], [-1.4, size + 1.4], [size + 1.4, size + 1.4], // corner towers
    [size / 2 - GAP - 0.85, northZ - 0.5], [size / 2 + GAP + 0.85, northZ - 0.5], // gatehouse towers
  ]) {
    placed.push({ x: tx, z: tz, r: 2.4 });
    clearings.push({ x: tx, z: tz, r: 2.6 });
  }
  function makeDuck() {
    const g = new THREE.Group();
    const cream = mat({ color: 0xf2ede2, roughness: 0.7 });
    const body = new THREE.Mesh(geo(new THREE.SphereGeometry(0.16, 10, 8)), cream);
    body.scale.set(1.3, 0.8, 1);
    body.castShadow = true;
    const head = new THREE.Mesh(geo(new THREE.SphereGeometry(0.1, 10, 8)), cream);
    head.position.set(0.18, 0.14, 0);
    const beak = new THREE.Mesh(geo(new THREE.ConeGeometry(0.04, 0.1, 6)), mat({ color: 0xe0a23a, roughness: 0.6 }));
    beak.position.set(0.27, 0.12, 0);
    beak.rotation.z = -Math.PI / 2;
    const tail = new THREE.Mesh(geo(new THREE.ConeGeometry(0.07, 0.16, 6)), cream);
    tail.position.set(-0.19, 0.06, 0);
    tail.rotation.z = Math.PI / 2.2;
    g.add(body, head, beak, tail);
    return g;
  }
  for (const L of lakes) {
    const waterTex = track(T.water.clone());
    waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
    waterTex.repeat.set(L.r / 4, L.r / 4);
    const waterMat = mat({
      color: 0x6fb0cf, map: waterTex, transparent: true, opacity: 0.8,
      roughness: 0.25, metalness: 0, emissive: 0x255b7a, emissiveIntensity: 0.12,
    });
    // organic (non-circular) pond outline so it doesn't read as a hard ring
    const waterGeo = geo(new THREE.CircleGeometry(L.r, 56));
    {
      const pos = waterGeo.attributes.position;
      for (let i = 1; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const ang = Math.atan2(y, x);
        const wob = 1 + 0.09 * Math.sin(ang * 3 + 1.3) + 0.05 * Math.sin(ang * 5 - 0.5);
        pos.setXY(i, x * wob, y * wob);
      }
    }
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(L.x, GY + 0.04, L.z);
    water.renderOrder = 2;
    group.add(water);
    animated.water.push({ tex: waterTex, mat: waterMat });
    // leafy plants just past the wavy waterline, + rim rocks (all spaced)
    for (let i = 0, n = Math.floor(L.r * 5); i < n; i++) {
      const a = rng() * 6.28, rr = L.r + 0.7 + rng() * 0.9;
      const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      const s = 0.3 + rng() * 0.45;
      const r = s * 0.95 + 0.12;
      if (!noOverlap(x, z, r)) continue;
      placed.push({ x, z, r });
      shrubs.push({ x, y: GY + s * 0.42, z, sx: s, sy: s * (0.8 + rng() * 0.4), sz: s, ry: rng() * 6.28, color: pickGreen() });
    }
    for (let i = 0, n = 6 + ((rng() * 4) | 0); i < n; i++) {
      const a = rng() * 6.28, rr = L.r + 0.8 + rng() * 0.8, rs = 0.4 + rng() * 0.8;
      const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      const r = rs * 0.9 + 0.15;
      if (!noOverlap(x, z, r)) continue;
      placed.push({ x, z, r });
      rocks.push({ x, y: GY + rs * 0.3 - 0.06, z, s: rs, sy: rs * (0.6 + rng() * 0.4), rx: (rng() - 0.5) * 0.4, ry: rng() * 6.28, rz: (rng() - 0.5) * 0.4, color: tint(0x887b6e, 0.08) });
    }
    // ducks gliding around naturally (wander handled in the main loop)
    for (let i = 0, n = 2 + ((rng() * 2) | 0); i < n; i++) {
      const g = makeDuck();
      group.add(g);
      const px = L.x + (rng() - 0.5) * L.r, pz = L.z + (rng() - 0.5) * L.r;
      animated.ducks.push({
        group: g, cx: L.x, cz: L.z, roam: L.r * 0.6,
        x: px, z: pz, heading: rng() * 6.28, weave: rng() * 6.28,
        speed: 0.28 + rng() * 0.18, baseY: GY + 0.07, bob: rng() * 6.28,
      });
    }
  }

  // ---- cobbled path from the open gatehouse out into the woods --------------
  {
    const px = size / 2; // the gate sits at the north-wall centre
    for (let z = -1.5; z >= -14.5; z -= 2) clearings.push({ x: px, z, r: 3.2 });
    const pathTex = track(T.path.clone());
    pathTex.repeat.set(1.84, 5.6);
    // runs from under the courtyard floor (no grass gap in the gate passage)
    // out to the treeline, matching the gate opening's width
    const p = new THREE.Mesh(geo(new THREE.PlaneGeometry(4.6, 14.1)), mat({ map: pathTex, roughness: 1 }));
    p.rotation.x = -Math.PI / 2;
    p.position.set(px, GY + 0.035, -6.95);
    p.receiveShadow = true;
    group.add(p);
  }

  // ---- a mystical standing-stone shrine where the east lake used to be ------
  {
    const sx = cx0 + 17, sz = cz0 - 3, ring = 3.4;
    const stoneMat = mat({ color: 0x9a9088, roughness: 1, flatShading: true });
    const stoneGeo = geo(new THREE.BoxGeometry(0.7, 2.6, 0.5));
    const capGeo = geo(new THREE.BoxGeometry(1.4, 0.45, 0.7));
    placed.push({ x: sx, z: sz, r: ring + 1.5 }); // keep trees out of the shrine
    clearings.push({ x: sx, z: sz, r: ring + 0.6 }); // and ground cover too
    const nStones = 6;
    for (let i = 0; i < nStones; i++) {
      const a = (i / nStones) * Math.PI * 2 + 0.2;
      const fallen = rng() < 0.25;
      const px = sx + Math.cos(a) * ring, pz = sz + Math.sin(a) * ring;
      const h = 2.1 + rng() * 0.9;
      const m = new THREE.Mesh(stoneGeo, stoneMat);
      m.position.set(px, GY + (fallen ? 0.25 : h * 0.5), pz);
      m.scale.set(0.8 + rng() * 0.5, (fallen ? 0.9 : h / 2.6), 0.8 + rng() * 0.4);
      m.rotation.y = a + (rng() - 0.5) * 0.4;
      if (fallen) m.rotation.z = Math.PI / 2 * (rng() < 0.5 ? 1 : -1) * (0.8 + rng() * 0.2);
      else m.rotation.z = (rng() - 0.5) * 0.12;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      // a lintel across a couple of the upright pairs
      if (!fallen && i % 2 === 0 && rng() < 0.7) {
        const cap = new THREE.Mesh(capGeo, stoneMat);
        cap.position.set(px, GY + h + 0.2, pz);
        cap.rotation.y = a;
        cap.castShadow = true;
        group.add(cap);
      }
    }
    // the centrepiece: a hero's sword driven into a low boulder (sword in the stone)
    const boulder = new THREE.Mesh(rockGeo, mat({ color: 0x8c8278, roughness: 1, flatShading: true }));
    boulder.position.set(sx, GY + 0.18, sz);
    boulder.scale.set(1.6, 0.62, 1.6);
    boulder.rotation.y = 0.6;
    boulder.castShadow = boulder.receiveShadow = true;
    group.add(boulder);

    const rockTopY = GY + 0.4; // sword sits a little deeper in the stone
    const steel = mat({ color: 0xd6dee4, roughness: 0.3, metalness: 0.55, flatShading: true });
    const gold = mat({ color: 0xd9b24a, roughness: 0.4, metalness: 0.5 });
    const grip = mat({ color: 0x5a3d2b, roughness: 0.85 });
    const sword = new THREE.Group();
    sword.position.set(sx, rockTopY, sz);
    sword.rotation.z = 0.05; // a slight dramatic tilt
    const addSword = (g, m, y) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = y;
      mesh.castShadow = true;
      sword.add(mesh);
    };
    addSword(geo(new THREE.BoxGeometry(0.14, 1.4, 0.05)), steel, 0.2); // blade (lower half sunk in rock)
    addSword(geo(new THREE.BoxGeometry(0.5, 0.1, 0.13)), gold, 0.95); // crossguard
    addSword(geo(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 8)), grip, 1.12); // grip
    addSword(geo(new THREE.SphereGeometry(0.08, 12, 10)), gold, 1.3); // pommel
    group.add(sword);
    // a soft glint at the hilt
    const hilt = new THREE.PointLight(0xffe6a8, 0.9, 4, 2);
    hilt.position.set(sx, rockTopY + 1.4, sz);
    group.add(hilt);
    // a sparse ring of moss tufts just OUTSIDE the stones, framing not burying
    // (spaced against each other only — the shrine's own keep-out zone would
    // otherwise reject them all)
    const mossLocal = [];
    for (let i = 0; i < 14; i++) {
      const a = rng() * 6.28, rr = ring + 0.6 + rng() * 1.6;
      const x = sx + Math.cos(a) * rr, z = sz + Math.sin(a) * rr;
      const s = 0.3 + rng() * 0.4;
      const r = s * 0.95 + 0.12;
      if (mossLocal.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < (r + p.r) ** 2)) continue;
      mossLocal.push({ x, z, r });
      placed.push({ x, z, r });
      shrubs.push({ x, y: GY + s * 0.42, z, sx: s, sy: s * 0.8, sz: s, ry: rng() * 6.28, color: pickGreen() });
    }
  }

  function addDeciduous(x, z, scale) {
    treeAnchors.push([x, z]);
    const h = (1.05 + rng() * 0.7) * scale;
    trunks.push({ x, y: GY + h * 0.5, z, sx: scale, sy: h, sz: scale, ry: rng() * 6.28, color: tint(0x6f4d34, 0.08) });
    const top = GY + h;
    const r = (0.72 + rng() * 0.3) * scale;
    const col = pickGreen();
    // one clean faceted crown ball, slightly squashed, sitting on the trunk
    canopies.push({
      x, y: top + r * 0.62, z,
      sx: r, sy: r * (0.82 + rng() * 0.16), sz: r,
      ry: rng() * 6.28, color: col,
    });
    // a smaller blob tucked into the lower side for an organic silhouette
    // (kept BELOW the crown centre so nothing pokes out of the top)
    const ang = rng() * 6.28, r2 = r * 0.6;
    canopies.push({
      x: x + Math.cos(ang) * r * 0.5,
      y: top + r * 0.32,
      z: z + Math.sin(ang) * r * 0.5,
      sx: r2, sy: r2 * 0.85, sz: r2,
      ry: rng() * 6.28, color: col.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.06),
    });
  }
  function addPine(x, z, scale) {
    treeAnchors.push([x, z]);
    const h = (1.2 + rng() * 0.9) * scale;
    trunks.push({ x, y: GY + h * 0.3, z, sx: scale * 0.8, sy: h * 0.6, sz: scale * 0.8, color: tint(0x5e4430, 0.08) });
    const col = pickGreen();
    let y = GY + h * 0.42;
    for (let tIdx = 0; tIdx < 3; tIdx++) {
      const r = (0.95 - tIdx * 0.22) * scale;
      const th = (1.05 - tIdx * 0.12) * scale;
      pines.push({ x, y: y + th * 0.5, z, sx: r, sy: th, sz: r, ry: rng() * 6.28, color: col.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.05) });
      y += th * 0.6;
    }
  }

  // trees first, so everything else can clump around them.
  // footprint ~ canopy radius so no two trees' crowns overlap/touch.
  for (let i = 0; i < 88; i++) {
    const scale = 0.8 + rng() * 0.95;
    const spot = freeSpot(1.0 * scale + 0.35, 2.8, 18, 0.45, 2.8);
    if (!spot) continue;
    if (rng() < 0.5) addPine(spot[0], spot[1], scale);
    else addDeciduous(spot[0], spot[1], scale);
  }
  // a modest top-up on the west, which the random spread happened to leave thin
  for (let i = 0; i < 14; i++) {
    const clear = 2.8 + Math.pow(rng(), 1.4) * 13;
    const x = cx0 - (WALL + clear), z = cz0 + (rng() - 0.5) * (size + 10);
    const scale = 0.8 + rng() * 0.9;
    const r = 1.0 * scale + 0.35;
    if (blocked(x, z, 1.2) || !noOverlap(x, z, r)) continue;
    placed.push({ x, z, r });
    if (rng() < 0.5) addPine(x, z, scale);
    else addDeciduous(x, z, scale);
  }
  for (let i = 0; i < 40; i++) {
    const clear = 1.8 + rng() * 13;
    const x = cx0 - (WALL + clear), z = cz0 + (rng() - 0.5) * (size + 10);
    const s = 0.28 + rng() * 0.5;
    const r = s * 0.95 + 0.12;
    if (blocked(x, z, 0.4) || !noOverlap(x, z, r)) continue;
    placed.push({ x, z, r });
    shrubs.push({ x, y: GY + s * 0.42, z, sx: s, sy: s * (0.7 + rng() * 0.3), sz: s, ry: rng() * 6.28, color: pickGreen() });
  }
  // rocks, often near groves
  for (let i = 0; i < 62; i++) {
    const rs = 0.45 + rng() * 1.8;
    const spot = freeSpot(rs * 0.9 + 0.15, rs + 1.2, 18, 0.4, 2.6);
    if (!spot) continue;
    rocks.push({
      x: spot[0], y: GY + rs * 0.3 - 0.06, z: spot[1],
      s: rs, sy: rs * (0.6 + rng() * 0.5),
      rx: (rng() - 0.5) * 0.5, ry: rng() * 6.28, rz: (rng() - 0.5) * 0.5,
      color: tint(0x887b6e, 0.08),
    });
  }
  // a few fallen logs
  for (let i = 0; i < 6; i++) {
    const spot = freeSpot(1.2, 2.4, 16, 0.35, 2.2);
    if (!spot) continue;
    logs.push({ x: spot[0], y: GY + 0.2, z: spot[1], rx: Math.PI / 2, ry: rng() * 6.28, color: tint(0x6b4a33, 0.08) });
  }
  // bushes / shrubs as ground cover — spaced like everything else (no touching)
  for (let i = 0; i < 380; i++) {
    const s = 0.28 + rng() * 0.55;
    const spot = freeSpot(s * 0.95 + 0.12, 1.8, 16, 0.5, 1.8);
    if (!spot) continue;
    shrubs.push({ x: spot[0], y: GY + s * 0.42, z: spot[1], sx: s, sy: s * (0.7 + rng() * 0.3), sz: s, ry: rng() * 6.28, color: pickGreen() });
  }
  // little mushroom clusters — the cluster is spaced, mushrooms within it sit together
  for (let c = 0; c < 24; c++) {
    const center = freeSpot(0.7, 1.4, 14, 0.6, 1.4);
    if (!center) continue;
    const [bx, bz] = center;
    const n = 1 + ((rng() * 3) | 0);
    const capCol = rng() < 0.5 ? 0xcc4036 : 0xd98a3c;
    for (let k = 0; k < n; k++) {
      const x = bx + (rng() - 0.5) * 0.5, z = bz + (rng() - 0.5) * 0.5;
      const ms = 0.6 + rng() * 0.7;
      mushStems.push({ x, y: GY + 0.11 * ms, z, sx: ms, sy: ms, sz: ms, color: new THREE.Color(0xf0e7d6) });
      mushCaps.push({ x, y: GY + 0.22 * ms, z, sx: ms, sy: ms * 0.6, sz: ms, color: new THREE.Color(capCol) });
    }
  }

  instanced(trunkGeo, mat({ roughness: 0.95, flatShading: true }), trunks);
  instanced(canopyGeo, mat({ roughness: 0.85, flatShading: true }), canopies); // faceted crowns
  instanced(pineGeo, mat({ roughness: 0.85, flatShading: true }), pines);
  instanced(rockGeo, mat({ roughness: 1, flatShading: true }), rocks);
  instanced(bushGeo, mat({ roughness: 0.9, flatShading: true }), shrubs, { cast: false });
  instanced(logGeo, mat({ roughness: 0.95, flatShading: true }), logs);
  instanced(mushStemGeo, mat({ roughness: 0.9 }), mushStems, { cast: false });
  instanced(mushCapGeo, mat({ roughness: 0.7 }), mushCaps, { cast: false });

  // ------------------------------------------------------------ drifting fog
  // a ring of soft puffs strictly OUTSIDE the walls. The castle spans ~11
  // units from centre, so we guarantee each puff's inner edge stays past that
  // (centre radius >= 15 + its own radius), even after drifting.
  const cx = size / 2, cz = size / 2;
  const fogGeo = geo(new THREE.PlaneGeometry(1, 1));
  for (let i = 0; i < 40; i++) {
    const ang = rng() * Math.PI * 2;
    const discR = 4 + rng() * 5; // 4..9
    const range = 1.5 + rng() * 2.5;
    const cr = 15 + range + discR + rng() * 16; // inner edge stays >= 15 from centre
    const x = cx + Math.cos(ang) * cr;
    const z = cz + Math.sin(ang) * cr;
    const m = new THREE.Mesh(
      fogGeo,
      track(new THREE.MeshBasicMaterial({ map: T.fog, transparent: true, depthWrite: false, color: 0xd8d5ec }))
    );
    m.position.set(x, GY + 0.5 + rng() * 0.8, z);
    m.rotation.x = -Math.PI / 2 + (rng() - 0.5) * 0.25;
    m.rotation.z = rng() * 6.28;
    m.scale.set(discR * 2, discR * 2 * (0.7 + rng() * 0.4), 1);
    m.renderOrder = 5;
    group.add(m);
    animated.fog.push({
      mesh: m,
      baseX: x, baseZ: z,
      spd: 0.07 + rng() * 0.1,
      range,
      spin: (rng() - 0.5) * 0.04,
      phase: rng() * 6.28,
      baseOp: 0.07 + rng() * 0.09,
    });
  }
  } // end fixed-seed outside decoration

  function dispose() {
    for (const d of disposables) d.dispose?.();
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
  }

  return { group, animated, dispose };
}
