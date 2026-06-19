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
const CAM_BACK = 0.05; // camera distance from the open FRONT, as a fraction of room depth (neg = outside, further back)
const CAM_H = 0.32; // camera height, as a fraction of room height
const LOOK_BACK = 0.15; // look-at distance from the BACK (window) wall, fraction of depth
const LOOK_H = 0.1; // look-at height (lower = camera angles down), fraction of height

// --- chair placement knobs (two armchairs in the back corners, angled inward) -
const CHAIR_X = 90.0; // horizontal offset from centre, in chair-widths (left/right)
const CHAIR_BACK = 90.0; // how far back toward the window, in chair-depths
const CHAIR_ANGLE = Math.PI / 4; // turn-in angle toward the centre/camera

export function createStartMenu({
  scene,
  camera,
  renderer,
  actors,
  heatmap,
  fx,
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

  // hide the game HUD (Blue/Red/round), the control panel + its tab, and the edge
  // vignette so the menu is clean. All restored in dispose().
  const hiddenEls = [];
  for (const id of ["rl-hud", "rl-panel", "rl-tab"]) {
    const el = document.getElementById(id);
    if (el) {
      hiddenEls.push([el, el.style.display]);
      el.style.display = "none";
    }
  }
  fx?.setVignette?.(false);

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
  renderer.toneMappingExposure = 1.1;
  // gentle, NORMAL scene glow: low strength + high threshold so only the very
  // brightest background (the window) blooms a little — books never glow. Reset in
  // dispose().
  fx?.setBloom?.({ strength: 0.2, radius: 0.7, threshold: 0.42 });

  // ---- alive, game-y lighting: a warm KEY with real shadows + a cool RIM for
  // colour contrast + a warm/cool hemisphere. Positioned to the room in frame(),
  // gently animated in update() so the scene breathes instead of sitting flat.
  const KEY_I = 2.5,
    RIM_I = 1.0;
  const menuLights = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xfdf4ec, 0x2a3a50, 1.25); // neutral sky / cool floor
  menuLights.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2e2, KEY_I); // near-white key (casts shadows)
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  menuLights.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x56a6ff, RIM_I); // cool complementary rim
  menuLights.add(rim, rim.target);
  const fill = new THREE.DirectionalLight(0xfff0e6, 0.75); // soft neutral front fill
  menuLights.add(fill, fill.target);
  scene.add(menuLights);

  // camera framing, computed once the room's bounds are known
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  let framed = false;

  // fly-through-the-window state (kicked off by Start)
  let flying = false;
  let flyU = 0;
  let hasWindow = false;
  const flyStart = new THREE.Vector3();
  const flyEnd = new THREE.Vector3();
  const flyLook = new THREE.Vector3();
  const flyThrough = new THREE.Vector3(); // the window centre (set when the sky plane is built)
  const FLY_DUR = 1.0; // seconds (synced to the iris close)

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
    // place the lights relative to the room + size the key's shadow to cover it
    const cz = (min.z + max.z) / 2;
    const S = Math.max(max.x - min.x, H, D);
    const lc = new THREE.Vector3(cx, min.y + H * 0.55, cz);
    key.position.set(lc.x + S * 0.55, lc.y + S * 0.85, lc.z + S * 0.6);
    key.target.position.copy(lc);
    const sc = key.shadow.camera;
    sc.left = -S * 0.75;
    sc.right = S * 0.75;
    sc.top = S * 0.75;
    sc.bottom = -S * 0.75;
    sc.near = S * 0.05;
    sc.far = S * 3.5;
    sc.updateProjectionMatrix();
    key.shadow.bias = -0.0006;
    rim.position.set(lc.x - S * 0.7, lc.y + S * 0.45, lc.z - S * 0.8);
    rim.target.position.copy(lc);
    fill.position.set(lc.x, lc.y + S * 0.25, lc.z + S * 1.1);
    fill.target.position.copy(lc);
    // camera sits inside the room near the open FRONT (max.z), looking back + up
    // at the round window on the BACK wall (min.z)
    camTarget.set(cx, min.y + LOOK_H * H, min.z + LOOK_BACK * D);
    camPos.set(cx, min.y + CAM_H * H, max.z - CAM_BACK * D);
    camera.near = 0.1;
    camera.far = Math.max(camera.far, D * 8);
    camera.updateProjectionMatrix();
    framed = true;
  }

  // a generated sky for the porthole (its own texture is blank white): an
  // atmospheric blue gradient with soft FRACTAL-NOISE clouds (layered value noise,
  // not blobs) so it reads like a real sky.
  function skyCanvas() {
    const S = 384;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d");
    const hash = (i, j, s) => {
      let h = (i * 374761393 + j * 668265263 + s * 1442695040) & 0x7fffffff;
      h = ((h ^ (h >> 13)) * 1274126177) & 0x7fffffff;
      return (h & 0xffff) / 0xffff;
    };
    const vnoise = (x, y, s) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
      const e = hash(xi, yi + 1, s), f = hash(xi + 1, yi + 1, s);
      return a + (b - a) * u + (e - a) * v + (a - b - e + f) * u * v;
    };
    const fbm = (x, y) => {
      let val = 0, amp = 0.5, fr = 1;
      for (let i = 0; i < 5; i++) { val += amp * vnoise(x * fr, y * fr, i * 131); fr *= 2; amp *= 0.5; }
      return val;
    };
    const sstep = (a, b, x) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      const t = y / S; // 0 = zenith (deep blue), 1 = horizon (pale)
      const r0 = 26 + (104 - 26) * t, g0 = 92 + (166 - 92) * t, b0 = 204 + (230 - 204) * t;
      for (let x = 0; x < S; x++) {
        const n = fbm(x / 95, y / 52); // clouds wider than tall
        const cov = sstep(0.5, 0.72, n) * (0.4 + 0.6 * t); // more cloud toward the horizon
        const i = (y * S + x) * 4;
        d[i] = r0 * (1 - cov) + 255 * cov;
        d[i + 1] = g0 * (1 - cov) + 253 * cov;
        d[i + 2] = b0 * (1 - cov) + 250 * cov;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const skyTex = new THREE.CanvasTexture(skyCanvas());
  skyTex.colorSpace = THREE.SRGBColorSpace;

  function tune(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // the porthole "glass" uses a blank white texture -> swap it for the sky
      const isWindow = mats.some((m) =>
        /window/i.test(m?.map?.image?.src || m?.map?.name || m?.name || ""),
      );
      if (isWindow) {
        // the window mesh's UVs smear a flat texture into vertical stripes -> hide
        // it and place a clean flat sky plane right behind the porthole instead
        o.updateWorldMatrix(true, false);
        const box = new THREE.Box3().setFromObject(o);
        const ctr = box.getCenter(new THREE.Vector3());
        const sz = box.getSize(new THREE.Vector3());
        o.visible = false;
        const w = Math.max(sz.x, sz.y) * 1.2;
        const sky = new THREE.Mesh(
          new THREE.PlaneGeometry(w, w),
          new THREE.MeshBasicMaterial({
            map: skyTex,
            side: THREE.DoubleSide,
            fog: false,
          }),
        );
        sky.position.set(ctr.x, ctr.y, ctr.z - Math.max(sz.z, w * 0.04));
        group.add(sky);
        // remember the porthole so Start flies the camera UP-and-OUT through it
        // (not straight into the low wall point the menu camera looks at)
        flyThrough.copy(ctr);
        hasWindow = true;
        return;
      }
      for (const m of mats) {
        if (!m) continue;
        if (m.map) {
          // tile mirrored HORIZONTALLY only (left-right flip on each repeat) so the
          // panels line up; vertical stays a normal repeat (no up/down flip)
          m.map.wrapS = THREE.MirroredRepeatWrapping;
          m.map.wrapT = THREE.RepeatWrapping;
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.anisotropy = maxAniso;
          m.map.needsUpdate = true;
          // the bright book pages otherwise dominate the bloom -> knock the paper
          // (open book + map) material down so the scene glow doesn't fixate on it
          const src = m.map.image?.src || m.map.name || m.name || "";
          if (/paper/i.test(src)) m.color?.set?.(0x8a8a8a);
        }
        if ("shininess" in m) m.shininess = Math.min(m.shininess || 20, 12);
      }
    });
  }

  function load(name, onReady, side) {
    collada
      .loadAsync(ASSETS + name)
      .then((asset) => {
        if (disposed) return;
        const root = asset.scene;
        tune(root);
        if (side) {
          // both chairs are modelled on the same centred spot (they overlap into
          // one in the table). Recentre each on its own X/Z axis (keep Y so it
          // stays on the floor), then push it back + out to a corner, angled inward.
          const box = new THREE.Box3().setFromObject(root);
          const c = box.getCenter(new THREE.Vector3());
          const sz = box.getSize(new THREE.Vector3());
          root.position.set(-c.x, 0, -c.z);
          const wrap = new THREE.Group();
          wrap.add(root);
          wrap.rotation.y = -side * CHAIR_ANGLE; // left turns right, right turns left
          wrap.position.set(
            c.x + side * CHAIR_X * sz.x, // left (-1) / right (+1)
            0,
            c.z - CHAIR_BACK * sz.z, // back toward the window
          );
          group.add(wrap);
        } else {
          group.add(root);
        }
        onReady?.(root);
      })
      .catch((e) => console.warn("start menu: could not load", name, e));
  }

  load("HomeInside.dae", (room) => frame(room));
  load("HomeChairL.dae", null, -1);
  load("HomeChairR.dae", null, +1);

  // ---- DOM overlay -----------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    #rl-menu{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;
      align-items:flex-start;justify-content:flex-end;padding:0 0 20vh 6vw;pointer-events:none;
      perspective:1600px;font-family:"Segoe UI",system-ui,sans-serif;opacity:0;transition:opacity .9s ease;}
    #rl-menu .panel{display:flex;flex-direction:column;align-items:flex-start;
      transform-origin:left center;transform:rotateY(32deg);
      backface-visibility:hidden;-webkit-backface-visibility:hidden;will-change:transform;}
    #rl-menu.show{opacity:1;}
    #rl-menu.out{opacity:0;transition:opacity .5s ease;}
    #rl-menu .brand{position:absolute;top:2vh;left:2vw;margin:0;}
    #rl-menu .brand img{display:block;width:340px;height:auto;
      filter:drop-shadow(0 8px 20px rgba(0,0,0,.55));}
    #rl-menu .items{display:flex;flex-direction:column;align-items:flex-start;gap:13px;}
    #rl-menu .item{pointer-events:auto;cursor:pointer;border:none;background:none;text-align:left;
      display:flex;align-items:center;gap:16px;padding:9px 12px;opacity:.9;
      font:800 40px "Segoe UI",system-ui,sans-serif;color:#fff;
      text-shadow:0 2px 12px rgba(0,0,0,.55);transition:transform .16s ease,opacity .16s ease;}
    #rl-menu .item:nth-child(n+2){font-size:33px;opacity:.8;}
    #rl-menu .item .cap{width:0;height:44px;overflow:hidden;flex:none;transition:width .18s ease;}
    #rl-menu .item.sel{background:#fff;color:#3a3a3a;border-radius:8px;min-width:440px;
      box-sizing:border-box;padding:16px 84px 16px 20px;transform:rotate(-1.7deg);opacity:1;
      text-shadow:none;box-shadow:0 16px 40px rgba(0,0,0,.34);font-size:44px;}
    #rl-menu .item.sel .cap{width:62px;}
  `;
  document.head.appendChild(style);

  const CAP = `<svg class="cap" viewBox="0 0 120 80" aria-hidden="true">
    <path fill="#e8352b" d="M36 52C36 26 56 12 78 17C97 21 106 36 106 52C106 56 103 58 98 58L46 58C40 58 36 56 36 52Z"/>
    <path fill="#e8352b" d="M16 57C7 52 12 41 29 45C47 49 55 54 55 58C55 63 46 64 35 63C26 62 20 60 16 57Z"/>
    <circle cx="70" cy="30" r="8.5" fill="#fff"/></svg>`;

  const el = document.createElement("div");
  el.id = "rl-menu";
  el.innerHTML = `
    <div class="brand"><img src="./assets/ui/rival-minds-logo.png" alt="Rival Minds"></div>
    <div class="panel">
      <div class="items">
        <button class="item sel" type="button" data-go="1">${CAP}Start</button>
        <button class="item" type="button">${CAP}How It Works</button>
        <button class="item" type="button">${CAP}Algorithms</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  // ---- Mario-style iris wipe: a circular transparent hole in a full-screen black
  // (a big box-shadow). Shrinking the circle to 0 = fades to black; growing it back
  // = reveals the scene. Starts fully open (no black).
  const iris = document.createElement("div");
  const diag = Math.ceil(Math.hypot(window.innerWidth, window.innerHeight) * 1.3);
  const setIris = (dpx) => {
    iris.style.width = iris.style.height = dpx + "px";
    iris.style.margin = `${-dpx / 2}px 0 0 ${-dpx / 2}px`;
  };
  iris.style.cssText =
    "position:fixed;top:50%;left:50%;border-radius:50%;pointer-events:none;z-index:100;" +
    `width:${diag}px;height:${diag}px;margin:${-diag / 2}px 0 0 ${-diag / 2}px;` +
    `box-shadow:0 0 0 ${diag}px #000;` +
    "transition:width 1s cubic-bezier(.66,0,.34,1),height 1s cubic-bezier(.66,0,.34,1),margin 1s cubic-bezier(.66,0,.34,1);";
  document.body.appendChild(iris);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let starting = false;
  async function runStart() {
    if (starting) return;
    starting = true;
    el.classList.remove("show");
    el.classList.add("out"); // fade the title card

    // 1) fly the camera UP through the porthole and OUT into the sky while the iris
    // closes. Aim at the window centre (not the low wall point), and keep looking
    // forward PAST the window so it reads as exiting, not stopping at the glass.
    flying = true;
    flyU = 0;
    flyStart.copy(camera.position);
    const tgt = hasWindow ? flyThrough : camTarget;
    const dir = tgt.clone().sub(flyStart);
    flyEnd.copy(flyStart).addScaledVector(dir, 1.05); // up to the porthole/sky (black hits here)
    flyLook.copy(flyStart).addScaledVector(dir, 3.0); // look forward, out through the window
    requestAnimationFrame(() => setIris(0)); // close to black (next frame so it animates)
    await wait(1040);

    // 2) fully black: tear the menu down, let the game render (still hidden by black)
    teardown();
    active = false;

    // 3) boot the match and WAIT until the scene is fully loaded (no pop-in)
    await onStart?.();

    // 4) iris-open onto the finished game
    setIris(diag);
    await wait(1020);
    iris.remove();
  }
  // hovering an item slides the white pill onto it; clicking "Start" launches
  const items = [...el.querySelectorAll(".item")];
  const itemsBox = el.querySelector(".items");
  let selected = items[0];
  function select(it) {
    if (it === selected) return;
    selected = it;
    for (const x of items) x.classList.toggle("sel", x === it);
  }
  // move the pill to whichever item the cursor is vertically nearest, so it flips
  // at the midpoint between items — the selection heads to the next one as soon as
  // you move toward it, not only once you're fully over it
  function onMove(e) {
    if (starting || disposed) return;
    const box = itemsBox.getBoundingClientRect();
    if (
      e.clientX < box.left - 140 || e.clientX > box.right + 180 ||
      e.clientY < box.top - 60 || e.clientY > box.bottom + 60
    )
      return;
    let best = selected,
      bestD = Infinity;
    for (const it of items) {
      const r = it.getBoundingClientRect();
      const d = Math.abs(e.clientY - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    select(best);
  }
  window.addEventListener("mousemove", onMove);
  for (const it of items) {
    it.addEventListener("click", () => {
      select(it);
      if (it.dataset.go) runStart();
    });
  }

  // ---- per-frame: a gentle cinematic camera drift ----------------------
  function update(dt, t) {
    if (!framed) return;
    if (flying) {
      // accelerate forward through the porthole, looking out into the sky. Ease the
      // look target from the menu's camTarget out to flyLook so the view doesn't
      // snap/rotate on the first frame (start matches where the drift left off).
      flyU = Math.min(1, flyU + dt / FLY_DUR);
      camera.position.lerpVectors(flyStart, flyEnd, flyU * flyU);
      camera.lookAt(
        camTarget.x + (flyLook.x - camTarget.x) * flyU,
        camTarget.y + (flyLook.y - camTarget.y) * flyU,
        camTarget.z + (flyLook.z - camTarget.z) * flyU,
      );
      return;
    }
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

  // tear down the cabin + restore the game's render state (NOT the iris, which the
  // transition removes once the scene is revealed)
  function teardown() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("mousemove", onMove);
    scene.remove(group);
    scene.remove(menuLights);
    for (const [l, i] of dimmedLights) l.intensity = i; // restore game daylight
    renderer.toneMappingExposure = prevExposure;
    fx?.setBloom?.(); // reset bloom to default (the round's theme re-sets it anyway)
    fx?.setVignette?.(true); // restore the edge vignette for the game
    for (const [hel, d] of hiddenEls) hel.style.display = d; // restore HUD + panel
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

  function dispose() {
    teardown();
    iris.remove();
  }

  return {
    get active() {
      return active;
    },
    update,
    dispose,
  };
}
