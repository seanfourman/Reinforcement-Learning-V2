// Parses the fixed RL world (an array of 20 row-strings, shipped inside
// trajectory.json) into structured positions the viewer can render.
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

export const TILE = {
  WALL: '#', FLOOR: '.', ESCAPE: 'E',
  RED_KEY: 'r', BLUE_KEY: 'b', GOLD: 'G',
  PAD1: '1', PAD2: '2', ALT_A: 'a', ALT_C: 'c',
  RED_DOOR: 'D', BLUE_DOOR: 'd', RED_SPAWN: 'R', BLUE_SPAWN: 'B',
  GOLD_TRAP: 'X',
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
    redKey: find(TILE.RED_KEY),
    blueKey: find(TILE.BLUE_KEY),
    gold: find(TILE.GOLD),
    pad1: find(TILE.PAD1),
    pad2: find(TILE.PAD2),
    altA: find(TILE.ALT_A),
    altC: find(TILE.ALT_C),
    redDoor: find(TILE.RED_DOOR),
    blueDoor: find(TILE.BLUE_DOOR),
    redSpawn: find(TILE.RED_SPAWN),
    blueSpawn: find(TILE.BLUE_SPAWN),
    escape: findAll(TILE.ESCAPE),
  };
}

// cell (row, col) -> three.js ground coordinate (cell centre), scaled about the
// board centre by the active cell size so the board grows in place.
export function cellToWorld(r, c) {
  const C = GRID / 2;
  return { x: C + (c + 0.5 - C) * _cell, z: C + (r + 0.5 - C) * _cell };
}

// inverse of cellToWorld: ground coord -> integer cell (for click-to-inspect)
export function worldToCell(x, z) {
  const C = GRID / 2;
  return {
    r: Math.floor((z - C) / _cell + C),
    c: Math.floor((x - C) / _cell + C),
  };
}
