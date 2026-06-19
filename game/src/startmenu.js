// Start menu — the Super Mario Odyssey ship cabin (HomeInside) used as a
// cinematic 3D background, with a title card + Start button. main.js shows this
// before booting the live match; clicking Start tears it down and starts the game.
//
// The cabin models are the vendored Odyssey "HomeInside" pack (Y-up, so no axis
// fix needed). They're loaded once and shown as-is (bind pose) — no cloning.

import * as THREE from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";

const ASSETS = "./assets/models/home-inside/";

// --- camera framing knobs (fractions of the ROOM box; the giant backdrop plane
// behind the window is auto-excluded so it doesn't blow up the framing) -------
const CAM_BACK = -0.05; // camera distance from the open FRONT, as a fraction of room depth (neg = outside, further back)
const CAM_H = 0.42; // camera height, as a fraction of room height
const LOOK_BACK = 0.15; // look-at distance from the BACK (window) wall, fraction of depth
const LOOK_H = 0.1; // look-at height (lower = camera angles down), fraction of height

export function createStartMenu({
  scene,
  camera,
  renderer,
  actors,
  heatmap,
  onStart,
}) {
  let active = true;
  let disposed = false;
  const collada = new ColladaLoader();
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

  const group = new THREE.Group();
  scene.add(group);

  // hide the game's actors + value heatmap while the menu is up
  const prevActorsVisible = actors?.group ? actors.group.visible : null;
  if (actors?.group) actors.group.visible = false;
  heatmap?.hide?.();

  // turn OFF the game's bright daylight while the menu's warm interior is up —
  // otherwise the sun (intensity ~1.9) + my lights double up and blow the light
  // cream cabinet out to white. Restored in dispose().
  const dimmedLights = [];
  scene.traverse((o) => {
    if (o.isLight) {
      dimmedLights.push([o, o.intensity]);
      o.intensity = 0;
    }
  });
  const prevExposure = renderer.toneMappingExposure;
  renderer.toneMappingExposure = 1.06;

  // warm interior lighting for the cabin
  const menuLights = new THREE.Group();
  menuLights.add(new THREE.HemisphereLight(0xfff1dc, 0x3a2c20, 0.78));
  const key = new THREE.DirectionalLight(0xfff0cc, 1.2);
  key.position.set(4, 9, 6);
  menuLights.add(key);
  const warm = new THREE.PointLight(0xffce8c, 0.75, 40, 2);
  warm.position.set(0, 5, 3);
  menuLights.add(warm);
  scene.add(menuLights);

  // camera framing, computed once the room's bounds are known
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  let framed = false;

  function frame(root) {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const boxes = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      o.geometry.computeBoundingBox();
      boxes.push(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    if (!boxes.length) return;
    const maxDim = (b) => {
      b.getSize(v);
      return Math.max(v.x, v.y, v.z);
    };
    const sorted = boxes.map(maxDim).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    const box = new THREE.Box3();
    for (const b of boxes) if (maxDim(b) <= median * 2.5) box.union(b); // drop the huge backdrop
    const { min, max } = box;
    const cx = (min.x + max.x) / 2,
      H = max.y - min.y,
      D = max.z - min.z;
    // camera sits inside the room near the open FRONT (max.z), looking back + up
    // at the round window on the BACK wall (min.z)
    camTarget.set(cx, min.y + LOOK_H * H, min.z + LOOK_BACK * D);
    camPos.set(cx, min.y + CAM_H * H, max.z - CAM_BACK * D);
    camera.near = 0.1;
    camera.far = Math.max(camera.far, D * 8);
    camera.updateProjectionMatrix();
    framed = true;
  }

  function tune(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        if (m.map) {
          // tile mirrored HORIZONTALLY only (left-right flip on each repeat) so the
          // panels line up; vertical stays a normal repeat (no up/down flip)
          m.map.wrapS = THREE.MirroredRepeatWrapping;
          m.map.wrapT = THREE.RepeatWrapping;
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.anisotropy = maxAniso;
          m.map.needsUpdate = true;
        }
        if ("shininess" in m) m.shininess = Math.min(m.shininess || 20, 12);
      }
    });
  }

  function load(name, onReady) {
    collada
      .loadAsync(ASSETS + name)
      .then((asset) => {
        if (disposed) return;
        tune(asset.scene);
        group.add(asset.scene);
        onReady?.(asset.scene);
      })
      .catch((e) => console.warn("start menu: could not load", name, e));
  }

  load("HomeInside.dae", (room) => frame(room));
  load("HomeChairL.dae");
  load("HomeChairR.dae");

  // ---- DOM overlay -----------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    #rl-menu{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;
      align-items:center;justify-content:flex-end;padding-bottom:13vh;pointer-events:none;
      font-family:"Segoe UI",system-ui,sans-serif;opacity:0;transition:opacity .9s ease;
      background:radial-gradient(120% 90% at 50% 18%,rgba(0,0,0,0) 55%,rgba(0,0,0,.45) 100%);}
    #rl-menu.show{opacity:1;}
    #rl-menu.out{opacity:0;transition:opacity .6s ease;}
    #rl-menu .ttl{font-size:66px;font-weight:800;color:#fff;letter-spacing:1px;margin:0;
      text-shadow:0 4px 30px rgba(0,0,0,.75),0 1px 0 rgba(0,0,0,.5);}
    #rl-menu .sub{font-size:17px;color:#ffe6b0;letter-spacing:5px;text-transform:uppercase;
      margin:8px 0 28px;text-shadow:0 2px 14px rgba(0,0,0,.7);}
    #rl-menu .start{pointer-events:auto;cursor:pointer;border:none;border-radius:40px;
      padding:16px 56px;font:700 24px "Segoe UI",system-ui,sans-serif;color:#4a2c00;
      background:linear-gradient(180deg,#ffe07a,#ffb13a);
      box-shadow:0 10px 30px rgba(0,0,0,.5),inset 0 2px 0 rgba(255,255,255,.65);
      transition:transform .15s ease,box-shadow .15s ease;}
    #rl-menu .start:hover{transform:translateY(-2px) scale(1.03);
      box-shadow:0 14px 38px rgba(0,0,0,.55),inset 0 2px 0 rgba(255,255,255,.75);}
    #rl-menu .start:active{transform:translateY(1px) scale(.99);}
  `;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = "rl-menu";
  el.innerHTML = `
    <h1 class="ttl">RL Arena</h1>
    <div class="sub">Red vs Blue Tournament</div>
    <button class="start" type="button">&#9654;&nbsp; Start</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  let starting = false;
  el.querySelector(".start").addEventListener("click", () => {
    if (starting) return;
    starting = true;
    el.classList.remove("show");
    el.classList.add("out");
    setTimeout(() => {
      active = false;
      onStart?.();
    }, 650);
  });

  // ---- per-frame: a gentle cinematic camera drift ----------------------
  function update(dt, t) {
    if (!framed) return;
    const yaw = Math.sin(t * 0.15) * 0.08; // slow orbit around the target
    const dx = camPos.x - camTarget.x,
      dz = camPos.z - camTarget.z;
    const cos = Math.cos(yaw),
      sin = Math.sin(yaw);
    camera.position.set(
      camTarget.x + dx * cos - dz * sin,
      camPos.y + Math.sin(t * 0.11) * 0.12,
      camTarget.z + dx * sin + dz * cos,
    );
    camera.lookAt(camTarget);
  }

  function dispose() {
    disposed = true;
    scene.remove(group);
    scene.remove(menuLights);
    for (const [l, i] of dimmedLights) l.intensity = i;   // restore game daylight
    renderer.toneMappingExposure = prevExposure;
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose?.();
        m.dispose?.();
      }
    });
    if (actors?.group && prevActorsVisible !== null)
      actors.group.visible = prevActorsVisible;
    el.remove();
    style.remove();
  }

  return {
    get active() {
      return active;
    },
    update,
    dispose,
  };
}
