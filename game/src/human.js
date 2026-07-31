// HUMAN TAKEOVER: play Blue yourself instead of letting its algorithm play.
//
// The server already accepts Blue's action from outside (POST /api/control
// {cmd:"humanAction"}), holds it until the next post, and stops training Blue
// while a person is on the sticks. This module is the input half: it watches the
// keyboard, turns the currently-held keys into ONE action index for the round's
// action space, and posts only when that index actually changes (a keypress is
// an event, not a per-frame stream).
//
// SCREEN direction, not board direction. The grid sim thinks in (row, col) and
// the arenas in (dx, dz), but the player thinks in "up is up". Round 1's camera
// views the castle from the north (theme camera flip), so its board is mirrored
// on both axes and its key map has to invert - otherwise Left walks you right.

import { getTheme } from "./themes/index.js";

// grid rounds: 0=row-1, 1=row+1, 2=col-1, 3=col+1
const GRID_DIRS = { up: 0, down: 1, left: 2, right: 3 };
// continuous arenas: index into the engine's DIRS table, keyed by (dx,dz) with
// -z pointing up the screen. 8 = coast, and Round 5 adds 9 = use the weapon.
const ARENA_DIRS = {
  "0,-1": 0, "0,1": 1, "-1,0": 2, "1,0": 3,
  "-1,-1": 4, "1,-1": 5, "-1,1": 6, "1,1": 7, "0,0": 8,
};

const KEYS = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

// Deliberately the SAME badge design as the bottom-left key hints (#rl-keys in
// hud.js): 30x30 white squares, same radius / weight / shadow, same label type.
// The one difference is the entrance - this row is not always on screen, so it
// flies IN from off the right edge and is thrown back out the same way.
const STYLE = `
#rl-human{position:fixed;right:0.8vw;bottom:1.5vh;z-index:9;display:flex;flex-direction:row;
  align-items:center;gap:22px;color:#fff;pointer-events:none;
  font-family:"Segoe UI",system-ui,sans-serif;
  transform:translateX(calc(100% + 2.5vw));            /* parked off-screen right */
  transition:transform .4s cubic-bezier(.55,0,.85,.32);} /* thrown OUT, accelerating */
#rl-human.on{transform:translateX(0);
  transition:transform .52s cubic-bezier(.18,.86,.28,1.02);} /* flies IN, settling */
#rl-human .hu-grp{display:flex;align-items:center;gap:6px;}
#rl-human .hu-k{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;
  box-sizing:border-box;padding:0 8px;border-radius:8px;background:#fff;color:#1a1a1a;font-weight:800;
  font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:background .1s,color .1s;}
#rl-human .hu-k.down{background:#ffd23f;color:#1a1207;}
#rl-human .hu-txt{margin-left:3px;font-weight:800;font-size:14.5px;letter-spacing:.2px;
  text-shadow:0 1px 2px rgba(0,0,0,.38);}
`;

