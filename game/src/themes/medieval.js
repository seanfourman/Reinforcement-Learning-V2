// Round 1 — the medieval castle theme. Captures the look (sky, fog, lighting,
// tone) so other rounds can swap a different palette in behind the same seam.
// The medieval GEOMETRY builders (architecture/furniture/doors/dressing) are
// still wired directly in main.js for now; later rounds add their own geometry.

export const medieval = {
  name: 'medieval',
  title: 'The Castle',
  // vertical sky gradient (top, mid, bottom)
  sky: ['#8fa3cc', '#b9c2dd', '#d9cfd2'],
  fog: 0xb6bcd6,
  fogNear: 34,
  fogFar: 78,
  // lights: hemisphere [sky, ground, intensity], sun color+intensity, fill color+intensity
  hemi: [0xdfd8f7, 0x9a7a68, 1.15],
  sun: 0xfff0dc,
  sunIntensity: 1.9,
  fill: 0xb9a8e8,
  fillIntensity: 0.35,
  exposure: 1.25,
  // actor flavor names (cosmetic; the HUD shows the algorithm, not these)
  redName: 'King',
  blueName: 'Queen',
};
