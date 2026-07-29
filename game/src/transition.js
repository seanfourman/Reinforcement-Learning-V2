// Video-game arena transition. The SAME Mario-style iris wipe the start menu
// uses (a circular transparent hole in a full-screen black, shrunk to 0 = fade
// to black, grown back = reveal). Sequence:
//   1. iris closes to full black,
//   2. under black: onCovered() rebuilds the world + swaps the UI, and we AWAIT
//      it - so the black stays until EVERYTHING is loaded and settled,
//   3. the iris opens onto the fully-ready arena (no pop-in / lag),
//   4. THEN the level name (title + subtitle) fades up over the visible world.
//
// Pure DOM/CSS (independent of the three.js scene). play() is async and resolves
// only once the whole transition is done, so the caller can hold UI until then.
// Signature: play(worldJson, stats, onCovered) where onCovered is an async fn
// called at full black that must resolve when the new arena is ready.

import { getTheme } from "./themes/index.js";

const IRIS_MS = 1000; // iris close / open duration (matches the start-menu iris)
const NAME_LEAD = 150; // begin the name fade this long before the iris finishes opening
const HOLD_MS = 1500; // how long the level name sits fully readable over the world
const IRIS_EASE = "cubic-bezier(.66,0,.34,1)";

const STYLE = `
#rl-iris{position:fixed;top:50%;left:50%;border-radius:50%;pointer-events:none;z-index:60;
  background:transparent;}
/* a transparent full-screen shield that SWALLOWS clicks/hover while the iris covers
   the screen - the iris itself is pointer-events:none (its black is a box-shadow that
   never captures events), so without this the UI underneath stays clickable + shows a
   pointer cursor THROUGH the black. Only armed during a transition. */
#rl-iris-block{position:fixed;inset:0;z-index:65;background:transparent;pointer-events:none;}
#rl-iris-block.on{pointer-events:auto;cursor:default;}
#rl-iris-card{position:fixed;inset:0;z-index:66;pointer-events:none;display:flex;
  flex-direction:column;align-items:center;justify-content:center;text-align:center;
  opacity:0;transform:translateY(12px);
  transition:opacity .6s ease,transform .6s cubic-bezier(.2,.9,.2,1);color:#fff;
  /* a faint scrim so the name stays legible over a bright scene, fades with the card */
  background:radial-gradient(58% 42% at 50% 47%,rgba(0,0,0,.2),rgba(0,0,0,0) 72%);}
#rl-iris-card.show{opacity:1;transform:translateY(0);}
#rl-iris-card .ttl{font-family:Georgia,"Times New Roman",serif;font-weight:600;font-size:62px;
  letter-spacing:1px;margin:0;color:#fdfdff;
  text-shadow:0 0 18px rgba(150,180,255,.22),0 1px 5px rgba(0,0,0,.35);}
#rl-iris-card .sub{font-family:Georgia,serif;font-style:italic;font-size:20px;letter-spacing:3px;
  margin-top:14px;color:rgba(255,255,255,.82);text-shadow:0 1px 6px rgba(0,0,0,.4);}
#rl-iris-card .sub:empty{display:none;}
`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createTransition() {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  // the iris: a circle whose big black box-shadow fills the screen; shrinking the
  // circle to 0 closes to black, growing it past the screen reveals the scene
  const iris = document.createElement("div");
  iris.id = "rl-iris";
  document.body.appendChild(iris);

  // the click/hover shield (armed only while a transition is covering the screen)
  const block = document.createElement("div");
  block.id = "rl-iris-block";
  document.body.appendChild(block);
  const setBlock = (on) => block.classList.toggle("on", on);

  const card = document.createElement("div");
  card.id = "rl-iris-card";
  card.innerHTML = `<div class="ttl" id="rl-iris-ttl">Arena</div>
      <div class="sub" id="rl-iris-sub"></div>`;
  document.body.appendChild(card);

  const ttl = card.querySelector("#rl-iris-ttl");
  const sub = card.querySelector("#rl-iris-sub");

  const setIris = (dpx) => {
    iris.style.width = iris.style.height = dpx + "px";
    iris.style.margin = `${-dpx / 2}px 0 0 ${-dpx / 2}px`;
  };

  let busy = false;
  let nameTimer = null; // fire-and-forget timer for the level-name hold + fade-out

  // The iris is left fully open between transitions (its black ring parked off-screen).
  // If the window is enlarged while it sits open, that ring creeps back into the corners
  // - so re-fit it to the CURRENT viewport on resize. Skip while busy (a live transition
  // animates its own size) and before it has ever opened (no box-shadow yet = invisible).
  const refitIris = () => {
    if (busy || !iris.style.boxShadow) return;
    const diag = Math.ceil(
      Math.hypot(window.innerWidth, window.innerHeight) * 1.35,
    );
    const prev = iris.style.transition;
    iris.style.transition = "none";
    iris.style.boxShadow = `0 0 0 ${diag}px #000`;
    setIris(diag);
    void iris.offsetWidth; // reflow so the resize is instant, not animated
    iris.style.transition = prev;
  };
  window.addEventListener("resize", refitIris);

  // populate the level card TEXT (arena name + a short thematic subtitle). Does NOT
  // touch visibility - callers control when the card shows/hides so the text is only
  // ever changed while the card is hidden (never a visible swap over the old arena).
  function fillCard(worldJson, stats) {
    const r = (stats && stats.round) || {};
    ttl.textContent = worldJson.title || r.title || "Arena";
    const theme = getTheme(worldJson.theme);
    sub.textContent = (theme && theme.subtitle) || "";
  }

  // Show the level name over the CURRENT view (no iris), then fade it out. Used on
  // game ENTRY to announce the first level, which never goes through a round
  // transition (its scene is revealed by the start menu's own iris).
  function showName(worldJson, stats) {
    fillCard(worldJson, stats);
    requestAnimationFrame(() => {
      card.classList.add("show");
      setTimeout(() => card.classList.remove("show"), HOLD_MS + 400);
    });
  }

  async function play(worldJson, stats, onCovered) {
    // If a previous transition is still finishing, WAIT for it and then play THIS
    // one's iris - never skip the animation and swap the world instantly (the
    // "move to the next arena, then move again a second later and it just jumps
    // with no fade" bug). busy releases as soon as the world is REVEALED (the
    // level-name hold/fade runs on its own, below), so this wait stays short.
    const t0 = performance.now();
    while (busy && performance.now() - t0 < 12000) await wait(80);
    if (busy) {
      // safety valve: a genuinely stuck transition must not deadlock the next move
      await onCovered?.();
      return;
    }

    clearTimeout(nameTimer); // cancel a prior transition's still-pending name fade
    busy = true;
    setBlock(true); // swallow clicks/hover while the screen is covered
    // fade the CURRENT (old) level name out with ITS OWN text as we cover; the new
    // name's text is set later, UNDER BLACK, so it never visibly swaps on the old arena
    card.classList.remove("show");
    try {
      // circle big enough to clear the screen corners even after resize
      const diag = Math.ceil(
        Math.hypot(window.innerWidth, window.innerHeight) * 1.35,
      );

      // start fully OPEN (no black) with no animation, then enable the transition
      iris.style.transition = "none";
      iris.style.boxShadow = `0 0 0 ${diag}px #000`;
      setIris(diag);
      void iris.offsetWidth; // force reflow so the next change animates
      const t = `${IRIS_MS}ms ${IRIS_EASE}`;
      iris.style.transition = `width ${t},height ${t},margin ${t}`;

      // 1) close to black
      requestAnimationFrame(() => setIris(0));
      await wait(IRIS_MS + 60); // wait until FULLY black

      // now that the screen is black, set the NEW arena's name text - so it never
      // visibly swaps on top of the old arena before the iris covered it
      fillCard(worldJson, stats);

      // 2) under black: rebuild the arena + swap the UI, and WAIT until it's all
      // loaded and settled (onCovered resolves only when everything's ready).
      // Even if the rebuild THROWS, the iris must reopen - a swallowed error
      // here used to strand the screen on black forever.
      try {
        await onCovered?.();
      } finally {
        // 3) open the iris onto the (hopefully) ready world (still no text)
        setIris(diag);
      }
      await wait(Math.max(0, IRIS_MS - NAME_LEAD));

      // 4) once the world is visible, fade the level name up OVER it
      card.classList.add("show");
    } finally {
      busy = false; // released as soon as the world is revealed
      setBlock(false); // the world is visible again -> UI is interactive
    }

    // hold the level name, then fade it out - fire-and-forget so a quick NEXT move
    // isn't blocked by the ~2s name display (a following play() cancels this timer)
    nameTimer = setTimeout(() => {
      card.classList.remove("show");
      nameTimer = null;
    }, NAME_LEAD + HOLD_MS);
  }

  async function cover(onCovered) {
    // if a round transition is mid-flight, WAIT for it instead of degrading to
    // running onCovered with no black (that tore the menu swap down on-screen).
    // Bounded so a stuck transition can never deadlock the Play Again flow.
    const t0 = performance.now();
    while (busy && performance.now() - t0 < 8000) await wait(120);
    if (busy) {
      await onCovered?.();
      return;
    }

    busy = true;
    setBlock(true); // swallow clicks/hover while the screen is covered
    try {
      clearTimeout(nameTimer); // drop any pending name fade from a prior play()
      card.classList.remove("show");
      const diag = Math.ceil(
        Math.hypot(window.innerWidth, window.innerHeight) * 1.35,
      );
      iris.style.transition = "none";
      iris.style.boxShadow = `0 0 0 ${diag}px #000`;
      setIris(diag);
      void iris.offsetWidth;
      const t = `${IRIS_MS}ms ${IRIS_EASE}`;
      iris.style.transition = `width ${t},height ${t},margin ${t}`;

      requestAnimationFrame(() => setIris(0));
      await wait(IRIS_MS + 60);
      // reopen even if the menu swap throws - never strand the screen on black
      try {
        await onCovered?.();
      } finally {
        setIris(diag);
      }
      await wait(IRIS_MS + 60);
    } finally {
      busy = false;
      setBlock(false);
    }
  }

  return { play, showName, cover };
}
