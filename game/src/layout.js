// Parses the fixed RL world (an array of 20 row-strings, shipped inside
// trajectory.json) into structured positions the viewer can render.
//
// Coordinate bridge: the Python sim uses (row, col) with row 0 at the NORTH.
// three.js uses (x, z). We map col -> x, row -> z, so a cell's centre is at
// (col + 0.5, z=row + 0.5). North (row 0) is small z, which is where the
// castle gatehouse / escape gate sits.

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

// cell (row, col) -> three.js ground coordinate (cell centre)
export function cellToWorld(r, c) {
  return { x: c + 0.5, z: r + 0.5 };
}
