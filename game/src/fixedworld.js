// Adapts the fixed RL map into the exact shape buildWorld() already expects,
// so the gorgeous castle/wall/nature rendering is reused untouched - we just
// feed it our hand-authored layout instead of the old random generator.
//
// buildWorld() destructures { size, wall, gates, crystals, decals, outerGate,
// rng }. We supply the wall grid from the map, leave the maze-era lists empty
// (keys/pads/characters are rendered by the playback layer), and hand it a
// FIXED-seed rng so the stone tints look identical every load.

import { mulberry32 } from './generate.js';

export function buildFixedWorld(rows) {
  const size = rows.length; // 20
  // We render the maze walls ourselves (castle masonry, see mazewalls.js), so
  // buildWorld gets an EMPTY wall grid - it still lays the floor, the castle
  // shell, lighting and the outside nature, just no rocky rubble walls.
  const wall = Array.from({ length: size }, () => new Array(size).fill(false));
  return {
    size,
    wall,
    gates: [],
    crystals: [],
    decals: [],
    rooms: [],
    outerGate: { side: 0, along: size / 2 },
    start: { x: size / 2, z: 0 },
    goal: { x: size / 2, z: size - 1 },
    seed: 0x1234abcd,
    rng: mulberry32(0x1234abcd),
  };
}
