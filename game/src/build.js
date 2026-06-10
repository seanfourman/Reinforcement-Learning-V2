import * as THREE from 'three';
import { TILE_H, WALL_H, OUTER_WALL_H, PALETTE, BANNER_COLORS } from './config.js';

// Turns a generated world layout into meshes. Everything repeated is
// instanced so the whole scene stays at a few dozen draw calls.

const dummy = new THREE.Object3D();

export function buildWorld(world, T) {
  const group = new THREE.Group();
  const { size, wall, gates, crystals, decals, outerGate, rng } = world;
  const animated = { crystalMats: [], energyMats: [], lanternLights: [] };
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

  // ------------------------------------------------------------ ground
  const grout = new THREE.Mesh(
    geo(new THREE.PlaneGeometry(size, size)),
    mat({ map: T.ground, roughness: 1 })
  );
  grout.rotation.x = -Math.PI / 2;
  grout.position.set(size / 2, 0.015, size / 2);
  grout.receiveShadow = true;
  group.add(grout);

  const outsideTex = track(T.outsideGround.clone());
  outsideTex.repeat.set(14, 14);
  const outside = new THREE.Mesh(
    geo(new THREE.PlaneGeometry(size + 90, size + 90)),
    mat({ map: outsideTex, roughness: 1 })
  );
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(size / 2, -0.05, size / 2);
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
  const mossItems = [];
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
      if (rng() < 0.22) {
        mossItems.push({
          x: x + 0.2 + rng() * 0.6,
          y: WALL_H + 0.14,
          z: z + 0.2 + rng() * 0.6,
          sx: 0.1 + rng() * 0.12,
          sy: 0.06 + rng() * 0.07,
          sz: 0.1 + rng() * 0.12,
          color: new THREE.Color(PALETTE.moss).lerp(new THREE.Color(PALETTE.mossDark), rng()),
        });
      }
      if (rng() < 0.5) {
        mossItems.push({
          x: x + 0.1 + rng() * 0.8,
          y: 0.1,
          z: z + (rng() < 0.5 ? -0.02 : 1.02),
          sx: 0.1 + rng() * 0.15,
          sy: 0.07 + rng() * 0.08,
          sz: 0.08 + rng() * 0.1,
          color: new THREE.Color(PALETTE.moss).lerp(new THREE.Color(PALETTE.mossDark), rng()),
        });
      }
    }
  }
  instanced(wallGeo, wallMats, wallCells);
  instanced(capGeo, wallTopM, caps);

  // moss tufts poking through tile cracks
  for (let x = 1; x < size; x++) {
    for (let z = 1; z < size; z++) {
      if (rng() < 0.085) {
        mossItems.push({
          x: x + (rng() - 0.5) * 0.15,
          y: 0.07,
          z: z + (rng() - 0.5) * 0.15,
          sx: 0.09 + rng() * 0.14,
          sy: 0.05 + rng() * 0.07,
          sz: 0.09 + rng() * 0.14,
          color: new THREE.Color(PALETTE.moss).lerp(new THREE.Color(PALETTE.mossDark), rng()),
        });
      }
    }
  }
  const mossGeo = geo(new THREE.SphereGeometry(1, 6, 5));
  const mossMat = mat({ color: 0xffffff, roughness: 1 });
  instanced(mossGeo, mossMat, mossItems, { cast: false });

  // ------------------------------------------------------------ outer walls
  const H = OUTER_WALL_H;
  const outerTex = track(T.outerWall.clone());
  outerTex.repeat.set(5, 1.4);
  const outerMat = mat({ map: outerTex, roughness: 0.95 });
  const woodMat = mat({ color: PALETTE.wood, roughness: 0.9 });
  const wallNS = geo(new THREE.BoxGeometry(size + 2, H, 1));
  const wallWE = geo(new THREE.BoxGeometry(1, H, size));
  const beamNS = geo(new THREE.BoxGeometry(size + 2, 0.1, 0.28));
  const beamWE = geo(new THREE.BoxGeometry(0.28, 0.1, size));
  const addBox = (g, m, x, y, z) => {
    const b = new THREE.Mesh(g, m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    group.add(b);
    return b;
  };
  addBox(wallNS, outerMat, size / 2, H / 2, -0.5);
  addBox(wallNS, outerMat, size / 2, H / 2, size + 0.5);
  addBox(wallWE, outerMat, -0.5, H / 2, size / 2);
  addBox(wallWE, outerMat, size + 0.5, H / 2, size / 2);
  addBox(beamNS, woodMat, size / 2, H + 0.05, -0.16);
  addBox(beamNS, woodMat, size / 2, H + 0.05, size + 0.16);
  addBox(beamWE, woodMat, -0.16, H + 0.05, size / 2);
  addBox(beamWE, woodMat, size + 0.16, H + 0.05, size / 2);

  // crenellations
  const crenGeo = geo(new THREE.BoxGeometry(0.55, 0.45, 0.55));
  const crens = [];
  for (let t = -0.7; t <= size + 0.7; t += 1.15) {
    const c = () => tint(0xcfc2ba, 0.05);
    crens.push({ x: t, y: H + 0.22, z: -0.8, color: c() });
    crens.push({ x: t, y: H + 0.22, z: size + 0.8, color: c() });
    crens.push({ x: -0.8, y: H + 0.22, z: t, color: c() });
    crens.push({ x: size + 0.8, y: H + 0.22, z: t, color: c() });
  }
  instanced(crenGeo, mat({ map: T.wallTop, roughness: 0.95 }), crens);

  // ------------------------------------------------------------ towers
  const towerGeo = geo(new THREE.CylinderGeometry(1.05, 1.35, 3.6, 8));
  const roofGeo = geo(new THREE.ConeGeometry(1.6, 1.8, 8));
  const roofMat = mat({ map: T.roof, roughness: 0.8 });
  const finialMat = mat({ color: PALETTE.finial, emissive: PALETTE.finial, emissiveIntensity: 0.25, roughness: 0.4 });
  const finialGeo = geo(new THREE.SphereGeometry(0.14, 8, 8));
  const poleGeo = geo(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5));
  const flagGeo = geo(new THREE.PlaneGeometry(0.55, 0.3));
  const corners = [
    [-0.5, -0.5],
    [size + 0.5, -0.5],
    [-0.5, size + 0.5],
    [size + 0.5, size + 0.5],
  ];
  corners.forEach(([cx, cz], i) => {
    const t = addBox(towerGeo, outerMat, cx, 1.8, cz);
    t.rotation.y = rng();
    const roof = addBox(roofGeo, roofMat, cx, 3.6 + 0.9, cz);
    roof.rotation.y = rng();
    addBox(finialGeo, finialMat, cx, 3.6 + 1.85, cz).castShadow = false;
    addBox(poleGeo, woodMat, cx, 3.6 + 2.2, cz).castShadow = false;
    const flag = new THREE.Mesh(
      flagGeo,
      mat({ color: BANNER_COLORS[i % BANNER_COLORS.length], side: THREE.DoubleSide, roughness: 0.9 })
    );
    flag.position.set(cx + 0.3, 3.6 + 2.45, cz);
    group.add(flag);
  });

  // ------------------------------------------------------------ lanterns
  const cageGeo = geo(new THREE.BoxGeometry(0.17, 0.24, 0.17));
  const glowGeo = geo(new THREE.SphereGeometry(0.075, 8, 8));
  const cageMat = mat({ color: 0x2a2024, roughness: 0.6, metalness: 0.4 });
  const glowMat = mat({ color: PALETTE.lantern, emissive: PALETTE.lantern, emissiveIntensity: 1.7 });
  const lanternPos = [];
  for (const t of [2.5, 7.5, 12.5, 17.5]) {
    lanternPos.push([t, 0.16], [t, size - 0.16], [0.16, t], [size - 0.16, t]);
  }
  const cages = lanternPos.map(([x, z]) => ({ x, y: 1.65, z }));
  const glows = lanternPos.map(([x, z]) => ({ x, y: 1.63, z }));
  instanced(cageGeo, cageMat, cages, { cast: false });
  instanced(glowGeo, glowMat, glows, { cast: false, receive: false });
  // a few real lights for warm pools on the stone
  [[7.5, 0.3], [12.5, size - 0.3], [0.3, 12.5], [size - 0.3, 7.5]].forEach(([x, z], i) => {
    const l = new THREE.PointLight(0xffb070, 5, 7, 2);
    l.position.set(x, 1.7, z);
    group.add(l);
    animated.lanternLights.push({ light: l, phase: i * 1.7 });
  });

  // ------------------------------------------------------------ grand gate
  {
    const g = new THREE.Group();
    const postGeo = geo(new THREE.BoxGeometry(0.45, 2.7, 0.4));
    const post = (px) => {
      const p = new THREE.Mesh(postGeo, outerMat);
      p.position.set(px, 1.35, 0);
      p.castShadow = p.receiveShadow = true;
      g.add(p);
    };
    post(-1.05);
    post(1.05);
    const slab = new THREE.Mesh(geo(new THREE.BoxGeometry(1.7, 2.3, 0.14)), mat({ color: 0x18141f, roughness: 0.9 }));
    slab.position.set(0, 1.15, 0);
    g.add(slab);
    const greenMat = mat({ color: PALETTE.gateGreen, emissive: PALETTE.gateGreen, emissiveIntensity: 2.2 });
    const lintel = new THREE.Mesh(geo(new THREE.BoxGeometry(2.55, 0.3, 0.42)), greenMat);
    lintel.position.set(0, 2.62, 0);
    g.add(lintel);
    const barGeo = geo(new THREE.BoxGeometry(0.08, 2.1, 0.1));
    for (const bx of [-0.55, -0.18, 0.18, 0.55]) {
      const bar = new THREE.Mesh(barGeo, greenMat);
      bar.position.set(bx, 1.15, 0.06);
      g.add(bar);
    }
    const { side, along } = outerGate;
    const a = along + 0.5;
    if (side === 0) g.position.set(a, 0, 0.2);
    if (side === 1) (g.position.set(a, 0, size - 0.2), (g.rotation.y = Math.PI));
    if (side === 2) (g.position.set(0.2, 0, a), (g.rotation.y = Math.PI / 2));
    if (side === 3) (g.position.set(size - 0.2, 0, a), (g.rotation.y = -Math.PI / 2));
    group.add(g);
  }

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

  // ------------------------------------------------------------ banners
  const bannerGeo = geo(new THREE.PlaneGeometry(0.55, 1.15));
  const bannerMat = mat({ map: T.banner, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  const banners = [];
  const bcol = () => new THREE.Color(BANNER_COLORS[(rng() * BANNER_COLORS.length) | 0]);
  for (const t of [4.5, 10.5, 15.5]) {
    banners.push({ x: t, y: 1.45, z: 0.1, rx: 0.07, color: bcol() });
    banners.push({ x: t, y: 1.45, z: size - 0.1, ry: Math.PI, rx: 0.07, color: bcol() });
    banners.push({ x: 0.1, y: 1.45, z: t, ry: Math.PI / 2, rx: 0.07, color: bcol() });
    banners.push({ x: size - 0.1, y: 1.45, z: t, ry: -Math.PI / 2, rx: 0.07, color: bcol() });
  }
  instanced(bannerGeo, bannerMat, banners, { cast: false });

  // ------------------------------------------------------------ outside set dressing
  const rockGeo = geo(new THREE.IcosahedronGeometry(1, 1));
  {
    const pos = rockGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const s = 1 + (rng() - 0.5) * 0.55;
      pos.setXYZ(i, v.x * s, v.y * (1 + (rng() - 0.5) * 0.4), v.z * s);
    }
    rockGeo.computeVertexNormals();
  }
  const rocks = [];
  const bushes = [];
  const outsidePoint = () => {
    const side = (rng() * 4) | 0;
    const along = -6 + rng() * (size + 12);
    const dist = 2.6 + rng() * 6;
    if (side === 0) return [along, -1 - dist];
    if (side === 1) return [along, size + 1 + dist];
    if (side === 2) return [-1 - dist, along];
    return [size + 1 + dist, along];
  };
  for (let i = 0; i < 26; i++) {
    const [x, z] = outsidePoint();
    const s = 0.7 + rng() * 2.1;
    rocks.push({
      x, z,
      y: s * 0.35 - 0.25,
      s,
      sy: s * (0.7 + rng() * 0.5),
      ry: rng() * Math.PI * 2,
      color: tint(0x8d7f72, 0.07),
    });
  }
  for (let i = 0; i < 46; i++) {
    const [x, z] = outsidePoint();
    bushes.push({
      x, z,
      y: 0.1,
      sx: 0.35 + rng() * 0.6,
      sy: 0.22 + rng() * 0.35,
      sz: 0.35 + rng() * 0.6,
      color: new THREE.Color(0x4d7a39).offsetHSL((rng() - 0.5) * 0.06, 0, (rng() - 0.5) * 0.1),
    });
  }
  instanced(rockGeo, mat({ roughness: 1, flatShading: true }), rocks);
  instanced(mossGeo, mat({ roughness: 1 }), bushes, { cast: false });

  function dispose() {
    for (const d of disposables) d.dispose?.();
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
  }

  return { group, animated, dispose };
}
