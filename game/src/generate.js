import { GRID, CRYSTAL_COLORS } from './config.js';

// Placeholder random layout: a few walled rooms with door openings (some
// sealed by glowing gates), stray wall stubs, crystals scattered about.
// Real generation rules come later — this only has to look right.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateWorld(seed = (Math.random() * 1e9) | 0) {
  const rng = mulberry32(seed);
  const size = GRID;
  const wall = Array.from({ length: size }, () => new Array(size).fill(false));
  const inBounds = (x, z) => x >= 0 && z >= 0 && x < size && z < size;

  // ---- rooms -------------------------------------------------------------
  const rooms = [];
  const overlaps = (r) =>
    rooms.some(
      (o) => r.x < o.x + o.w + 1 && r.x + r.w + 1 > o.x && r.z < o.z + o.h + 1 && r.z + r.h + 1 > o.z
    );
  const wanted = 3 + ((rng() * 3) | 0);
  for (let tries = 0; tries < 80 && rooms.length < wanted; tries++) {
    const w = 4 + ((rng() * 5) | 0);
    const h = 4 + ((rng() * 5) | 0);
    const x = 1 + ((rng() * (size - w - 2)) | 0);
    const z = 1 + ((rng() * (size - h - 2)) | 0);
    const r = { x, z, w, h };
    if (!overlaps(r)) rooms.push(r);
  }

  for (const r of rooms) {
    for (let x = r.x; x < r.x + r.w; x++) {
      wall[x][r.z] = true;
      wall[x][r.z + r.h - 1] = true;
    }
    for (let z = r.z; z < r.z + r.h; z++) {
      wall[r.x][z] = true;
      wall[r.x + r.w - 1][z] = true;
    }
  }

  // ---- door openings, some gated ------------------------------------------
  const gates = [];
  for (const r of rooms) {
    const doors = 1 + (rng() < 0.5 ? 1 : 0);
    for (let d = 0; d < doors; d++) {
      const side = (rng() * 4) | 0; // 0 N, 1 S, 2 W, 3 E
      let x, z, axis;
      if (side < 2) {
        x = r.x + 1 + ((rng() * (r.w - 2)) | 0);
        z = side === 0 ? r.z : r.z + r.h - 1;
        axis = 'x'; // wall runs along x, passage along z
      } else {
        x = side === 2 ? r.x : r.x + r.w - 1;
        z = r.z + 1 + ((rng() * (r.h - 2)) | 0);
        axis = 'z';
      }
      if (!wall[x][z]) continue;
      wall[x][z] = false;
      if (rng() < 0.7) {
        gates.push({ x, z, axis, locked: rng() < 0.65 });
      }
    }
  }

  // ---- stray ruin wall stubs ----------------------------------------------
  const stubs = 2 + ((rng() * 3) | 0);
  for (let s = 0; s < stubs; s++) {
    const len = 3 + ((rng() * 3) | 0);
    const horiz = rng() < 0.5;
    const x0 = 1 + ((rng() * (size - len - 2)) | 0);
    const z0 = 1 + ((rng() * (size - len - 2)) | 0);
    for (let i = 0; i < len; i++) {
      const x = horiz ? x0 + i : x0;
      const z = horiz ? z0 : z0 + i;
      if (inBounds(x, z)) wall[x][z] = true;
    }
  }

  // ---- crystals -----------------------------------------------------------
  const crystals = [];
  const taken = new Set(gates.map((g) => `${g.x},${g.z}`));
  const free = (x, z) => inBounds(x, z) && !wall[x][z] && !taken.has(`${x},${z}`);
  const count = 10 + ((rng() * 6) | 0);
  for (let tries = 0; tries < 200 && crystals.length < count; tries++) {
    let x, z;
    if (rng() < 0.6 && rooms.length) {
      const r = rooms[(rng() * rooms.length) | 0];
      x = r.x + 1 + ((rng() * (r.w - 2)) | 0);
      z = r.z + 1 + ((rng() * (r.h - 2)) | 0);
    } else {
      x = (rng() * size) | 0;
      z = (rng() * size) | 0;
    }
    if (!free(x, z)) continue;
    taken.add(`${x},${z}`);
    crystals.push({ x, z, color: CRYSTAL_COLORS[(rng() * CRYSTAL_COLORS.length) | 0] });
  }

  // ---- decorative star decals on free tiles --------------------------------
  const decals = [];
  for (let tries = 0; tries < 60 && decals.length < 8; tries++) {
    const x = (rng() * size) | 0;
    const z = (rng() * size) | 0;
    if (!free(x, z)) continue;
    taken.add(`${x},${z}`);
    decals.push({ x, z });
  }

  // ---- a grand gate on the outer wall (purely decorative) ------------------
  const side = (rng() * 4) | 0;
  const along = 4 + ((rng() * (size - 8)) | 0);
  const outerGate = { side, along }; // side: 0 N(z=-1), 1 S(z=size), 2 W(x=-1), 3 E(x=size)

  return { size, seed, wall, rooms, gates, crystals, decals, outerGate, rng };
}
