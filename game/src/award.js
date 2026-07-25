import * as THREE from "three";

const STAGE_DURATION = 5200;
const STAGE_ADVANCE_AT = 2850;
const FINAL_DURATION = 12000;
const INTRO = 1450;
const HOLD = 2350;
const FINAL_POSE_DURATION = 10 * 60 * 1000;

const STYLE = `
@font-face{font-family:"SuperMario256";src:url("./assets/fonts/SuperMario256.ttf") format("truetype");font-display:swap;}
/* z 24 = BELOW the round-transition iris (z 60): the closing black circle SWALLOWS the
   banner (its text sits dead-centre, the last thing the shrinking iris covers), and main.js
   also hides it (awardCeremony.stop) at full black. The dim backdrop fades in. */
#rl-award{position:fixed;inset:0;z-index:24;pointer-events:none;display:grid;place-items:center;
  background:rgba(0,0,0,.42);opacity:0;transition:opacity .35s ease;font-family:"Segoe UI",system-ui,sans-serif;}
#rl-award.show{opacity:1;}
#rl-award .burst{position:absolute;inset:0;overflow:hidden;}
#rl-award .spark{position:absolute;left:50%;top:48%;width:14px;height:14px;border:3px solid #000;
  border-radius:50%;background:#ffd443;box-shadow:0 2px 0 #000;
  animation:rl-spark 1.1s cubic-bezier(.14,.82,.25,1) var(--d) both;}
#rl-award.red .spark{background:#ff7468;}
#rl-award.blue .spark{background:#65a6ff;}
@keyframes rl-spark{
  0%{transform:translate(-50%,-50%) scale(.2);opacity:0;}
  16%{opacity:1;}
  100%{transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(.9);opacity:0;}
}
/* drops in from OFF-SCREEN above and bounces a couple of times (same feel as the menu's
   rl-title-drop): starts a full viewport-half + its own height above, overshoots, settles. */
#rl-award .banner{align-self:center;margin-top:0;text-align:center;transform:translateY(calc(-50vh - 100%));}
#rl-award.show .banner{animation:rl-award-drop .9s .08s both;}
@keyframes rl-award-drop{
  0%{transform:translateY(calc(-50vh - 100%));animation-timing-function:cubic-bezier(.55,.02,.9,.26);}
  44%{transform:translateY(0);animation-timing-function:ease-out;}
  62%{transform:translateY(-42px);animation-timing-function:ease-in;}
  78%{transform:translateY(0);animation-timing-function:ease-out;}
  89%{transform:translateY(-18px);animation-timing-function:ease-in;}
  100%{transform:translateY(0);}}
#rl-award .winner{font-family:"SuperMario256","Arial Black",sans-serif;font-size:clamp(46px,7vw,96px);
  line-height:.92;letter-spacing:1px;color:#ffd43d;-webkit-text-stroke:7px #000;paint-order:stroke fill;
  text-shadow:1px 1px 0 #000,2px 2px 0 #000,3px 3px 0 #000,4px 4px 0 #000,5px 5px 0 #000,6px 6px 0 #000,7px 7px 0 #000,8px 8px 0 #000;}
#rl-award.blue .winner{color:#67a9ff;}
#rl-award.red .winner{color:#ff7468;}
#rl-award.draw .winner{color:#b79cff;}
/* draw uses the same dim backdrop + centred banner as a winner now (base rules) */
#rl-award .sub{display:block;margin-top:12px;color:#fff;font-family:"SuperMario256","Arial Black",sans-serif;
  font-size:20px;letter-spacing:.5px;-webkit-text-stroke:4px #000;paint-order:stroke fill;
  text-shadow:1px 1px 0 #000,2px 2px 0 #000,3px 3px 0 #000,4px 4px 0 #000;}
#rl-award .point{display:none;}   /* the +1 POINT pill is gone - just the middle text now */
#rl-award.show .point{animation:rl-point-in .42s cubic-bezier(.16,1.35,.25,1) .72s both;}
@keyframes rl-point-in{to{opacity:1;transform:translateX(-50%) translateY(-10px);}}
#rl-award.stage{background:
  radial-gradient(circle 170px at var(--sx,50%) var(--sy,56%),rgba(255,244,155,.18),rgba(255,244,155,.04) 42%,rgba(0,0,0,0) 70%),
  rgba(0,0,0,.44);}
#rl-award.stage .burst{background:
  radial-gradient(circle 92px at var(--sx,50%) var(--sy,56%),rgba(255,255,255,.18),rgba(255,255,255,0) 72%);}
#rl-award.stage .spark{left:var(--sx,50%);top:var(--sy,56%);}
#rl-award.stage .banner{margin-top:8vh;}
#rl-award.stage .winner{font-size:clamp(38px,6vw,78px);}
#rl-award.stage .sub{font-size:15px;}
#rl-award .ring{position:absolute;left:var(--sx,50%);top:var(--sy,56%);width:160px;height:160px;
  margin:-80px 0 0 -80px;border:5px solid #ffd443;border-radius:50%;box-shadow:0 0 0 4px #000,0 0 30px #ffd443;
  opacity:0;transform:scale(.45);display:none;}
#rl-award.stage .ring{display:block;animation:rl-ring 1.1s cubic-bezier(.16,1.25,.25,1) .16s both;}
#rl-award.blue .ring{border-color:#67a9ff;box-shadow:0 0 0 4px #000,0 0 30px #67a9ff;}
#rl-award.red .ring{border-color:#ff7468;box-shadow:0 0 0 4px #000,0 0 30px #ff7468;}
@keyframes rl-ring{35%{opacity:1;transform:scale(1.08);}100%{opacity:.72;transform:scale(1);}}
#rl-award .coin{position:absolute;left:0;top:0;width:58px;height:58px;border-radius:50%;border:4px solid #000;
  display:none;place-items:center;background:#ffd443;color:#1b1607;font-family:"SuperMario256","Arial Black",sans-serif;
  font-size:22px;box-shadow:0 5px 0 #000;transform:translate(var(--sxpx,50vw),var(--sypx,50vh)) translate(-50%,-50%);}
#rl-award.stage .coin{display:grid;animation:rl-coin-fly 1.35s cubic-bezier(.2,.8,.2,1) 1.15s both;}
@keyframes rl-coin-fly{
  0%{transform:translate(var(--sxpx,50vw),var(--sypx,50vh)) translate(-50%,-50%) scale(.7);opacity:0;}
  16%{opacity:1;transform:translate(var(--sxpx,50vw),var(--sypx,50vh)) translate(-50%,-72%) scale(1.08);}
  100%{opacity:0;transform:translate(var(--txpx,50vw),var(--typx,8vh)) translate(-50%,-50%) scale(.55);}
}
#rl-final{position:fixed;inset:0;z-index:26;pointer-events:none;display:grid;place-items:center;
  opacity:0;transition:opacity .24s ease;font-family:"Segoe UI",system-ui,sans-serif;
  background:radial-gradient(circle at 50% 45%,rgba(255,218,73,.16),rgba(0,0,0,.42) 54%,rgba(0,0,0,.72));}
#rl-final.show{opacity:1;pointer-events:auto;}
#rl-final .f-card{width:min(680px,90vw);padding:22px 24px 24px;border:3px solid #101114;border-radius:12px;
  background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(241,244,250,.98));
  box-shadow:0 7px 0 #000,0 22px 42px rgba(0,0,0,.42);transform:translateY(24px) scale(.96);
  opacity:0;text-align:center;}
#rl-final.show .f-card{animation:rl-final-card .5s cubic-bezier(.16,1.18,.25,1) .08s both;}
@keyframes rl-final-card{to{transform:translateY(0) scale(1);opacity:1;}}
#rl-final .f-kicker{display:inline-block;padding:6px 16px;border:2.5px solid #000;border-radius:999px;
  background:#ffd443;color:#1b1607;font-weight:1000;text-transform:uppercase;letter-spacing:.7px;box-shadow:0 2px 0 #000;}
#rl-final .f-title{margin:18px 0 5px;font-family:"SuperMario256","Arial Black",sans-serif;
  font-size:clamp(34px,5.6vw,62px);line-height:.92;color:#ffd43d;-webkit-text-stroke:4px #000;
  paint-order:stroke fill;text-shadow:0 3px 0 rgba(0,0,0,.38);}
#rl-final.blue .f-title{color:#67a9ff;}
#rl-final.red .f-title{color:#ff7468;}
#rl-final.tie .f-title{color:#ffd43d;}
#rl-final .f-sub{margin:0 0 18px;color:#575a62;font-size:15.5px;font-weight:800;}
#rl-final .f-sub:empty{display:none;}
#rl-final .f-stand{display:grid;gap:10px;margin-top:16px;}
#rl-final .f-row{position:relative;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;
  padding:13px 15px;border:2.5px solid #111;border-radius:10px;background:#fff;box-shadow:0 3px 0 #000;
  text-align:left;overflow:hidden;}
#rl-final .f-row.win::before{content:"";position:absolute;inset:0 auto 0 0;width:8px;background:#ffd443;}
#rl-final .f-row.blue.win{background:linear-gradient(90deg,#eaf3ff,#fff 64%);}
#rl-final .f-row.red.win{background:linear-gradient(90deg,#ffe8e5,#fff 64%);}
#rl-final .f-row.blue.win::before{background:#67a9ff;}
#rl-final .f-row.red.win::before{background:#ff7468;}
#rl-final .f-side{display:contents;font-size:18px;font-weight:1000;color:#1f1f21;}
#rl-final .f-name{font-size:18px;font-weight:1000;color:#1f1f21;}
#rl-final .f-crown{display:none;margin-left:7px;padding:2px 7px;border:2px solid #000;border-radius:999px;
  background:#ffd443;font-size:11px;font-weight:1000;vertical-align:middle;box-shadow:0 2px 0 #000;}
#rl-final .f-row.win .f-crown{display:inline-block;}
#rl-final .f-dot{width:15px;height:15px;border-radius:50%;border:2px solid #000;box-shadow:0 2px 0 #000;}
#rl-final .f-row.blue .f-dot{background:#1f5fd0;}
#rl-final .f-row.red .f-dot{background:#e60012;}
#rl-final .f-score{font-family:"SuperMario256","Arial Black",sans-serif;font-size:44px;line-height:.9;color:#fff;
  -webkit-text-stroke:3px #000;paint-order:stroke fill;text-shadow:0 2px 0 rgba(0,0,0,.42);}
#rl-final .f-actions{display:flex;justify-content:center;margin-top:20px;}
#rl-final .f-exit{pointer-events:auto;border:2.5px solid #000;border-radius:999px;background:#1f1f21;color:#fff;
  min-width:178px;padding:10px 18px;font:inherit;font-size:15px;font-weight:1000;text-transform:uppercase;
  letter-spacing:.4px;box-shadow:0 4px 0 #000;cursor:pointer;}
#rl-final .f-exit:hover{background:#33353a;}
#rl-final .f-exit:active{transform:translateY(2px);box-shadow:0 2px 0 #000;}
#rl-final .f-confetti{position:absolute;inset:0;overflow:hidden;}
#rl-final .f-confetti i{position:absolute;left:50%;top:0;width:10px;height:15px;border:2px solid #000;border-radius:3px;
  background:var(--c);opacity:.82;animation:rl-confetti 2.5s linear var(--d) infinite;transform:translateX(var(--x)) rotate(var(--r));}
@keyframes rl-confetti{0%{top:-8%;opacity:0;}8%{opacity:1;}100%{top:108%;opacity:0;transform:translateX(calc(var(--x) + var(--s))) rotate(calc(var(--r) + 380deg));}}
`;

