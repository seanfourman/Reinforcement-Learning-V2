import * as THREE from 'three';
import { CRYSTAL_COLORS } from './config.js';
import { TILE, cellToWorld } from './layout.js';

// Glowing crystal clusters — the reference art's signature — tucked into the
// maze's dead-end cells so they add colour and light without blocking paths.

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const SPECIAL = new Set([TILE.RED_KEY, TILE.BLUE_KEY, TILE.GOLD, TILE.PAD1,
  TILE.PAD2, TILE.ALT_A, TILE.ALT_C, TILE.RED_DOOR, TILE.BLUE_DOOR,
  TILE.RED_SPAWN, TILE.BLUE_SPAWN, TILE.ESCAPE]);

export function buildCrystals(rows) {
  const group = new THREE.Group();
  const size = rows.length;
  const isFloor = (r, c) => r >= 0 && c >= 0 && r < size && c < size && rows[r][c] !== TILE.WALL;
  const mats = [];

  // collect plain dead-end floor cells (one open neighbour), skip fixtures
  const spots = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (rows[r][c] !== TILE.FLOOR) continue;
      if (SPECIAL.has(rows[r][c])) continue;
      const deg = ORTHO.reduce((a, [dr, dc]) => a + (isFloor(r + dr, c + dc) ? 1 : 0), 0);
      if (deg <= 1) spots.push([r, c]);
    }
  }

  const shardGeo = new THREE.IcosahedronGeometry(0.5, 0);
  // hash for deterministic, stable placement (no per-load randomness)
  const h = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5; return s - Math.floor(s); };

  spots.forEach(([r, c], idx) => {
    const color = CRYSTAL_COLORS[idx % CRYSTAL_COLORS.length];
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.0,
      roughness: 0.15, metalness: 0.0, flatShading: true,
    });
    mats.push({ mat, phase: idx * 1.7 });
    const { x, z } = cellToWorld(r, c);
    const cluster = new THREE.Group();
    const n = 4 + ((h(r, c) * 3) | 0);
    for (let i = 0; i < n; i++) {
      const main = i === 0;
      const sy = main ? 1.2 + h(r + i, c) * 0.6 : 0.5 + h(r, c + i) * 0.5;
      const sxz = main ? 0.52 : 0.26 + h(i, r) * 0.18;
      const ang = h(c, r + i) * Math.PI * 2;
      const d = main ? 0 : 0.16 + h(i, c) * 0.16;
      const m = new THREE.Mesh(shardGeo, mat);
      m.position.set(Math.cos(ang) * d, 0.12 + sy * 0.3, Math.sin(ang) * d);
      m.rotation.set((h(i, 1) - 0.5) * 0.5, h(i, 2) * Math.PI, (h(i, 3) - 0.5) * 0.5);
      m.scale.set(sxz, sy, sxz);
      m.castShadow = true;
      cluster.add(m);
    }
    cluster.position.set(x, 0, z);
    group.add(cluster);
  });

  function update(t) {
    for (const { mat, phase } of mats) {
      mat.emissiveIntensity = 0.7 + Math.sin(t * 1.6 + phase) * 0.25;
    }
  }

  return { group, update, count: spots.length };
}
