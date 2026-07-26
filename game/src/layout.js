// Parses the RL world (an array of 20 row-strings from /api/world) into the
// structured positions the viewer can render.
//
// Coordinate bridge: the Python sim uses (row, col) with row 0 at the NORTH.
// three.js uses (x, z). We map col -> x, row -> z, so a cell's centre is at
// (col + 0.5, z=row + 0.5). North (row 0) is small z, which is where the
// castle gatehouse / escape gate sits.

import { GRID } from './config.js';

// Per-round board square size. The whole 20x20 board (agents, floor tiles and
// heatmap overlays) scales by this factor ABOUT THE BOARD CENTRE, so bigger
// squares grow the board in place without shifting the camera, castle backdrop
// or any existing offset. 1 = the original 1-unit squares (every round that
// doesn't override it via theme.cell).
let _cell = 1;
export function setCell(s) { _cell = (s && s > 0) ? s : 1; }
export function getCell() { return _cell; }

// Per-round world offset (dx along +x/east, dz along +z/south) applied AFTER the
// cell scale, so a round can slide the whole arena - agents, heatmap and board
// tiles all move together - without touching the fixed castle backdrop. Set from
// theme.offset each round; defaults to none.
let _offX = 0, _offZ = 0;
export function setOffset(dx = 0, dz = 0) { _offX = dx || 0; _offZ = dz || 0; }
export function getOffset() { return [_offX, _offZ]; }

export const TILE = {
  WALL: '#', FLOOR: '.', ESCAPE: 'E',
  RED_SPAWN: 'R', BLUE_SPAWN: 'B',
};

export function parseLayout(rows) {
  const H = rows.length;
  const W = rows[0].length;
  const find = (ch) => {
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (rows[r][c] === ch) return { r, c };
    return null;
  };
  const findAll = (ch) => {
    const out = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (rows[r][c] === ch) out.push({ r, c });
    return out;
  };
  return {
    rows, H, W,
    redSpawn: find(TILE.RED_SPAWN),
    blueSpawn: find(TILE.BLUE_SPAWN),
    escape: findAll(TILE.ESCAPE),
  };
}

// cell (row, col) -> three.js ground coordinate (cell centre), scaled about the
// board centre by the active cell size so the board grows in place.
export function cellToWorld(r, c) {
  const C = GRID / 2;
  return {
    x: C + (c + 0.5 - C) * _cell + _offX,
    z: C + (r + 0.5 - C) * _cell + _offZ,
  };
}

// inverse of cellToWorld: ground coord -> integer cell (for click-to-inspect)
export function worldToCell(x, z) {
  const C = GRID / 2;
  return {
    r: Math.floor((z - _offZ - C) / _cell + C),
    c: Math.floor((x - _offX - C) / _cell + C),
  };
}
