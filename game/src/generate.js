import { GRID, CRYSTAL_COLORS } from './config.js';

// World layout: a single-thickness maze that fills the ENTIRE board, with the
// castle's curtain wall as its outer boundary - no inner ring, no courtyard
// moat. The maze runs flush up against the stone walls on every side.
//
// The lattice puts the walkable "cells" on ODD coords (1,3,..,19) and the
// 1-wide walls on the EVEN coords (0,2,..,18). On a 20-wide board that tiles
// perfectly (10 cells + 10 wall lines = 20), so there is no leftover edge to
// fudge: coord 0 is a wall line pressed against the north/west castle wall, and
// coord 19 is a corridor line against the south/east wall. Because every
// odd/odd cell is guaranteed open, no 2x2 block of wall can ever form - the
// walls always read as clean single-thickness corridors.
//
// The only cells forced open are those carrying the wall-mounted torches and
// banners (see build.js) and the gate mouth, so nothing buries a fixture.

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
  const size = GRID; // 20
  const wall = Array.from({ length: size }, () => new Array(size).fill(true));
  const inBounds = (x, z) => x >= 0 && z >= 0 && x < size && z < size;
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // ---- maze lattice -------------------------------------------------------
  const C0 = 1, C1 = size - 1;     // cell centres 1..19 (odd) -> 10x10 lattice
  const STEP = 2;
  const DIRS = [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]];
  const isCell = (x, z) => x >= C0 && x <= C1 && z >= C0 && z <= C1 && x % 2 === 1 && z % 2 === 1;

  // ---- recursive backtracker: a perfect maze over the cell lattice --------
  const key = (x, z) => x * size + z;
  const seen = new Set([key(C0, C0)]);
  const stack = [[C0, C0]];
  wall[C0][C0] = false;
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const opts = shuffle(
      DIRS.filter(([dx, dz]) => isCell(cx + dx, cz + dz) && !seen.has(key(cx + dx, cz + dz)))
    );
    if (!opts.length) { stack.pop(); continue; }
    const [dx, dz] = opts[0];
    wall[cx + dx / 2][cz + dz / 2] = false; // knock out the wall between
    wall[cx + dx][cz + dz] = false;         // open the new cell
    seen.add(key(cx + dx, cz + dz));
    stack.push([cx + dx, cz + dz]);
  }

  // ---- braid: open a few extra walls so the maze isn't one long dead-ended
  // thread. Removing ~35% of dead ends turns them into loops, which keeps the
  // run interesting and means a locked gate rarely seals a whole region off.
  for (let x = C0; x <= C1; x += 2) {
    for (let z = C0; z <= C1; z += 2) {
      const open = [], closed = [];
      for (const [dx, dz] of DIRS) {
        if (!isCell(x + dx, z + dz)) continue;
        (wall[x + dx / 2][z + dz / 2] ? closed : open).push([x + dx / 2, z + dz / 2]);
      }
      if (open.length === 1 && closed.length && rng() < 0.35) {
        const [wx, wz] = closed[(rng() * closed.length) | 0];
        wall[wx][wz] = false;
      }
    }
  }

  // ---- open chambers: clear a few lattice-aligned rectangles outright ------
  const rooms = [];
  const nodes = (C1 - C0) / 2; // = 9 (max node index)
  const roomFits = (r) =>
    !rooms.some((o) => r.x <= o.x + o.w && r.x + r.w >= o.x && r.z <= o.z + o.h && r.z + r.h >= o.z);
  const wantRooms = 3 + ((rng() * 2) | 0);
  for (let t = 0; t < 30 && rooms.length < wantRooms; t++) {
    const cw = 2 + ((rng() * 2) | 0); // width in cells (2-3)
    const ch = 2 + ((rng() * 2) | 0);
    // start one node in from the edge so chambers read as interior rooms
    const cx0 = C0 + 2 * (1 + ((rng() * (nodes - cw - 1)) | 0));
    const cz0 = C0 + 2 * (1 + ((rng() * (nodes - ch - 1)) | 0));
    const cx1 = cx0 + (cw - 1) * 2, cz1 = cz0 + (ch - 1) * 2;
    const r = { x: cx0, z: cz0, w: cx1 - cx0 + 1, h: cz1 - cz0 + 1 };
    if (!roomFits({ x: r.x - 1, z: r.z - 1, w: r.w + 2, h: r.h + 2 })) continue;
    for (let x = cx0; x <= cx1; x++) for (let z = cz0; z <= cz1; z++) wall[x][z] = false;
    rooms.push(r);
  }

  // ---- keep the torch / banner cells open so nothing buries them -----------
  // (mirrors the wall-mounted fixtures placed in build.js: torches on the
  // west/east/north inner faces, banners on the west/east faces)
  const fixtures = [
    [0, 2], [0, 5], [0, 7], [0, 12], [0, 15], [0, 17], // west wall torches + banners
    [19, 2], [19, 12],                                 // east wall (rest land on corridors)
    [2, 0], [6, 0], [13, 0], [17, 0],                  // north wall torches
  ];
  for (const [x, z] of fixtures) {
    wall[x][z] = false;
    // an (even,even) cell has no lattice neighbour of its own, so on its own it
    // would be a sealed pocket - tuck it one step inward so the torch sits in a
    // connected alcove instead of an island
    if (x % 2 === 0 && z % 2 === 0) {
      if (x === 0) wall[1][z] = false;
      else if (x === size - 1) wall[size - 2][z] = false;
      else wall[x][1] = false;
    }
  }

  // ---- entrance: a clean mouth lined up with the north castle gate ---------
  const ex = size / 2; // 10
  for (const x of [ex - 1, ex, ex + 1]) wall[x][0] = false; // gap in the north wall
  wall[ex][1] = false;                                       // step inside
  const start = { x: ex, z: 0 };

  // ---- tidy up: drop any lone wall cell with no wall neighbour (a stray
  // pillar reads as a "wall floating in the open")
  for (let pass = 0; pass < 2; pass++) {
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if (!wall[x][z]) continue;
        const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
          ([dx, dz]) => inBounds(x + dx, z + dz) && wall[x + dx][z + dz]
        );
        if (!touches) wall[x][z] = false;
      }
    }
  }

  // ---- no full-width straight corridor: a line with zero walls reads as a
  // moat, so re-wall one non-critical corridor cell in it (keeping every floor
  // cell reachable from the start)
  const floorConnected = () => {
    let total = 0;
    for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) if (!wall[x][z]) total++;
    const vis = Array.from({ length: size }, () => new Array(size).fill(false));
    const q = [[start.x, start.z]];
    vis[start.x][start.z] = true;
    let n = 1;
    while (q.length) {
      const [x, z] = q.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!inBounds(nx, nz) || vis[nx][nz] || wall[nx][nz]) continue;
        vis[nx][nz] = true;
        n++;
        q.push([nx, nz]);
      }
    }
    return n === total;
  };
  const breakLine = (cells) => {
    for (const [x, z] of shuffle(cells)) {
      if ((x % 2 === 0) === (z % 2 === 0)) continue; // only "between" cells split cleanly
      if (x === start.x && z <= 1) continue;          // never the entrance throat
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([dx, dz]) => inBounds(x + dx, z + dz) && wall[x + dx][z + dz]
      );
      if (!touches) continue; // would leave a wall floating on its own
      wall[x][z] = true;
      if (floorConnected()) return;
      wall[x][z] = false;
    }
  };
  for (let z = 0; z < size; z++) {
    const cells = []; let anyWall = false;
    for (let x = 0; x < size; x++) (wall[x][z] ? (anyWall = true) : cells.push([x, z]));
    if (!anyWall) breakLine(cells);
  }
  for (let x = 0; x < size; x++) {
    const cells = []; let anyWall = false;
    for (let z = 0; z < size; z++) (wall[x][z] ? (anyWall = true) : cells.push([x, z]));
    if (!anyWall) breakLine(cells);
  }

  // ---- goal: deepest room from the entrance (or the far cell if none) ------
  let goal;
  if (rooms.length) {
    const r = [...rooms].sort((a, b) => b.z + b.h - (a.z + a.h))[0];
    goal = { x: (r.x + r.x + r.w - 1) >> 1, z: (r.z + r.z + r.h - 1) >> 1 };
  } else {
    goal = { x: ex - 1, z: C1 };
  }

  // ---- gates: stone arches across a handful of corridor cells -------------
  // A corridor is an open "between" cell of the lattice (exactly one even
  // coord). Even-x corridors run E-W (wall along z -> axis 'z'); odd-x run N-S.
  const gates = [];
  const isCorridor = (x, z) =>
    !wall[x][z] && x >= 1 && z >= 1 && x <= C1 && z <= C1 && (x % 2 === 0) !== (z % 2 === 0);
  const corridors = [];
  for (let x = 1; x <= C1; x++)
    for (let z = 1; z <= C1; z++) if (isCorridor(x, z)) corridors.push([x, z]);
  shuffle(corridors);
  // can the goal still be reached from the start if these cells are sealed?
  const reaches = (blocked) => {
    const vis = Array.from({ length: size }, () => new Array(size).fill(false));
    const q = [[start.x, start.z]];
    vis[start.x][start.z] = true;
    while (q.length) {
      const [x, z] = q.pop();
      if (x === goal.x && z === goal.z) return true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!inBounds(nx, nz) || vis[nx][nz] || wall[nx][nz] || blocked.has(key(nx, nz))) continue;
        vis[nx][nz] = true;
        q.push([nx, nz]);
      }
    }
    return false;
  };
  const sealed = new Set();
  const wantGates = 4 + ((rng() * 3) | 0);
  for (const [x, z] of corridors) {
    if (gates.length >= wantGates) break;
    if (x === ex && z <= 1) continue; // keep the entrance throat clear
    if (gates.some((g) => Math.abs(g.x - x) + Math.abs(g.z - z) < 4)) continue; // spaced
    // with no keys yet, a locked gate must never wall off the prize
    let locked = rng() < 0.5;
    if (locked) {
      sealed.add(key(x, z));
      if (!reaches(sealed)) { sealed.delete(key(x, z)); locked = false; }
    }
    gates.push({ x, z, axis: x % 2 === 0 ? 'z' : 'x', locked });
  }

  // ---- crystals: rewards at dead ends, in rooms, plus a light scatter ------
  const crystals = [];
  const taken = new Set(gates.map((g) => `${g.x},${g.z}`));
  taken.add(`${start.x},${start.z}`);
  const free = (x, z) => inBounds(x, z) && !wall[x][z] && !taken.has(`${x},${z}`);
  const addCrystal = (x, z) => {
    if (!free(x, z)) return false;
    taken.add(`${x},${z}`);
    crystals.push({ x, z, color: CRYSTAL_COLORS[(rng() * CRYSTAL_COLORS.length) | 0] });
    return true;
  };
  for (let x = C0; x <= C1; x += 2) {
    for (let z = C0; z <= C1; z += 2) {
      if (wall[x][z]) continue;
      let open = 0;
      for (const [dx, dz] of DIRS)
        if (inBounds(x + dx / 2, z + dz / 2) && !wall[x + dx / 2][z + dz / 2]) open++;
      if (open === 1 && rng() < 0.7) addCrystal(x, z); // dead end
    }
  }
  for (const r of rooms) {
    for (let i = 0, n = 1 + ((rng() * 3) | 0); i < n; i++) {
      addCrystal(r.x + ((rng() * r.w) | 0), r.z + ((rng() * r.h) | 0));
    }
  }
  for (let t = 0, target = 12 + ((rng() * 6) | 0); t < 300 && crystals.length < target; t++) {
    addCrystal((rng() * size) | 0, (rng() * size) | 0);
  }

  // ---- decorative star decals on free floor -------------------------------
  const decals = [];
  for (let t = 0; t < 80 && decals.length < 8; t++) {
    const x = (rng() * size) | 0, z = (rng() * size) | 0;
    if (!free(x, z)) continue;
    taken.add(`${x},${z}`);
    decals.push({ x, z });
  }

  // grand decorative gate on the outer castle wall, matching the real gatehouse
  const outerGate = { side: 0, along: size / 2 }; // 0 N, 1 S, 2 W, 3 E

  return { size, seed, wall, rooms, gates, crystals, decals, outerGate, start, goal, rng };
}