export function initHuman() {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = "rl-human";
  el.innerHTML =
    `<div class="hu-grp" id="hu-move"><span class="hu-k" data-k="up">W</span>` +
    `<span class="hu-k" data-k="left">A</span><span class="hu-k" data-k="down">S</span>` +
    `<span class="hu-k" data-k="right">D</span>` +
    `<span class="hu-txt">Move</span></div>` +
    `<div class="hu-grp" id="hu-use" hidden><span class="hu-k" data-k="use">SPACE</span>` +
    `<span class="hu-txt">Fire</span></div>`;
  document.body.appendChild(el);
  const useGrp = el.querySelector("#hu-use");
  const keyEls = [...el.querySelectorAll(".hu-k")];

  // ---- state -------------------------------------------------------------
  // held directions in PRESS ORDER, so the newest wins on a grid round and any
  // two of them combine into a diagonal in an arena
  let held = [];
  let useHeld = false;
  let mode = { on: false, kind: "grid", nActions: 4, stay: 4, useAction: null };
  let flip = false;         // this round's camera views the board from behind
  let sent = null;          // last action posted, so we only post on change
  let sentOn = false;       // whether the server currently thinks a key is held

  function setWorld(world) {
    // read the round's camera off its theme: only a flipped camera changes what
    // "up" means on screen
    flip = !!getTheme(world?.theme)?.camera?.flip;
  }

  function actionFor() {
    if (mode.kind === "arena") {
      if (useHeld && mode.useAction != null) return mode.useAction;
      let dx = 0, dz = 0;
      // the LAST press on each axis wins, so rolling from left to right turns
      // cleanly instead of cancelling out to a coast
      for (const d of held) {
        if (d === "left") dx = -1;
        else if (d === "right") dx = 1;
        else if (d === "up") dz = -1;
        else if (d === "down") dz = 1;
      }
      if (flip) { dx = -dx; dz = -dz; }
      return ARENA_DIRS[`${dx},${dz}`] ?? mode.stay;
    }
    if (!held.length) return null;              // null = let go -> hold position
    let d = held[held.length - 1];
    if (flip) {
      d = { up: "down", down: "up", left: "right", right: "left" }[d];
    }
    return GRID_DIRS[d];
  }

  function push() {
    const a = actionFor();
    // nothing held resolves to the round's own idle (coast / stay) server-side,
    // so an arena and a grid both settle to "not moving" through one null post
    const next = a == null ? null : a;
    if (next === sent && sentOn) return;
    sent = next;
    sentOn = true;
    window.RL?.control?.({ cmd: "humanAction", value: next });
  }

  function paintKeys() {
    for (const k of keyEls) {
      const key = k.dataset.k;
      const on = key === "use" ? useHeld : held.includes(key);
      k.classList.toggle("down", on);
    }
  }

  function releaseAll() {
    if (!held.length && !useHeld) return;
    held = [];
    useHeld = false;
    paintKeys();
    push();
  }

  const typing = (t) => /input|select|textarea/i.test(t?.tagName || "");

  window.addEventListener("keydown", (e) => {
    if (!mode.on || typing(e.target) || e.repeat) return;
    if (e.code === "Space" && mode.useAction != null) {
      e.preventDefault();
      useHeld = true;
      paintKeys();
      push();
      return;
    }
    const d = KEYS[e.code];
    if (!d) return;
    e.preventDefault();                 // arrows would scroll the page
    if (!held.includes(d)) held.push(d);
    paintKeys();
    push();
  });

  window.addEventListener("keyup", (e) => {
    if (!mode.on) return;
    if (e.code === "Space") {
      if (!useHeld) return;
      useHeld = false;
      paintKeys();
      push();
      return;
    }
    const d = KEYS[e.code];
    if (!d) return;
    held = held.filter((x) => x !== d);
    paintKeys();
    push();
  });

  // alt-tabbing away must not leave you sprinting into a wall forever
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });

  window.addEventListener("rl-snapshot", (e) => {
    const h = e.detail?.stats?.human;
    if (!h) return;
    // While the start menu is up it display:none's this row (see startmenu.js).
    // Don't re-arm behind it: the live poll is stopped then, but a late snapshot
    // would otherwise leave the row already on when the menu hands the UI back,
    // so it would snap into place instead of flying in.
    if (el.style.display === "none") return;
    const was = mode.on;
    mode = {
      on: !!h.on,
      kind: h.kind || "grid",
      nActions: h.nActions || 4,
      stay: h.stay,
      useAction: h.useAction ?? null,
    };
    el.classList.toggle("on", mode.on);
    if (useGrp.hidden === (mode.useAction != null))
      useGrp.hidden = mode.useAction == null;   // guarded: this repaints at 30Hz
    if (was && !mode.on) releaseAll();
    if (!was && mode.on) {
      // taking over mid-round: start from a clean, standing-still state
      held = [];
      useHeld = false;
      sent = null;
      sentOn = false;
      paintKeys();
      push();
    }
  });

  return {
    setWorld,
    active: () => mode.on,
    // Leaving for the start menu: forget everything and drop the row back to its
    // parked state. The menu also display:none's it, and the poll that would
    // normally retract it has stopped - without this the next Start would snap it
    // straight onto the screen instead of flying it back in.
    retract() {
      held = [];
      useHeld = false;
      sent = null;
      sentOn = false;
      mode.on = false;
      paintKeys();
      el.classList.remove("on");
    },
  };
}
