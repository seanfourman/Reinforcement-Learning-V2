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

const IRIS_MS = 1000; // iris close / open duration (matches the start-menu iris)
const NAME_LEAD = 150; // begin the name fade this long before the iris finishes opening
const HOLD_MS = 1500; // how long the level name sits fully readable over the world
const IRIS_EASE = "cubic-bezier(.66,0,.34,1)";

const STYLE = `
#rl-iris{position:fixed;top:50%;left:50%;border-radius:50%;pointer-events:none;z-index:60;
  background:transparent;}
#rl-iris-card{position:fixed;inset:0;z-index:61;pointer-events:none;display:flex;
  flex-direction:column;align-items:center;justify-content:center;text-align:center;
  opacity:0;transform:translateY(12px);
  transition:opacity .6s ease,transform .6s cubic-bezier(.2,.9,.2,1);color:#fff;
  /* a soft scrim so the name stays legible over a bright scene, fades with the card */
  background:radial-gradient(58% 42% at 50% 47%,rgba(0,0,0,.5),rgba(0,0,0,0) 72%);}
#rl-iris-card.show{opacity:1;transform:translateY(0);}
#rl-iris-card .pre{font-family:"Segoe UI",system-ui,sans-serif;font-size:13px;
  letter-spacing:7px;text-transform:uppercase;color:#dbe4f6;opacity:.85;margin-bottom:18px;
  text-shadow:0 2px 12px rgba(0,0,0,.7);}
#rl-iris-card .ttl{font-family:Georgia,"Times New Roman",serif;font-weight:600;font-size:62px;
  letter-spacing:1px;margin:0;color:#fdfdff;
  text-shadow:0 0 34px rgba(150,180,255,.35),0 3px 14px rgba(0,0,0,.75);}
#rl-iris-card .sub{font-family:Georgia,serif;font-style:italic;font-size:21px;letter-spacing:2px;
  margin-top:16px;color:rgba(255,255,255,.9);text-shadow:0 2px 16px rgba(0,0,0,.85);}
#rl-iris-card .sub b{font-style:normal;font-weight:700;}
#rl-iris-card .sub b.r{color:#ff9a90;} #rl-iris-card .sub b.b{color:#9cc0f5;}
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

  const card = document.createElement("div");
  card.id = "rl-iris-card";
  card.innerHTML = `<div class="pre" id="rl-iris-pre"></div>
      <div class="ttl" id="rl-iris-ttl">Arena</div>
      <div class="sub" id="rl-iris-sub"></div>`;
  document.body.appendChild(card);

  const pre = card.querySelector("#rl-iris-pre");
  const ttl = card.querySelector("#rl-iris-ttl");
  const sub = card.querySelector("#rl-iris-sub");

  const setIris = (dpx) => {
    iris.style.width = iris.style.height = dpx + "px";
    iris.style.margin = `${-dpx / 2}px 0 0 ${-dpx / 2}px`;
  };

  let busy = false;

  async function play(worldJson, stats, onCovered) {
    if (busy) {
      await onCovered?.();
      return;
    } // never skip the rebuild

    busy = true;
    try {
      // ---- fill the level card (shown later, over the revealed world) ----
      const r = (stats && stats.round) || {};
      pre.textContent =
        `Round ${(r.index ?? (worldJson.roundId - 1)) + 1}` +
        (r.total ? ` / ${r.total}` : "");
      ttl.textContent = worldJson.title || r.title || "Arena";
      const lr = r.labelRed || (stats && stats.algoRed) || "";
      const lb = r.labelBlue || (stats && stats.algoBlue) || "";
      sub.innerHTML =
        lr && lb
          ? `<b class="r">${lr}</b> &nbsp;vs&nbsp; <b class="b">${lb}</b>`
          : "";
      card.classList.remove("show"); // make sure it starts hidden

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

      // 2) under black: rebuild the arena + swap the UI, and WAIT until it's all
      // loaded and settled (onCovered resolves only when everything's ready)
      await onCovered?.();

      // 3) open the iris onto the fully-ready world (still no text)
      setIris(diag);
      await wait(Math.max(0, IRIS_MS - NAME_LEAD));

      // 4) once the world is visible, fade the level name up OVER it, hold, fade out
      card.classList.add("show");
      await wait(NAME_LEAD + HOLD_MS);
      card.classList.remove("show");
      await wait(650);
    } finally {
      busy = false;
    }
  }

  return { play };
}
