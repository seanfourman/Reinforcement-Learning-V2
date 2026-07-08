import * as THREE from "three";

const STAGE_DURATION = 5200;
const STAGE_ADVANCE_AT = 2850;
const FINAL_DURATION = 12000;
const INTRO = 1450;
const HOLD = 2350;
const FINAL_POSE_DURATION = 10 * 60 * 1000;

const STYLE = `
@font-face{font-family:"SuperMario256";src:url("./assets/fonts/SuperMario256.ttf") format("truetype");font-display:swap;}
#rl-award{position:fixed;inset:0;z-index:24;pointer-events:none;display:grid;place-items:center;
  opacity:0;transition:opacity .18s ease;font-family:"Segoe UI",system-ui,sans-serif;}
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
#rl-award .banner{align-self:start;margin-top:13vh;text-align:center;transform:translateY(-24px) scale(.9);
  opacity:0;filter:drop-shadow(0 8px 0 rgba(0,0,0,.42));}
#rl-award.show .banner{animation:rl-award-pop .52s cubic-bezier(.16,1.35,.25,1) .18s both;}
@keyframes rl-award-pop{to{transform:translateY(0) scale(1);opacity:1;}}
#rl-award .winner{font-family:"SuperMario256","Arial Black",sans-serif;font-size:clamp(46px,7vw,96px);
  line-height:.92;letter-spacing:1px;color:#ffd43d;-webkit-text-stroke:6px #000;paint-order:stroke fill;
  text-shadow:0 5px 0 rgba(0,0,0,.55);}
#rl-award.blue .winner{color:#67a9ff;}
#rl-award.red .winner{color:#ff7468;}
#rl-award .sub{display:inline-block;margin-top:10px;padding:7px 18px;border:3px solid #000;border-radius:999px;
  background:#fff;color:#1f1f21;font-size:16px;font-weight:900;box-shadow:0 4px 0 #000;}
#rl-award .point{position:absolute;left:50%;bottom:13vh;transform:translateX(-50%);
  padding:8px 18px;border-radius:999px;border:3px solid #000;background:#ffd443;color:#1b1607;
  font-size:18px;font-weight:1000;letter-spacing:.4px;box-shadow:0 4px 0 #000;
  opacity:0;}
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
  background:radial-gradient(circle at 50% 44%,rgba(255,232,91,.18),rgba(0,0,0,.46) 58%,rgba(0,0,0,.72));}
#rl-final.show{opacity:1;}
#rl-final .f-card{width:min(760px,88vw);padding:28px 30px 30px;border:4px solid #000;border-radius:16px;
  background:linear-gradient(180deg,#fff 0%,#f3f5fb 100%);box-shadow:0 10px 0 #000,0 28px 48px rgba(0,0,0,.48);
  transform:translateY(28px) scale(.92);opacity:0;text-align:center;}
#rl-final.show .f-card{animation:rl-final-card .62s cubic-bezier(.16,1.25,.25,1) .08s both;}
@keyframes rl-final-card{to{transform:translateY(0) scale(1);opacity:1;}}
#rl-final .f-kicker{display:inline-block;padding:7px 18px;border:3px solid #000;border-radius:999px;
  background:#ffd443;color:#1b1607;font-weight:1000;text-transform:uppercase;letter-spacing:.7px;box-shadow:0 3px 0 #000;}
#rl-final .f-title{margin:18px 0 5px;font-family:"SuperMario256","Arial Black",sans-serif;
  font-size:clamp(42px,6.8vw,82px);line-height:.9;color:#ffd43d;-webkit-text-stroke:6px #000;
  paint-order:stroke fill;text-shadow:0 5px 0 rgba(0,0,0,.45);}
#rl-final.blue .f-title{color:#67a9ff;}
#rl-final.red .f-title{color:#ff7468;}
#rl-final.tie .f-title{color:#ffd43d;}
#rl-final .f-sub{margin:0 0 20px;color:#54565c;font-size:17px;font-weight:800;}
#rl-final .f-stand{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px;}
#rl-final .f-row{position:relative;padding:16px 18px 15px;border:3px solid #000;border-radius:13px;
  background:#fff;box-shadow:0 4px 0 #000;text-align:left;overflow:hidden;}
#rl-final .f-row.win{background:linear-gradient(180deg,#fff7bf,#ffe06b);}
#rl-final .f-row.blue.win{background:linear-gradient(180deg,#eaf3ff,#78b5ff);}
#rl-final .f-row.red.win{background:linear-gradient(180deg,#ffe8e5,#ff8175);}
#rl-final .f-side{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:1000;color:#1f1f21;}
#rl-final .f-dot{width:16px;height:16px;border-radius:50%;border:2px solid #000;box-shadow:0 2px 0 #000;}
#rl-final .f-row.blue .f-dot{background:#1f5fd0;}
#rl-final .f-row.red .f-dot{background:#e60012;}
#rl-final .f-score{margin-top:10px;font-family:"SuperMario256","Arial Black",sans-serif;font-size:52px;
  line-height:.9;color:#fff;-webkit-text-stroke:4px #000;paint-order:stroke fill;text-shadow:0 3px 0 rgba(0,0,0,.45);}
#rl-final .f-note{margin-top:18px;color:#8a8d94;font-size:13px;font-weight:800;}
#rl-final .f-confetti{position:absolute;inset:0;overflow:hidden;}
#rl-final .f-confetti i{position:absolute;left:50%;top:0;width:12px;height:18px;border:2px solid #000;border-radius:3px;
  background:var(--c);animation:rl-confetti 2.5s linear var(--d) infinite;transform:translateX(var(--x)) rotate(var(--r));}
@keyframes rl-confetti{0%{top:-8%;opacity:0;}8%{opacity:1;}100%{top:108%;opacity:0;transform:translateX(calc(var(--x) + var(--s))) rotate(calc(var(--r) + 380deg));}}
`;

