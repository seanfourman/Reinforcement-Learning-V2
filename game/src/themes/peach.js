// Round 1 - Peach's Castle: the castle interior scene supplies the backdrop
// and side staircases, while the playable 20x20 RL board uses a clean flat
// procedural checker floor. The source model's marble floor/rug geometry is
// layered and uneven, so it is hidden instead of used as the board surface.

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { getCell } from "../layout.js";

const MODEL = "./assets/models/peach-castle/interior.dae";

// ---- placement knobs (tune from a screenshot) ----------------------------
const MODEL_TARGET = 84; // world footprint the castle is scaled to (board is 20) - big & grand (+2%)
const MODEL_FLOOR_FRAC = 0.108; // hall floor is ~10.8% of the footprint above box.min
const MODEL_DX = 0;
const MODEL_DY = 0; // manual vertical nudge (the hall floor is auto-dropped to y=0)
const MODEL_DZ = 0;
const MODEL_ROT = 0; // radians, spin to face the camera
const BOARD_DX = 0;
const BOARD_DZ = -10; // move the clean board forward into the hall
const BOARD_Y = -7.55; // keep it just above the gameplay ground plane

function createCleanBoardFloor(W, H) {
  const group = new THREE.Group();
  group.position.set(BOARD_DX, 0, BOARD_DZ);
  // board square size: tiles + grout scale about the board centre (cx, cz), so a
  // bigger cell grows the board in place without shifting its position.
  const cell = getCell();
  const cx = W / 2;
  const cz = H / 2;
  const grout = new THREE.Mesh(
    new THREE.PlaneGeometry(W * cell, H * cell),
    new THREE.MeshStandardMaterial({
      color: 0xc9c0b3,
      roughness: 0.92,
      metalness: 0,
    }),
  );
  grout.rotation.x = -Math.PI / 2;
  grout.position.set(cx, BOARD_Y - 0.006, cz);
  grout.receiveShadow = true;
  group.add(grout);

  const tileGeo = new THREE.PlaneGeometry(0.965 * cell, 0.965 * cell);
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xf1eee7,
    roughness: 0.84,
    metalness: 0,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x4f4a42,
    roughness: 0.88,
    metalness: 0,
  });
  const lightTiles = new THREE.InstancedMesh(tileGeo, lightMat, W * H);
  const darkTiles = new THREE.InstancedMesh(tileGeo.clone(), darkMat, W * H);
  const dummy = new THREE.Object3D();
  let nLight = 0;
  let nDark = 0;

  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      dummy.position.set(
        cx + (x + 0.5 - cx) * cell,
        BOARD_Y,
        cz + (z + 0.5 - cz) * cell,
      );
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      if ((x + z) % 2 === 0) {
        lightTiles.setMatrixAt(nLight++, dummy.matrix);
      } else {
        darkTiles.setMatrixAt(nDark++, dummy.matrix);
      }
    }
  }

  lightTiles.count = nLight;
  darkTiles.count = nDark;
  lightTiles.receiveShadow = true;
  darkTiles.receiveShadow = true;
  group.add(lightTiles, darkTiles);
  return group;
}

function removeTriangles(geometry, shouldDrop) {
  const pos = geometry?.getAttribute?.("position");
  if (!pos) return 0;

  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  const index = geometry?.getIndex?.();

  if (!index) {
    let removed = 0;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      c.set(0, 0, 0);
      for (let j = 0; j < 3; j++) {
        p.fromBufferAttribute(pos, i + j);
        c.add(p);
      }
      c.multiplyScalar(1 / 3);
      if (!shouldDrop(c)) continue;
      p.fromBufferAttribute(pos, i);
      pos.setXYZ(i + 1, p.x, p.y, p.z);
      pos.setXYZ(i + 2, p.x, p.y, p.z);
      removed++;
    }
    if (!removed) return 0;
    pos.needsUpdate = true;
    geometry.computeBoundingBox?.();
    geometry.computeBoundingSphere?.();
    return removed;
  }

  const src = index.array;
  const kept = [];

  for (let i = 0; i < src.length; i += 3) {
    c.set(0, 0, 0);
    for (let j = 0; j < 3; j++) {
      p.fromBufferAttribute(pos, src[i + j]);
      c.add(p);
    }
    c.multiplyScalar(1 / 3);
    if (!shouldDrop(c)) kept.push(src[i], src[i + 1], src[i + 2]);
  }

  if (kept.length === src.length) return 0;

  const IndexArray = pos.count > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(new THREE.BufferAttribute(new IndexArray(kept), 1));
  geometry.clearGroups();
  geometry.addGroup(0, kept.length, 0);
  geometry.computeBoundingBox?.();
  geometry.computeBoundingSphere?.();
  return (src.length - kept.length) / 3;
}

