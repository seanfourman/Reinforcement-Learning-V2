import * as THREE from 'three';
import { cellToWorld } from './layout.js';

// Non-blocking decor: a carpet runner up the hall toward the escape, and warm rugs
// in the living room (under each spawn + a big central one). No chandeliers — they
// read as floating junk; the hall is lit by the sun, fill light and wall torches.

export function createDressing(scene, world) {
  const group = new THREE.Group();
  scene.add(group);
  const geos = [];
  const mats = [];
  const G = (g) => { geos.push(g); return g; };
  const rug = (w, h, color, x, z, y = 0.115) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    mats.push(m);
    const mesh = new THREE.Mesh(G(new THREE.PlaneGeometry(w, h)), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // hall carpet runner from just below the escape down toward the exit doors
  rug(2.5, 11, 0xcaa64a, 9.5, 6.0, 0.108);     // gold trim
  rug(2.2, 11, 0x8c2f3a, 9.5, 6.0, 0.115);     // red runner

  // a big rug in the living room + a small one under each spawn
  rug(7, 3, 0x6a4a2c, 9.5, 18.0, 0.118);       // central living-room rug
  for (const spawn of [world.redSpawn, world.blueSpawn]) {
    if (!spawn) continue;
    const { x, z } = cellToWorld(spawn[0], spawn[1]);
    rug(1.6, 1.6, 0x3f5f86, x, z, 0.12);
  }

  function update() {}                          // nothing animated now

  function dispose() {
    scene.remove(group);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  }

  return { group, update, dispose };
}
