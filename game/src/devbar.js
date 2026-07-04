// Dev tools bar - press I to slide a row of developer tools up from the bottom
// of the screen (styled like the M/N side panels). Everything here is for scene
// tuning, not gameplay:
//
//   INSPECT   click any mesh -> name + world/local coords in the readout+console
//   ROTATE    click an object to select its top-level wrap, then rotate it with
//             the on-bar buttons (or , and . keys) - the readout shows the ry
//             value to paste into the theme code
//   FREE CAM  fly the camera: WASD move, Q/E down/up, drag the mouse to look,
//             Shift = fast. The game rig is suspended while it's on
//   COPY CAM  copy the camera position (+ a look-at guess) to the clipboard
//
// main.js: const devbar = initDevBar({...}); and in the render loop call
// devbar.updateFreecam(dt) INSTEAD of rig.update(dt) while devbar.freecamActive().

import * as THREE from "three";

const STYLE = `
#rl-devbar{position:fixed;left:50%;bottom:14px;transform:translate(-50%,140%);z-index:40;
  display:flex;align-items:center;gap:8px;padding:10px 12px;
  background:#fff;border:1px solid #d7dade;border-radius:12px;
  box-shadow:0 10px 30px rgba(20,22,30,.18);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  transition:transform .28s cubic-bezier(.2,.9,.25,1);}
#rl-devbar.show{transform:translate(-50%,0);}
#rl-devbar .tag{font-size:10px;font-weight:800;letter-spacing:2px;color:#a2a5ac;
  text-transform:uppercase;margin-right:2px;}
#rl-devbar button{padding:8px 12px;border:1px solid #d7dade;border-radius:9px;background:#fff;
  color:#26272b;font:inherit;font-size:12px;font-weight:600;cursor:pointer;outline:none;
  transition:background .12s,border-color .12s,color .12s;white-space:nowrap;}
#rl-devbar button:focus,#rl-devbar button:focus-visible{outline:none;box-shadow:none;}
#rl-devbar button:hover{background:#f0f1f3;}
#rl-devbar button.active{background:#1f5fd0;border-color:#1a52b8;color:#fff;}
#rl-devbar .rot{display:none;gap:4px;}
#rl-devbar .rot.show{display:flex;}
#rl-devbar .rot button{padding:8px 8px;}
#rl-devbar .readout{max-width:430px;min-width:120px;font:11px/1.45 Consolas,Menlo,monospace;
  color:#26272b;background:#f4f5f7;border:1px solid #e4e6ea;border-radius:8px;
  padding:6px 9px;white-space:pre;overflow:hidden;text-overflow:ellipsis;cursor:copy;}
#rl-devbar .readout:hover{background:#eef0f3;}
`;