const ease = (t) => {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

function sideLabel(side) {
  return side === "blue" ? "Blue" : "Red";
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

export function createAwardCeremony({ camera, actors, onDone }) {
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
    `<div class="f-stand"></div><p class="f-note">Tournament complete</p></div>`;
  document.body.appendChild(finalEl);

  const tmpFocus = new THREE.Vector3();
  const tmpActor = new THREE.Vector3();
  const tmpClose = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpScreen = new THREE.Vector3();
  let state = null;

  function hide() {
    el.classList.remove("show", "blue", "red", "stage", "close");
    state = null;
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
    const sub =
      champ === "tie"
        ? "The tournament ends level on stage points."
        : `${modelLabel(champ, award, stats)} is the tournament champion.`;
    finalEl.classList.remove("show", "blue", "red", "tie");
    finalEl.classList.add(champ);
    finalEl.querySelector(".f-title").textContent = title;
    finalEl.querySelector(".f-sub").textContent = sub;
    finalEl.querySelector(".f-stand").innerHTML =
      `<div class="f-row blue ${champ === "blue" ? "win" : ""}">` +
      `<div class="f-side"><span class="f-dot"></span><span>Blue Model</span></div>` +
      `<div class="f-score">${blue}</div></div>` +
      `<div class="f-row red ${champ === "red" ? "win" : ""}">` +
      `<div class="f-side"><span class="f-dot"></span><span>Red Model</span></div>` +
      `<div class="f-score">${red}</div></div>`;
    void finalEl.offsetWidth;
    finalEl.classList.add("show");
  }

  function start(award, stats) {
    const side = award?.winner;
    if (side !== "red" && side !== "blue") return false;
    actors.snapFrame?.(award.frame);
    const finalRound = (award.roundIndex ?? 0) + 1 >= (award.roundTotal ?? 1);

    actors.getSideFocus(side, tmpFocus);
    actors.getSidePosition(side, tmpActor);
    const dir = camera.position.clone().sub(tmpFocus);
    dir.y = 0;
    if (dir.lengthSq() < 0.0001) dir.set(0, 0, 1);
    dir.normalize();

    tmpClose.copy(tmpFocus).addScaledVector(dir, 4.25);
    tmpClose.y = tmpFocus.y + 1.05;
    const faceYaw = Math.atan2(tmpClose.x - tmpActor.x, tmpClose.z - tmpActor.z);
    actors.celebrate(side, { duration: finalRound ? FINAL_DURATION : STAGE_DURATION + 1600, faceYaw });

    el.classList.remove("show", "blue", "red", "stage", "close");
    el.classList.add(side, "close");
    el.querySelector(".winner").textContent = "WINNER!";
    el.querySelector(".sub").textContent =
      `${sideLabel(side)} model - ${modelLabel(side, award, stats)}`;
    el.querySelector(".point").textContent = finalRound ? "+1 FINAL POINT" : "+1 STAGE POINT";
    void el.offsetWidth;
    el.classList.add("show");

    state = {
      side,
      award,
      stats,
      finalRound,
      dir,
      startTime: performance.now(),
      startPos: camera.position.clone(),
      advanceStarted: false,
    };
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
    update,
    stop: () => {
      hide();
      finalEl.classList.remove("show", "blue", "red", "tie");
    },
    active: () => !!state,
  };
}