function removeCenterStairRunner(mesh) {
  if (!/^pCylinder1145__Velvet00$/i.test(mesh.name || "")) return;
  const removed = removeTriangles(mesh.geometry, (c) => {
    const centered = Math.abs(c.x) <= 700;
    const stairHeight = c.y >= -5 && c.y <= 580;
    const stairDepth = c.z >= -3300 && c.z <= -650;
    return centered && stairHeight && stairDepth;
  });
  if (removed) console.log(`PEACH center stair runner hidden: ${removed} tris`);
}

function removeCenterStairRails(mesh) {
  if (
    !/^(Emblem173_1__GoldDeco01|Emblem200__GoldDecoSeal00|NewWallModel2__MarbleWhite00|castle_tmp_polySurface263__MarbleWhite00NonDps|pCube110_10__GoldDecoWall00|pSphere234_1__GlassInside00|pSphere244__Lamp00)$/i.test(
      mesh.name || "",
    )
  )
    return;

  const removed = removeTriangles(mesh.geometry, (c) => {
    const sideRailLane =
      Math.abs(c.x) >= 245 &&
      Math.abs(c.x) <= 940 &&
      c.y >= -10 &&
      c.y <= 1320 &&
      c.z >= -2625 &&
      c.z <= -600;
    const topRailLip =
      Math.abs(c.x) <= 940 &&
      c.y >= 500 &&
      c.y <= 700 &&
      c.z >= -2630 &&
      c.z <= -2580;
    const bottomRailEnds =
      Math.abs(c.x) <= 430 &&
      c.y >= -30 &&
      c.y <= 220 &&
      c.z >= -830 &&
      c.z <= -650;
    return sideRailLane || topRailLip || bottomRailEnds;
  });
  if (removed) console.log(`PEACH center stair rails hidden: ${removed} tris`);
}

function removeCenterCarpetOutline(mesh) {
  if (!/^pCylinder1145__Tassel00$/i.test(mesh.name || "")) return;

  const removed = removeTriangles(mesh.geometry, (c) => {
    const centerFringe =
      Math.abs(c.x) <= 255 &&
      c.y >= -5 &&
      c.y <= 510 &&
      c.z >= -2065 &&
      c.z <= -650;
    return centerFringe;
  });
  if (removed)
    console.log(`PEACH center carpet outline hidden: ${removed} tris`);
}

function removeTopMiddlePanels(mesh) {
  if (!/^pPlane574__FrescoCloudWall00$/i.test(mesh.name || "")) return;

  const removed = removeTriangles(mesh.geometry, (c) => {
    const blueWallPanels =
      Math.abs(c.x) >= 275 &&
      Math.abs(c.x) <= 790 &&
      c.y >= 50 &&
      c.y <= 390 &&
      c.z >= -2030 &&
      c.z <= -1430;
    return blueWallPanels;
  });
  if (removed)
    console.log(`PEACH top middle blue panels hidden: ${removed} tris`);
}

