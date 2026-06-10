// World + look constants, palette sampled from the reference frames in docs/frames.

export const GRID = 20;

export const TILE_H = 0.14; // floor tile thickness
export const WALL_H = 1.05; // interior wall height
export const OUTER_WALL_H = 2.3; // castle wall height

export const PALETTE = {
  // floor stones (near-white so instance tints do the variation)
  tileBase: 0xf4ebe6,
  tileWarm: 0xe9d3c4,
  tileRose: 0xefd2da,
  tileCool: 0xddd6e2,

  grout: 0x8a6a58,
  moss: 0x86b14e,
  mossDark: 0x5d8f3a,

  wallStone: 0xc9ad8b, // sandy interior ruin walls
  wallCap: 0x97785c,

  outerWall: 0xa9938b, // grey-rose castle wall
  wood: 0x6b4a33,
  roof: 0x3e8c93, // teal tower roofs
  finial: 0xe8c168,

  gateGreen: 0x86ff4d,
  gateRed: 0xff3b5c,
  lantern: 0xffc46b,

  sky: 0xb9c2dd,
  fog: 0xb6bcd6,
  outsideGround: 0x5e7247,
};

export const CRYSTAL_COLORS = [
  0x53e6c3, // teal
  0xe84f8a, // pink
  0x9a5bff, // purple
  0xff4fb0, // magenta
  0x4fd9ff, // ice blue
  0xc44fff, // violet
];

export const BANNER_COLORS = [0xc4474f, 0x3e8c93, 0x8a5bd6];

export const CAMERA = {
  fov: 40,
  pitch: (58 * Math.PI) / 180, // angle above horizon, fixed like the reference
  minDist: 9,
  maxDist: 30,
  startDist: 30, // start fully zoomed out
  panMargin: 2.2, // how far past the outer walls the screen edge may see
  minSidePan: 1.8, // always allow at least this much pan, even fully zoomed out
  topReach: 3.0, // extra pan allowance toward the top wall
};