export function initDevBar({ scene, camera, renderer, rig }) {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.id = "rl-devbar";
  bar.innerHTML = `
    <span class="tag">Dev</span>
    <button id="rl-dev-inspect">&#128269; Inspect</button>
    <button id="rl-dev-rotate">&#8635; Rotate</button>
    <span class="rot" id="rl-dev-rotbtns">
      <button data-deg="-45">-45&deg;</button>
      <button data-deg="-5">-5&deg;</button>
      <button data-deg="5">+5&deg;</button>
      <button data-deg="45">+45&deg;</button>
    </span>
    <button id="rl-dev-fly">&#9992; Free cam</button>
    <button id="rl-dev-copycam">&#128247; Copy cam</button>
    <span class="readout" id="rl-dev-readout" title="click to copy">press a tool...</span>`;
  document.body.appendChild(bar);

  const $ = (id) => bar.querySelector(id);
  const btnInspect = $("#rl-dev-inspect");
  const btnRotate = $("#rl-dev-rotate");
  const rotBtns = $("#rl-dev-rotbtns");
  const btnFly = $("#rl-dev-fly");
  const btnCopy = $("#rl-dev-copycam");
  const readout = $("#rl-dev-readout");

  let open = false;
  let mode = null; // 'inspect' | 'rotate' | null
  let selected = null; // rotate-mode selection (top-level wrap/mesh)
  let flying = false;

  const say = (text) => {
    readout.textContent = text;
  };
  readout.addEventListener("click", () => {
    navigator.clipboard?.writeText(readout.textContent).then(() => {
      const t = readout.textContent;
      say("copied!");
      setTimeout(() => say(t), 500);
    });
  });

  function setMode(next) {
    mode = mode === next ? null : next;
    btnInspect.classList.toggle("active", mode === "inspect");
    btnRotate.classList.toggle("active", mode === "rotate");
    rotBtns.classList.toggle("show", mode === "rotate");
    if (mode === "inspect") say("inspect: click a mesh");
    else if (mode === "rotate") say("rotate: click an object to select");
  }
  btnInspect.addEventListener("click", () => setMode("inspect"));
  btnRotate.addEventListener("click", () => setMode("rotate"));

  // ---- raycast helpers ----------------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function hitsAt(e) {
    ndc.x = (e.clientX / innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    return ray
      .intersectObjects(scene.children, true)
      .filter((h) => h.object.isMesh && h.object.visible);
  }
  // walk up to the node sitting directly inside the theme's root group - for
  // placed models that's the wrap Group (what the code positions/rotates)
  function topWrap(obj) {
    let o = obj;
    while (o.parent && o.parent.parent && o.parent.parent !== scene) o = o.parent;
    return o;
  }

  renderer.domElement.addEventListener("click", (e) => {
    if (!open || !mode) return;
    const hits = hitsAt(e);
    if (!hits.length) {
      say("(no hit)");
      return;
    }
    if (mode === "inspect") {
      const h = hits[0];
      const lp = h.object.worldToLocal(h.point.clone());
      say(
        `${h.object.name || "(unnamed)"}\n` +
          `world (${h.point.x.toFixed(1)}, ${h.point.y.toFixed(1)}, ${h.point.z.toFixed(1)})  dist ${h.distance.toFixed(1)}\n` +
          `local (${lp.x.toFixed(0)}, ${lp.y.toFixed(0)}, ${lp.z.toFixed(0)})`,
      );
      console.log("--- INSPECT: meshes under cursor (nearest first) ---");
      for (const hh of hits.slice(0, 6)) {
        const l = hh.object.worldToLocal(hh.point.clone());
        console.log(
          `${hh.object.name || "(unnamed)"}  dist=${hh.distance.toFixed(1)}  ` +
            `local=(${l.x.toFixed(0)}, ${l.y.toFixed(0)}, ${l.z.toFixed(0)})  ` +
            `world=(${hh.point.x.toFixed(1)}, ${hh.point.y.toFixed(1)}, ${hh.point.z.toFixed(1)})`,
        );
      }
    } else if (mode === "rotate") {
      selected = topWrap(hits[0].object);
      sayRotation();
    }
  });

  function sayRotation() {
    if (!selected) return;
    const ryRad = selected.rotation.y;
    const p = selected.position;
    say(
      `${selected.name || hits0Name(selected)}\n` +
        `ry: ${ryRad.toFixed(2)} rad (${((ryRad * 180) / Math.PI).toFixed(1)}deg)\n` +
        `pos (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`,
    );
  }
  function hits0Name(o) {
    let n = null;
    o.traverse((c) => {
      if (!n && c.isMesh && c.name) n = c.name;
    });
    return n || o.type;
  }
  function rotateSelected(deg) {
    if (!selected) {
      say("rotate: click an object first");
      return;
    }
    selected.rotation.y += (deg * Math.PI) / 180;
    sayRotation();
  }
  rotBtns.addEventListener("click", (e) => {
    const d = e.target?.dataset?.deg;
    if (d) rotateSelected(parseFloat(d));
  });

  // ---- free camera ---------------------------------------------------------
  const savedCam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  let yaw = 0;
  let pitch = 0;
  const keys = new Set();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function setFly(on) {
    flying = on;
    btnFly.classList.toggle("active", on);
    if (on) {
      savedCam.pos.copy(camera.position);
      savedCam.quat.copy(camera.quaternion);
      // current view direction -> yaw/pitch so there's no snap
      const dir = camera.getWorldDirection(new THREE.Vector3());
      yaw = Math.atan2(-dir.x, -dir.z);
      pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      say("free cam: WASD move, Q/E down/up, drag to look, Shift fast");
    } else {
      camera.position.copy(savedCam.pos);
      camera.quaternion.copy(savedCam.quat);
      say("free cam off (camera restored)");
    }
  }
  btnFly.addEventListener("click", () => setFly(!flying));

  window.addEventListener("keydown", (e) => {
    if (/input|select|textarea/i.test(e.target.tagName)) return;
    if (e.code === "KeyI") {
      open = !open;
      bar.classList.toggle("show", open);
      if (!open) {
        // leaving the bar shuts everything off cleanly
        if (flying) setFly(false);
        mode = null;
        btnInspect.classList.remove("active");
        btnRotate.classList.remove("active");
        rotBtns.classList.remove("show");
      }
      return;
    }
    if (!open) return;
    if (mode === "rotate") {
      if (e.code === "Comma") rotateSelected(-5);
      if (e.code === "Period") rotateSelected(5);
    }
    if (flying) keys.add(e.code);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (!flying) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointermove", (e) => {
    if (!flying || !dragging) return;
    yaw -= (e.clientX - lastX) * 0.0032;
    pitch -= (e.clientY - lastY) * 0.0032;
    pitch = THREE.MathUtils.clamp(pitch, -1.5, 1.5);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => (dragging = false));

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  function updateFreecam(dt) {
    if (!flying) return;
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
    const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 36 : 12) * dt;
    camera.getWorldDirection(fwd);
    right.crossVectors(fwd, camera.up).normalize();
    if (keys.has("KeyW")) camera.position.addScaledVector(fwd, speed);
    if (keys.has("KeyS")) camera.position.addScaledVector(fwd, -speed);
    if (keys.has("KeyA")) camera.position.addScaledVector(right, -speed);
    if (keys.has("KeyD")) camera.position.addScaledVector(right, speed);
    if (keys.has("KeyQ")) camera.position.y -= speed;
    if (keys.has("KeyE")) camera.position.y += speed;
  }

  btnCopy.addEventListener("click", () => {
    const p = camera.position;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const t = p.clone().addScaledVector(dir, 12); // a look-at guess 12 units out
    const text =
      `pos (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})  ` +
      `target~ (${t.x.toFixed(1)}, ${t.y.toFixed(1)}, ${t.z.toFixed(1)})`;
    navigator.clipboard?.writeText(text);
    say(text + "\n(copied)");
    console.log("CAMERA", text);
  });

  return {
    freecamActive: () => flying,
    updateFreecam,
  };
}
