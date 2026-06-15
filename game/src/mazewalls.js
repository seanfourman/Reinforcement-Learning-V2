import * as THREE from 'three';
import { TILE } from './layout.js';

// Real PBR castle stone (CC0 medieval-blocks texture set: diffuse + normal +
// roughness) on the maze walls. The normal map gives genuine carved-stone
// relief on the faces; a slight per-cell height variation keeps the top edge
// from reading as one flat lid.

const BASE_Y = 0.16;
const H = 1.05;

export function buildMazeWalls(rows) {
  const group = new THREE.Group();
  const size = rows.length;
  const cells = [];
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++)
      if (rows[z][x] === TILE.WALL) cells.push([x, z]);
  if (!cells.length) return group;

  const loader = new THREE.TextureLoader();
  const load = (file, srgb) => {
    const t = loader.load(`textures/pbr/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(0.6, 0.6); // ~3-4 stones per cell face
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const map = load('wall_diff.jpg', true);
  const normalMap = load('wall_nor.jpg', false);
  const roughnessMap = load('wall_rough.jpg', false);

  const mat = new THREE.MeshStandardMaterial({
    map, normalMap, roughnessMap, metalness: 0, roughness: 1,
  });
  mat.normalScale = new THREE.Vector2(1.2, 1.2);

  const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1, 1.0), mat, cells.length);
  mesh.castShadow = mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  cells.forEach(([x, z], i) => {
    const hh = H * (0.9 + hash(x, z) * 0.2); // irregular top
    dummy.position.set(x + 0.5, BASE_Y + hh / 2, z + 0.5);
    dummy.scale.set(1, hh, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  group.add(mesh);
  return group;
}
