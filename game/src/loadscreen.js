// Mario-style boot loading screen.
//
// The white overlay + the Mario-cap sprite live in index.html so they paint from
// the very first frame - before three.js, the ES modules, or any asset has
// loaded. That is the whole point of a loading screen, and it's why the cap is a
// CSS sprite strip (ripped from Odyssey's screen transitions), not a 3D model
// that would itself need loading.
//
// This module DRIVES the reveal from JS (one rAF loop) so it's a precise,
// snap-free sequence the way the user asked for it:
//
//   1. SPIN - the cap tumbles (frames stepped in JS) while main.js loads assets.
//   2. LAND - finish() eases the tumble to a stop on the default frame (frame 0,
//             cap facing front). No snap: it decelerates onto a whole rotation.
//   3. FADE - the hat stays put and the scene FADES IN inside the black of the
//             cap (a black cap layer, #capfade, fades its opacity 1->0 while the
//             white already has a cap-shaped hole to the scene beneath it).
//   4. GROW - then the cap (now a scene window) GROWS until the white is gone.
//
// The hole + the black cap use the SAME cap-solid.png and the SAME --hole (set on
// :root), so they're pixel-aligned; the black just fades off the top of the hole.

const N = 8; // sprite frames
const CELL_VMIN = 42.2; // one cell width, matches #capwin / #capstrip cell
const SPIN_MS = 55; // ms per frame while tumbling (fast = fluid)
const HANDOFF_HOLE = 36; // vmin: cap-hole size at the landed hat (~the sprite cap)
const FULL_HOLE = 760; // vmin: cap-hole big enough to clear any screen
const FADE_MS = 440; // black cap -> scene, at hat size
const GROW_MS = 720; // hat -> full screen

const easeIn = (p) => p * p;
const easeOut = (p) => 1 - (1 - p) * (1 - p);
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

export function createLoadScreen() {
  const root = document.documentElement;
  const el = document.getElementById("loadscreen");
  const win = document.getElementById("capwin");
  const strip = document.getElementById("capstrip");
  const fade = document.getElementById("capfade");
  if (!el || !win || !strip) return { finish: () => Promise.resolve() };

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // take over the frames from the CSS cold-start spin (index.html). Driving them
  // from JS is what lets finish() decelerate and land exactly on frame 0.
  strip.style.animation = "none";

  let raf = 0;
  let gone = false;
  let resolveDone = null;
  let phase = "spin";

  // timers (ms, performance.now based)
  let spinBase = performance.now(); // frame 0 origin for the tumble
  let landFrom = 0;
  let landTo = 0;
  let landStart = 0;
  let landDur = 0;
  let fadeStart = 0;
  let growStart = 0;

  const showFrame = (f) => {
    const fr = ((Math.floor(f) % N) + N) % N;
    strip.style.transform = `translate3d(${-fr * CELL_VMIN}vmin, 0, 0)`;
  };
  const setHole = (vmin) => root.style.setProperty("--hole", vmin + "vmin");

  const finishNow = () => {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(raf);
    if (el.parentNode) el.remove();
    if (fade && fade.parentNode) fade.remove();
    if (resolveDone) resolveDone();
  };

  const startReveal = (now) => {
    // hand off from the sprite to the mask: hide the tumbling sprite, open the
    // scene-hole at the landed hat size, and cover it with the opaque black cap -
    // so nothing visibly changes yet (still a black hat on white).
    setHole(HANDOFF_HOLE);
    el.classList.add("grow");
    if (fade) fade.style.opacity = "1";
    phase = "fade";
    fadeStart = now;
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();

    if (phase === "spin") {
      showFrame((now - spinBase) / SPIN_MS);
    } else if (phase === "land") {
      const p = Math.min(1, (now - landStart) / landDur);
      showFrame(landFrom + (landTo - landFrom) * easeOut(p));
      if (p >= 1) {
        showFrame(0); // default frame: cap facing front
        startReveal(now);
      }
    } else if (phase === "fade") {
      // hat stays at HANDOFF; the scene fades in inside the black of the cap
      const p = Math.min(1, (now - fadeStart) / FADE_MS);
      if (fade) fade.style.opacity = String(1 - easeInOut(p));
      if (p >= 1) {
        if (fade) fade.style.opacity = "0";
        phase = "grow";
        growStart = now;
      }
    } else if (phase === "grow") {
      // the cap (now a scene window) grows until the white is gone
      const p = Math.min(1, (now - growStart) / GROW_MS);
      setHole(HANDOFF_HOLE + (FULL_HOLE - HANDOFF_HOLE) * easeIn(p));
      if (p >= 1) finishNow();
    }
  };
  raf = requestAnimationFrame(tick);

  return {
    // Called by main.js once the heavy assets are actually loaded. Lands the
    // tumble on the default frame, fades the scene in inside the black cap, then
    // grows the cap to reveal the scene. Resolves when the overlay is gone.
    finish() {
      if (gone || phase !== "spin") return Promise.resolve();
      if (reduced) {
        finishNow();
        return Promise.resolve();
      }
      const cur = (performance.now() - spinBase) / SPIN_MS;
      let to = Math.ceil(cur / N) * N; // next time the cap faces front
      if (to - cur < N * 0.5) to += N; // guarantee at least half a turn to land
      landFrom = cur;
      landTo = to;
      landDur = (to - cur) * SPIN_MS * 1.7; // ease the tumble to a stop
      landStart = performance.now();
      phase = "land";
      return new Promise((resolve) => (resolveDone = resolve));
    },
  };
}