const ease = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

function sideLabel(side) {
  return side === "blue" ? "Player" : "CPU";
}

function modelLabel(side, award, stats) {
  const round = stats?.round || {};
  if (side === "blue") return award?.labelBlue || round.labelBlue || stats?.algoBlue || "Blue model";
  return award?.labelRed || round.labelRed || stats?.algoRed || "Red model";
}

function sparkHTML() {
  const bits = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = 120 + (i % 5) * 28;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.62;
    bits.push(
      `<span class="spark" style="--x:${x.toFixed(1)}px;--y:${y.toFixed(1)}px;--d:${(i * 0.025).toFixed(3)}s"></span>`,
    );
  }
  return bits.join("");
}

function confettiHTML() {
  const cols = ["#ffd443", "#67a9ff", "#ff7468", "#ffffff"];
  const bits = [];
  for (let i = 0; i < 44; i++) {
    bits.push(
      `<i style="--c:${cols[i % cols.length]};--x:${(-48 + (i * 19) % 96).toFixed(1)}vw;` +
        `--s:${(-80 + (i * 37) % 160).toFixed(1)}px;--r:${(i * 29) % 180}deg;--d:${(i * 0.055).toFixed(2)}s"></i>`,
    );
  }
  return bits.join("");
}

export function createAwardCeremony({ camera, actors, onDone, onExit }) {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = "rl-award";
  el.innerHTML =
    `<div class="burst">${sparkHTML()}</div>` +
    `<div class="ring"></div><div class="coin">+1</div>` +
    `<div class="banner"><div class="winner">WINNER!</div><div class="sub"></div></div>` +
    `<div class="point">+1 STAGE POINT</div>`;
  document.body.appendChild(el);

  const finalEl = document.createElement("div");
  finalEl.id = "rl-final";
  finalEl.innerHTML =
    `<div class="f-confetti">${confettiHTML()}</div>` +
    `<div class="f-card"><div class="f-kicker">Final Standings</div>` +
    `<div class="f-title"></div><p class="f-sub"></p>` +
    `<div class="f-stand"></div><div class="f-actions">` +
    `<button class="f-exit" type="button">Play Again</button></div></div>`;
  document.body.appendChild(finalEl);
  let exiting = false;
  finalEl.querySelector(".f-exit").addEventListener("click", async (e) => {
    e.stopPropagation();
    if (exiting) return;
    exiting = true;
    finalEl.querySelector(".f-exit").disabled = true;
    try {
      await onExit?.();
    } finally {
      exiting = false;
      finalEl.querySelector(".f-exit").disabled = false;
    }
  });

  const tmpFocus = new THREE.Vector3();
  const tmpActor = new THREE.Vector3();
  const tmpClose = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpScreen = new THREE.Vector3();
  let state = null;
  let drawTimer = null;

  function hide() {
    clearTimeout(drawTimer);
    el.classList.remove("show", "blue", "red", "stage", "close", "draw");
    state = null;
  }

  // ONE simple finish banner for both a winner and a draw: NO camera zoom, NO celebrate,
  // NO point pill - just the centred-ish text, held a moment, then advance / final standings.
  function finishBanner(cls, main, sub, finalRound, award, stats) {
    clearTimeout(drawTimer);
    el.classList.remove("show", "blue", "red", "stage", "close", "draw");
    el.classList.add(cls);
    el.querySelector(".winner").textContent = main;
    el.querySelector(".sub").textContent = sub;
    void el.offsetWidth;
    el.classList.add("show");
    drawTimer = setTimeout(() => {
      if (finalRound) {
        el.classList.remove("show", cls);
        showFinal(award, stats);
      } else {
        // keep the banner SHOWN and start the advance: the round transition's onCovered
        // calls awardCeremony.stop() at FULL BLACK, hiding it exactly when the iris has
        // taken the whole screen. Fallback clears it if that somehow never fires.
        onDone?.({ award, stats });
        drawTimer = setTimeout(() => el.classList.remove("show", cls), 6000);
      }
    }, 4800);
  }

  function showDraw(award, stats) {
    const finalRound = (award.roundIndex ?? 0) + 1 >= (award.roundTotal ?? 1);
    finishBanner("draw", "DRAW", "No clear winner this round", finalRound, award, stats);
  }

  function setStageSpot(side) {
    actors.getSideFocus(side, tmpFocus);
    tmpScreen.copy(tmpFocus).project(camera);
    const xPct = THREE.MathUtils.clamp((tmpScreen.x * 0.5 + 0.5) * 100, 8, 92);
    const yPct = THREE.MathUtils.clamp((-tmpScreen.y * 0.5 + 0.5) * 100, 12, 86);
    const xPx = (xPct / 100) * window.innerWidth;
    const yPx = (yPct / 100) * window.innerHeight;
    el.style.setProperty("--sx", `${xPct.toFixed(2)}%`);
    el.style.setProperty("--sy", `${yPct.toFixed(2)}%`);
    el.style.setProperty("--sxpx", `${xPx.toFixed(1)}px`);
    el.style.setProperty("--sypx", `${yPx.toFixed(1)}px`);
    el.style.setProperty("--txpx", side === "blue" ? "25vw" : "75vw");
    el.style.setProperty("--typx", "9vh");
  }

  function showFinal(award, stats) {
    const score = award?.score || stats?.score || {};
    const red = score.red || 0;
    const blue = score.blue || 0;
    const champ = blue > red ? "blue" : red > blue ? "red" : "tie";
    const title =
      champ === "tie" ? "FINAL DRAW!" : `${sideLabel(champ).toUpperCase()} WINS!`;
    const sub = champ === "tie" ? "The tournament ends level on stage points." : "";
    finalEl.classList.remove("show", "blue", "red", "tie");
    finalEl.classList.add(champ);
    finalEl.querySelector(".f-title").textContent = title;
    finalEl.querySelector(".f-sub").textContent = sub;
    const rows = [
      { side: "blue", label: "Player", points: blue },
      { side: "red", label: "CPU", points: red },
    ].sort((a, b) => b.points - a.points);
    finalEl.querySelector(".f-stand").innerHTML = rows
      .map(
        (row) =>
          `<div class="f-row ${row.side} ${champ === row.side ? "win" : ""}">` +
          `<div class="f-side"><span class="f-dot"></span><span class="f-name">${row.label}` +
          `<span class="f-crown">Winner</span></span></div>` +
          `<div class="f-score">${row.points}</div></div>`,
      )
      .join("");
    void finalEl.offsetWidth;
    finalEl.classList.add("show");
  }

  function start(award, stats) {
    const side = award?.winner;
    if (side !== "red" && side !== "blue") return false;
    // no zoom, no celebrate, no point pill - just finish the round and announce it.
    const finalRound = (award.roundIndex ?? 0) + 1 >= (award.roundTotal ?? 1);
    finishBanner(side, "WINNER!",
      `${sideLabel(side)} - ${modelLabel(side, award, stats)}`, finalRound, award, stats);
    return true;
  }

  function update() {
    if (!state) return;

    const elapsed = performance.now() - state.startTime;
    if (elapsed >= FINAL_DURATION && state.advanceStarted && !state.finalRound) {
      hide();
      return;
    }

    actors.getSideFocus(state.side, tmpFocus);
    tmpLook.copy(tmpFocus);
    tmpLook.y += 0.08;
    tmpClose.copy(tmpFocus).addScaledVector(state.dir, 4.25);
    tmpClose.y = tmpFocus.y + 1.05 + Math.sin(elapsed * 0.006) * 0.06;

    if (elapsed < INTRO) {
      const u = ease(elapsed / INTRO);
      tmpPos.lerpVectors(state.startPos, tmpClose, u);
      camera.position.copy(tmpPos);
      camera.lookAt(tmpLook);
    } else {
      const sway = Math.sin(elapsed * 0.0028) * 0.18;
      tmpPos.copy(tmpClose).addScaledVector(state.dir, Math.sin(elapsed * 0.004) * 0.12);
      tmpPos.x += -state.dir.z * sway;
      tmpPos.z += state.dir.x * sway;
      camera.position.copy(tmpPos);
      camera.lookAt(tmpLook);
    }

    if (!state.advanceStarted && elapsed >= INTRO + HOLD) {
      state.advanceStarted = true;
      if (state.finalRound) {
        actors.celebrate(state.side, {
          duration: FINAL_POSE_DURATION,
          faceYaw: Math.atan2(tmpClose.x - tmpActor.x, tmpClose.z - tmpActor.z),
        });
        el.classList.remove("show");
        showFinal(state.award, state.stats);
      } else {
        onDone?.({ side: state.side, award: state.award, stats: state.stats });
      }
    }
  }

  return {
    start,
    showFinal,
    showDraw,
    update,
    stop: () => {
      hide();
      finalEl.classList.remove("show", "blue", "red", "tie");
    },
    active: () => !!state || finalEl.classList.contains("show"),
  };
}