export const peach = {
  name: "peach",
  title: "Peach's Castle",
  cell: 1.5, // board square size: 1.5 = ~50% bigger tiles, board still 20x20
  sky: ["#bfa9dc", "#dcc8ea", "#f6ecf2"], // soft regal lavender-cream
  fog: 0xe9e0f3,
  fogNear: 55,
  fogFar: 240,
  hemi: [0xfff2e0, 0x9a8aa0, 1.0], // bright warm interior ambient
  sun: 0xffeccf,
  sunIntensity: 2.6,
  fill: 0xc9b8e0,
  fillIntensity: 0.32,
  exposure: 1.12,
  bloom: { strength: 0.16, radius: 0.5, threshold: 0.82 },
  redName: "Crimson",
  blueName: "Cobalt",

  buildScene(scene, world, { renderer } = {}) {
    const group = new THREE.Group();
    scene.add(group);
    let disposed = false;
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

    const W = (world.rows && world.rows[0] && world.rows[0].length) || 20;
    const H = (world.rows && world.rows.length) || 20;
    group.add(createCleanBoardFloor(W, H));

    // ---- the FULL Peach's Castle interior (loaded async, fit onto the board)
    const collada = new ColladaLoader();
    collada
      .loadAsync(MODEL)
      .then((asset) => {
        if (disposed) return;
        const model = asset.scene;
        // The castle export flags static meshes as SkinnedMesh with a broken /
        // empty skeleton, which crashes Box3.setFromObject + the skinning shader.
        // Convert each to a plain static Mesh (rest pose) first.
        const skinned = [];
        model.traverse((o) => o.isSkinnedMesh && skinned.push(o));
        for (const sm of skinned) {
          const m = new THREE.Mesh(sm.geometry, sm.material);
          m.name = sm.name;
          m.position.copy(sm.position);
          m.quaternion.copy(sm.quaternion);
          m.scale.copy(sm.scale);
          if (sm.parent) {
            sm.parent.add(m);
            sm.parent.remove(sm);
          }
        }
        model.traverse((o) => {
          if (!o.isMesh) return;
          removeCenterStairRunner(o);
          removeCenterStairRails(o);
          removeCenterCarpetOutline(o);
          removeTopMiddlePanels(o);
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          // hide: god-ray / light-shaft meshes (render as black streaks), and the
          // wooden entrance DOOR (the only Wood-textured mesh in the foyer).
          const meshName = o.name || "";
          const hide =
            /^(polySurface2051__MarbleCheckFloor00|pCylinder434__CarpetSun00)$/i.test(
              meshName,
            ) ||
            /polySurface71[02]/i.test(meshName) ||
            ms.some((m) => {
              if (!m) return false;
              const t = m.map;
              const src =
                (t && (t.image?.src || t.source?.data?.src || t.name)) ||
                m.name ||
                "";
              return /godray|lightground|wood00/i.test(src);
            });
          if (hide) {
            o.visible = false;
            return;
          }
          o.castShadow = false; // backdrop: agents cast, the floor receives
          o.receiveShadow = true;
          o.frustumCulled = false;
          for (const m of ms) {
            if (m && m.map) {
              m.map.colorSpace = THREE.SRGBColorSpace;
              m.map.anisotropy = maxAniso;
            }
          }
        });
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const s = MODEL_TARGET / (Math.max(size.x, size.z) || 1);
        // centre the footprint at the origin, floor (box.min.y) at y=0 (pre-scale)
        model.position.set(-center.x, -box.min.y, -center.z);
        const wrap = new THREE.Group();
        wrap.add(model);
        wrap.scale.setScalar(s);
        wrap.position.set(
          W / 2 + MODEL_DX,
          MODEL_DY - MODEL_FLOOR_FRAC * MODEL_TARGET, // drop the hall floor to y=0
          H / 2 + MODEL_DZ,
        );
        wrap.rotation.y = MODEL_ROT;
        group.add(wrap);
        let nmesh = 0;
        model.traverse((o) => o.isMesh && nmesh++);
        console.log(
          `PEACH model loaded: ${nmesh} meshes, raw footprint ${Math.max(size.x, size.z).toFixed(0)}, scale ${s.toFixed(4)}`,
        );
      })
      .catch((e) => console.warn("Peach's Castle model failed to load", e));

    return {
      group,
      update() {},
      dispose() {
        disposed = true;
        scene.remove(group);
        group.traverse((o) => {
          if (o.isMesh) {
            o.geometry?.dispose?.();
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of ms) {
              if (!m) continue;
              for (const v of Object.values(m)) v?.isTexture && v.dispose?.();
              m.dispose?.();
            }
          }
        });
      },
    };
  },
};
