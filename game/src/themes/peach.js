// Round 1 - Peach's Castle: the FULL castle interior scene. The whole ~29MB
// "Peach's Castle Interior" model (its own marble floor, grand staircase, gold
// trim and the stained-glass Peach window) IS the environment - nothing
// procedural is added on top. The 20x20 RL gridworld plays out on the model's
// floor (open hall, navigate to the throne/goal at the top).

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";

const MODEL = "./assets/models/peach-castle/interior.dae";

// ---- placement knobs (tune from a screenshot) ----------------------------
const MODEL_TARGET = 84; // world footprint the castle is scaled to (board is 20) - big & grand (+2%)
const MODEL_FLOOR_FRAC = 0.108; // hall floor is ~10.8% of the footprint above box.min
const MODEL_DX = 0;
const MODEL_DY = 0; // manual vertical nudge (the hall floor is auto-dropped to y=0)
const MODEL_DZ = 0;
const MODEL_ROT = Math.PI; // radians, flip the whole castle scene 180 degrees

export const peach = {
  name: "peach",
  title: "Peach's Castle",
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
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          // hide: god-ray / light-shaft meshes (render as black streaks), and the
          // wooden entrance DOOR (the only Wood-textured mesh in the foyer).
          const meshName = o.name || "";
          const hide =
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
