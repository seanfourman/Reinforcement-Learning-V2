// Fighting-game tournament HUD (Tekken-style top bar): a character portrait in each top
// corner with a slanted name tag, two skewed glossy meters charging toward the centre that
// show each side's RECENT win share (same data as the M panel's "Contest (recent)" bar),
// 5 round-win dots under each bar (a point lights for the side that won each round), and a
// centre block with the round number.
//
// Event-driven: 'rl-snapshot' (stats = { round:{title,index,total,labelBlue,labelRed},
// score:{blue,red} = rounds won, recentRate:{red,blue,draw} = recent win shares, algoBlue, algoRed }).

const CHAR_KEYS = [
  "mario",
  "luigi",
  "yoshi",
  "toadette",
  "pauline",
  "koopa",
  "bowser",
  "peach",
  "toad",
  "parabones",
];
function charIcon(slot, fallbackKey) {
  let p = {};
  try {
    p = JSON.parse(localStorage.getItem("rl-chars") || "{}");
  } catch (e) {}
  const key = CHAR_KEYS[p[slot]] || fallbackKey;
  return `./assets/icons/${key}.png`;
}

const STYLE = `
/* Mario display font, re-declared here so the HUD has it even when the start menu is gone */
@font-face{font-family:"SuperMario256";src:url("./assets/fonts/SuperMario256.ttf") format("truetype");font-display:swap;}
#rl-hud{position:fixed;top:0;left:0;right:0;z-index:8;pointer-events:none;display:flex;
  align-items:center;justify-content:center;gap:48px;padding:30px 16px 0;font-family:"Segoe UI",system-ui,sans-serif;}
.fb-side{flex:none;display:flex;align-items:center;gap:0;}
.fb-side.red{flex-direction:row-reverse;}
/* character portrait at the corner (on top, so the bar tucks in behind it) */
.fb-port{position:relative;z-index:10;height:98px;width:auto;filter:drop-shadow(0 5px 9px rgba(0,0,0,.6));}
.fb-side.blue .fb-port{transform:scaleX(-1);} /* flip the left one to face inward */
/* name tag (above) + meter (below), beside the character */
.fb-col{position:relative;flex:none;display:flex;flex-direction:column;gap:0;}
.fb-side.blue .fb-col{align-items:flex-start;transform:skewX(12deg);}
.fb-side.red .fb-col{align-items:flex-end;transform:skewX(-12deg);}
/* slanted fighting-game name tag */
.fb-tag{display:inline-flex;border:2.5px solid #000;border-radius:3px;overflow:hidden;box-shadow:0 3px 7px rgba(0,0,0,.55);}
.fb-side.blue .fb-tag{position:relative;z-index:3;left:-12px;}
.fb-side.red .fb-tag{flex-direction:row-reverse;position:relative;z-index:3;left:12px;}
.fb-px{padding:0 8px;display:flex;align-items:center;font-weight:900;font-size:11px;letter-spacing:.5px;
  line-height:1.5;color:#1a1207;background:linear-gradient(180deg,#ffe171,#ffbf17);}
.fb-nm{padding:0 13px;display:flex;align-items:center;font-weight:900;font-size:13.5px;color:#fff;
  white-space:nowrap;letter-spacing:.3px;line-height:1.5;text-shadow:0 1px 2px rgba(0,0,0,.6);}
.fb-side.blue .fb-nm{background:linear-gradient(180deg,#4f97ff,#1d4fc6);}
.fb-side.red .fb-nm{background:linear-gradient(180deg,#ff6a5d,#bf1c1c);}
/* BLACK track + thick black cartoonish border + 3D shadow; blue/red glossy fill kept */
.fb-meter{position:relative;z-index:5;width:300px;height:18px;border:3px solid #000;border-radius:5px;
  background:#0b0b0b;box-shadow:0 3px 0 #000,inset 0 2px 4px rgba(0,0,0,.7);}
.fb-side.blue .fb-meter{left:-22px;}
.fb-side.red .fb-meter{left:22px;}
.fb-fill{position:absolute;top:0;bottom:0;left:0;width:0;background-size:200% 100%;border-radius:2px;
  animation:fb-shimmer 1.4s linear infinite;}
.fb-side.red .fb-fill{left:auto;right:0;}
.fb-side.blue .fb-fill{background-image:linear-gradient(90deg,#1f53c8,#5aa6ff,#cfe6ff,#5aa6ff,#1f53c8);
  box-shadow:inset 0 3px 4px rgba(255,255,255,.55),inset 0 -4px 6px rgba(0,0,0,.35);
  animation-direction:reverse;} /* left shimmer flows the opposite way to the right side */
.fb-side.red .fb-fill{background-image:linear-gradient(90deg,#bf1c1c,#ff7a6c,#ffd6cf,#ff7a6c,#bf1c1c);
  box-shadow:inset 0 3px 4px rgba(255,255,255,.55),inset 0 -4px 6px rgba(0,0,0,.35);}
@keyframes fb-shimmer{0%{background-position:0 0}100%{background-position:200% 0}}
.fb-rate{position:absolute;top:50%;transform:translateY(-50%);font-size:11px;font-weight:800;color:#fff;
  text-shadow:0 1px 3px #000;font-variant-numeric:tabular-nums;}
.fb-side.blue .fb-rate{right:6px;} .fb-side.red .fb-rate{left:6px;}
/* centre block: fighting-game round counter - small "ROUND" over a big current / total */
#fb-center{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;
  line-height:1;color:#fff;}
/* Mario-style: thick black stroke (painted behind the fill) + a little 3D drop */
.fb-rlabel{font-family:"SuperMario256","Arial Black",sans-serif;font-size:19px;letter-spacing:2px;
  text-indent:2px;text-transform:uppercase;color:#ffd23f;
  -webkit-text-stroke:3px #000;paint-order:stroke fill;text-shadow:0 2px 0 rgba(0,0,0,.6);}
.fb-rnum{display:flex;align-items:baseline;gap:7px;margin-top:7px;
  font-family:"SuperMario256","Arial Black",sans-serif;font-variant-numeric:tabular-nums;
  -webkit-text-stroke:4.5px #000;paint-order:stroke fill;text-shadow:1px 3px 0 rgba(0,0,0,.55);}
.fb-rnum .i{font-size:56px;color:#fff;line-height:.9;}
.fb-rnum .sep{font-size:38px;color:#8f98ad;}
.fb-rnum .t{font-size:42px;color:#8f98ad;}
/* round-win dots under each bar - absolute so they don't change the column layout */
.fb-dots{position:absolute;top:100%;margin-top:7px;display:flex;gap:8px;}
.fb-side.blue .fb-dots{left:8px;}
.fb-side.red .fb-dots{right:8px;flex-direction:row-reverse;}
/* cartoonish dot: BLACK when not won + thick black border + 3D shadow; lights the side colour */
.fb-dots i{width:14px;height:14px;border-radius:50%;border:2.5px solid #000;background:#0c0c0c;
  box-shadow:0 2px 0 #000;transition:background .2s;}
.fb-side.blue .fb-dots i.on{background:radial-gradient(circle at 35% 30%,#7fb4ff,#2f6bd6);}
.fb-side.red .fb-dots i.on{background:radial-gradient(circle at 35% 30%,#ff8d80,#d8392c);}
/* bottom-left key hints (what to press) - a ROW; smaller badges than the menu's
   ESC/Back, with a lighter shadow */
#rl-keys{position:fixed;left:0.8vw;bottom:1.5vh;z-index:7;display:flex;flex-direction:row;align-items:center;
  gap:22px;color:#fff;pointer-events:none;font-family:"Segoe UI",system-ui,sans-serif;}
#rl-keys .kh{display:flex;align-items:center;gap:9px;pointer-events:auto;cursor:pointer;}
#rl-keys .key{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;
  box-sizing:border-box;padding:0 8px;border-radius:8px;background:#fff;color:#1a1a1a;font-weight:800;
  font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,.22);}
#rl-keys .txt{font-weight:800;font-size:14.5px;letter-spacing:.2px;text-shadow:0 1px 2px rgba(0,0,0,.38);}
/* ESC is 3 letters, so shrink the type instead of letting the badge grow - it stays
   the SAME 30x30 square as the single-letter C / R / T keys beside it */
#rl-keys .kh.menu .key{width:30px;min-width:0;padding:0;font-size:10.5px;letter-spacing:.2px;}
#rl-keys .kh:hover{opacity:.85;}
#rl-keys .kh.finish .txt{min-width:96px;}
#rl-keys .kh.finish.armed .txt{color:#dfe7ff;}
#rl-keys .kh.finish.done.blue .txt{color:#7fb4ff;}
#rl-keys .kh.finish.done.red .txt{color:#ff8d80;}
#rl-keys .kh.finish.done.draw .txt{color:#b79cff;}
/* once a stage is resolved the T square itself takes the result colour (Player=blue,
   CPU=red, draw=purple) so the badge matches the label next to it */
#rl-keys .kh.finish.done .key{color:#fff;}
#rl-keys .kh.finish.done.blue .key{background:#2f6bd6;box-shadow:0 1px 3px rgba(47,107,214,.55);}
#rl-keys .kh.finish.done.red .key{background:#d8392c;box-shadow:0 1px 3px rgba(216,57,44,.55);}
#rl-keys .kh.finish.done.draw .key{background:#8b5cf6;box-shadow:0 1px 3px rgba(139,92,246,.55);}
/* "stage already decided" pop - same feel/animation as the start menu's "pick 5" warning */
#rl-hud-warn{position:fixed;left:50%;bottom:12vh;z-index:9;display:flex;align-items:center;gap:9px;
  transform:translateX(-50%) translateY(22px) scale(.85);transform-origin:bottom center;
  background:linear-gradient(180deg,#ff5d4e 0%,#e22f22 100%);
  border:2.5px solid #3a1410;border-radius:13px;padding:8px 16px;
  box-shadow:0 3px 0 #3a1410,0 10px 20px rgba(0,0,0,.38);
  font-family:"Segoe UI",system-ui,sans-serif;font-weight:800;color:#fff;
  font-size:15px;line-height:1;letter-spacing:.2px;text-shadow:0 1px 2px rgba(0,0,0,.35);
  opacity:0;pointer-events:none;}
#rl-hud-warn.show{opacity:1;animation:rl-hw-pop .45s cubic-bezier(.34,1.6,.5,1) both;}
@keyframes rl-hw-pop{0%{transform:translateX(-50%) translateY(22px) scale(.72);opacity:0;}
  55%{opacity:1;}100%{transform:translateX(-50%) translateY(0) scale(1);opacity:1;}}
#rl-hud-warn.hide{animation:rl-hw-out .42s linear both;}
@keyframes rl-hw-out{0%{transform:translateX(-50%) translateY(0) scale(1);opacity:1;
    animation-timing-function:cubic-bezier(.2,.8,.35,1);}
  30%{transform:translateX(-50%) translateY(-7px) scale(1.05);opacity:1;
    animation-timing-function:cubic-bezier(.45,0,.75,.5);}
  100%{transform:translateX(-50%) translateY(26px) scale(.66);opacity:0;}}
#rl-hud-warn .hw-ico{flex:none;width:24px;height:24px;display:grid;place-items:center;border-radius:50%;
  background:radial-gradient(circle at 38% 32%,#ffe27a,#f6b21b);border:2px solid #3a1410;
  color:#3a1410;font-weight:900;font-size:15px;box-shadow:inset 0 -2px 0 rgba(0,0,0,.18);}
/* "quit to the main menu" confirm (ESC, or clicking the ESC hint). Sits ABOVE the
   control panel (58) but UNDER the iris (60), so the wipe that carries us back to
   the menu covers it. */
#rl-quit{position:fixed;inset:0;z-index:59;display:grid;place-items:center;
  background:rgba(8,10,16,.5);opacity:0;pointer-events:none;transition:opacity .18s;
  font-family:"Segoe UI",system-ui,sans-serif;}
#rl-quit.show{opacity:1;pointer-events:auto;}
#rl-quit .q-card{width:min(430px,88vw);padding:22px 24px 20px;text-align:center;background:#fff;
  border:3px solid #101114;border-radius:12px;box-shadow:0 6px 0 #101114,0 24px 44px rgba(0,0,0,.45);
  transform:translateY(14px) scale(.94);transition:transform .22s cubic-bezier(.16,1.18,.25,1);}
#rl-quit.show .q-card{transform:translateY(0) scale(1);}
#rl-quit .q-ttl{margin:0;font-family:"SuperMario256","Arial Black",sans-serif;font-size:26px;
  letter-spacing:.5px;color:#1f1f21;}
#rl-quit .q-sub{margin:13px 0 0;font-size:14.5px;font-weight:700;line-height:1.45;color:#575a62;}
#rl-quit .q-actions{display:flex;justify-content:center;gap:12px;margin-top:20px;}
#rl-quit button{border:2.5px solid #000;border-radius:999px;padding:10px 20px;cursor:pointer;font:inherit;
  font-size:15px;font-weight:900;box-shadow:0 4px 0 #000;transition:background .12s;}
#rl-quit button:active{transform:translateY(2px);box-shadow:0 2px 0 #000;}
#rl-quit .q-no{background:#ffd23f;color:#1a1207;}
#rl-quit .q-no:hover{background:#ffdf74;}
#rl-quit .q-yes{background:#1f1f21;color:#fff;}
#rl-quit .q-yes:hover{background:#33353a;}
/* Arena-4 lives / Arena-2 tomato progress: the SAME row and position on the
   OUTER side of each portrait. Arena 4 draws hearts; Arena 2 draws tomatoes. */
.fb-hearts{display:none;gap:6px;margin:0 13px;}
.fb-side.red .fb-hearts{flex-direction:row-reverse;}
.fb-heart{width:31px;height:28px;flex:none;filter:drop-shadow(0 2px 0 rgba(0,0,0,.45));}
.fb-tomato{width:40px;height:37px;flex:none;filter:drop-shadow(0 2px 0 rgba(0,0,0,.45));}
.fb-heart path{stroke:#000;stroke-width:1.7;stroke-linejoin:round;transition:fill .18s,opacity .18s;}
.fb-heart.lost path{fill:#101010;opacity:.5;}
.fb-side.blue .fb-heart.alive path{fill:#5aa6ff;}
.fb-side.red .fb-heart.alive path{fill:#ff6a5d;}
.fb-tomato path{fill:#101010;stroke:#000;stroke-width:1.7;stroke-linejoin:round;
  opacity:.5;transition:fill .18s,opacity .18s;}
.fb-side.blue .fb-tomato.alive path{fill:#4c9dff;opacity:1;}
.fb-side.red .fb-tomato.alive path{fill:#f04b43;opacity:1;}
/* Arena-5 CTF: captured flags, same row/position as the hearts/tomatoes */
.fb-flag{width:34px;height:34px;flex:none;filter:drop-shadow(0 2px 0 rgba(0,0,0,.45));}
.fb-flag path{fill:#101010;stroke:#000;stroke-width:1.7;stroke-linejoin:round;
  opacity:.5;transition:fill .18s,opacity .18s;}
.fb-side.blue .fb-flag.alive path{fill:#4c9dff;opacity:1;}
.fb-side.red .fb-flag.alive path{fill:#f04b43;opacity:1;}
/* Arena-5 CTF: the currently HELD weapon on the OUTER side of the flags. A plain
   BLACK disc (like an unfilled flag pip, no coloured border); when armed, the item
   PNG sits a bit LARGER than the disc and pops out of it (overflow visible). */
.fb-weapon{display:none;box-sizing:border-box;width:44px;height:44px;flex:none;margin:0 12px;
  align-items:center;justify-content:center;border-radius:50%;
  background:#101010;box-shadow:0 2px 0 rgba(0,0,0,.45);
  transition:opacity .18s;}
.fb-weapon img{width:158%;height:158%;object-fit:contain;display:block;
  filter:drop-shadow(0 2px 3px rgba(0,0,0,.7));}
.fb-weapon.empty{opacity:.5;}          /* dark disc, like an unfilled flag pip */
.fb-weapon.empty img{display:none;}
`;

export function initHud() {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const hud = document.createElement("div");
  hud.id = "rl-hud";
  const sideHTML = (side, px) =>
    `<div class="fb-side ${side}">
      <div class="fb-weapon" id="fb-weapon-${side}"><img alt="" /></div>
      <div class="fb-hearts" id="fb-hearts-${side}"></div>
      <img class="fb-port" id="fb-port-${side}" alt="" />
      <div class="fb-col">
        <div class="fb-tag"><span class="fb-px">${px}</span><span class="fb-nm" id="fb-algo-${side}">-</span></div>
        <div class="fb-meter"><div class="fb-fill" id="fb-fill-${side}"></div><span class="fb-rate" id="fb-rate-${side}"></span></div>
        <div class="fb-dots" id="fb-dots-${side}"></div>
      </div>
    </div>`;
  hud.innerHTML =
    sideHTML("blue", "P1") +
    `<div id="fb-center"><div class="fb-rlabel">Round</div>` +
    `<div class="fb-rnum"><b class="i" id="fb-round-i">1</b><span class="sep">/</span><span class="t" id="fb-round-t">1</span></div></div>` +
    sideHTML("red", "CPU");
  document.body.appendChild(hud);

  // bottom-left key hints - what to press for what (hidden with the HUD by the menu)
  const keys = document.createElement("div");
  keys.id = "rl-keys";
  keys.innerHTML =
    `<div class="kh menu" data-act="menu"><span class="key">ESC</span><span class="txt">Menu</span></div>` +
    `<div class="kh" data-act="controls"><span class="key">C</span><span class="txt">Controls</span></div>` +
    `<div class="kh" data-act="reset"><span class="key">R</span><span class="txt">Reset</span></div>` +
    `<div class="kh finish" id="rl-finish-key" data-act="terminate"><span class="key">T</span><span class="txt" id="rl-finish-txt">Terminate</span></div>`;
  document.body.appendChild(keys);

  // "stage already decided" pop - mirrors the start menu's "pick 5 algorithms"
  // warning. A stage's point is only ever given by pressing T; once it's resolved
  // (a winner OR a draw) T can't change it, so we say so instead of silently no-op.
  const warn = document.createElement("div");
  warn.id = "rl-hud-warn";
  warn.innerHTML = `<span class="hw-ico">!</span><span class="hw-txt"></span>`;
  document.body.appendChild(warn);
  let warnTok = 0;
  function warnResolved(result) {
    warn.querySelector(".hw-txt").textContent =
      result === "blue" ? "Player already won this stage!"
      : result === "red" ? "CPU already won this stage!"
      : "This stage already ended in a draw!";
    warn.classList.remove("hide", "show");
    void warn.offsetWidth; // restart the pop even if it's still on screen
    warn.classList.add("show");
    const tok = ++warnTok;
    setTimeout(() => {
      if (tok !== warnTok) return;
      warn.classList.add("hide");
      warn.classList.remove("show");
      setTimeout(() => {
        if (tok === warnTok) warn.classList.remove("hide");
      }, 420); // matches rl-hw-out
    }, 2600);
  }

  // ---- back to the main menu (ESC, or clicking the ESC hint) ----
  // Leaving RESETS the tournament (main.js returnToStartMenu), and ESC is an easy
  // key to hit by accident, so it asks first instead of binning the run silently.
  const quit = document.createElement("div");
  quit.id = "rl-quit";
  quit.innerHTML =
    `<div class="q-card"><h2 class="q-ttl">Quit to Main Menu?</h2>` +
    `<p class="q-sub">The tournament resets: the current score and everything both models have learned are lost.</p>` +
    `<div class="q-actions"><button class="q-no" type="button">Keep Playing</button>` +
    `<button class="q-yes" type="button">Main Menu</button></div></div>`;
  document.body.appendChild(quit);
  const quitOpen = () => quit.classList.contains("show");
  const openQuit = () => quit.classList.add("show");
  const closeQuit = () => quit.classList.remove("show");
  quit.querySelector(".q-no").addEventListener("click", closeQuit);
  quit.querySelector(".q-yes").addEventListener("click", () => {
    closeQuit(); // the iris covers the screen next - nothing may linger over the menu
    window.RL?.exitToMenu?.();
  });
  quit.addEventListener("click", (e) => {
    if (e.target === quit) closeQuit(); // click the scrim = cancel
  });
  // ESC opens it, but only when nothing else owns the key: the start menu hides this
  // hint row (it has its own ESC/Back), an open control panel closes on ESC (panel.js),
  // a zoomed chart releases its zoom (graphs.js, which stops the event before us), and
  // the final standings screen has its own Play Again button.
  const escTaken = () =>
    getComputedStyle(keys).display === "none" ||
    !!document.getElementById("rl-panel")?.classList.contains("open") ||
    !!document.getElementById("rl-final")?.classList.contains("show");
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (quitOpen()) {
      e.preventDefault();
      closeQuit();
      return;
    }
    if (escTaken() || /input|select|textarea/i.test(e.target.tagName)) return;
    e.preventDefault();
    openQuit();
  });

  // the current round's result: 'blue' | 'red' | 'draw' | null (unresolved). Kept in
  // sync from every snapshot so pressing T knows whether the stage is already decided.
  let latestResult = null;
  // Terminate the stage with T: award the point if it's still open, otherwise warn
  // that it's already decided. Shared by the keyboard (main.js) and the click below.
  function terminateStage() {
    if (latestResult) {
      warnResolved(latestResult);
      return;
    }
    window.RL?.control?.({ cmd: "awardRound" });
  }

  // the hints themselves are clickable (not only the keyboard keys) - same actions.
  keys.addEventListener("click", (e) => {
    const kh = e.target.closest(".kh");
    if (!kh) return;
    const act = kh.dataset.act;
    if (act === "menu") openQuit();
    else if (act === "controls") window.RL?.panels?.toggle?.();
    else if (act === "reset") window.RL?.control?.({ cmd: "reset" });
    else if (act === "terminate") terminateStage();
  });

  const $ = (id) => hud.querySelector(id);
  // crop each icon's transparent padding so the image box edge IS the character edge - then
  // the bar/tag offsets sit the same relative to the character for every roster pick.
  const fitPortrait = (img, url) => {
    img.dataset.fit = "";
    img.onload = () => {
      if (img.dataset.fit === "1" || !img.naturalWidth) return;
      try {
        const w0 = img.naturalWidth,
          h0 = img.naturalHeight;
        const c = document.createElement("canvas");
        c.width = w0;
        c.height = h0;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w0, h0).data;
        let minX = w0,
          minY = h0,
          maxX = -1,
          maxY = -1;
        for (let y = 0; y < h0; y++)
          for (let x = 0; x < w0; x++)
            if (d[(y * w0 + x) * 4 + 3] > 16) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
        if (maxX < minX) return;
        const w = maxX - minX + 1,
          h = maxY - minY + 1;
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        out.getContext("2d").drawImage(c, minX, minY, w, h, 0, 0, w, h);
        img.dataset.fit = "1";
        img.src = out.toDataURL();
      } catch (e) {}
    };
    img.src = url;
  };
  // re-read saved picks; re-apply a portrait only when its character actually changed, so
  // switching characters in the menu updates the HUD without a page reload.
  // a few cropped icons sit slightly off-centre; nudge these toward their own corner (px)
  const NUDGE = { mario: 10, luigi: 10, koopa: 6, parabones: 4 };
  let appliedB = null,
    appliedR = null;
  const applyPortrait = (side, url, dir) => {
    const img = $(`#fb-port-${side}`);
    fitPortrait(img, url);
    const key = url.slice(url.lastIndexOf("/") + 1, -4);
    img.style.left = `${dir * (NUDGE[key] || 0)}px`; // dir: -1 blue(left), +1 red(right)
  };
  const refreshPortraits = () => {
    const ub = charIcon("-1", "mario"),
      ur = charIcon("1", "luigi");
    if (ub !== appliedB) {
      appliedB = ub;
      applyPortrait("blue", ub, 1);
    }
    if (ur !== appliedR) {
      appliedR = ur;
      applyPortrait("red", ur, -1);
    }
  };
  refreshPortraits();

  // 5 round-win dots under each bar (5-round tournament)
  const dotCells = Array.from({ length: 5 }, () => "<i></i>").join("");
  $("#fb-dots-blue").innerHTML = dotCells;
  $("#fb-dots-red").innerHTML = dotCells;

  // ease the fills toward their target every frame so they're fully fluid (no jumps) and
  // jumpy recent-rate data gets smoothed out.
  const fillBlue = $("#fb-fill-blue"),
    fillRed = $("#fb-fill-red");
  const rateBlue = $("#fb-rate-blue"),
    rateRed = $("#fb-rate-red");
  const barTarget = { blue: 0, red: 0 },
    barCur = { blue: 0, red: 0 };
  // fade the charging tip into the track (mask gradient), but not once the bar is full.
  // the mask is relative to the fill width, so it auto-tracks the tip; only re-set on toggle.
  const setTipFade = (el, val, dir) => {
    // the fade length eases to 0 over the last ~10% (sub-pixel, no rounding) so the tip melts
    // into a solid end with no stepping or pop near 100. it is also capped to 40% of the fill
    // width (min(px,40%)) so low-% bars keep a visible solid core instead of being swallowed.
    const dist = Math.max(0, Math.min(38, (38 * (100 - val)) / 10));
    const key = dist.toFixed(2);
    if (el.dataset.tip === key) return;
    el.dataset.tip = key;
    const m =
      dist < 0.05
        ? "none"
        : `linear-gradient(to ${dir},#000 calc(100% - min(${key}px,40%)),transparent)`;
    el.style.webkitMaskImage = m;
    el.style.maskImage = m;
  };
  const tickBars = () => {
    barCur.blue += (barTarget.blue - barCur.blue) * 0.08;
    barCur.red += (barTarget.red - barCur.red) * 0.08;
    fillBlue.style.width = `${barCur.blue.toFixed(2)}%`;
    fillRed.style.width = `${barCur.red.toFixed(2)}%`;
    rateBlue.textContent = `${Math.round(barCur.blue)}%`;
    rateRed.textContent = `${Math.round(barCur.red)}%`;
    setTipFade(fillBlue, barCur.blue, "right"); // blue charges right, fade the right tip
    setTipFade(fillRed, barCur.red, "left"); // red charges left, fade the left tip
    requestAnimationFrame(tickBars);
  };
  requestAnimationFrame(tickBars);

  // ---- shared Arena-2 / Arena-4 progress row -----------------------------
  // Arena 4 fills hearts for remaining lives. Arena 2 uses the same sizing and
  // portrait-relative position, but fills proper red tomato icons.
  const HEART_SVG =
    '<svg class="fb-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="' +
    "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 " +
    "3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 " +
    '3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  const TOMATO_SVG =
    '<svg class="fb-tomato" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 6.2c5.55-1.45 9.15 1.7 8.75 6.65-.42 5.2-4.12 8.15-8.75 8.15s-8.33-2.95-8.75-8.15C2.85 7.9 6.45 4.75 12 6.2z M12 7.65 9.55 5.5 6.35 6.1 8.2 3.45 7.6 1.4 11 3.25 13.75 1.2 13.45 4.05 17.65 4.65 14.3 6.05z"/>' +
    "</svg>";
  // a BOLD pennant (big triangle) on a slim rounded pole, filled per side like
  // the hearts. The triangle is deliberately large so the team colour dominates
  // and the pole leaves little empty space.
  const FLAG_SVG =
    '<svg class="fb-flag" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M5.4 1.8a.9.9 0 0 1 .9.9V21.3a.9.9 0 0 1-1.8 0V2.7A.9.9 0 0 1 5.4 1.8Z ' +
    'M6.3 2.7 21.4 9.15a.65.65 0 0 1 0 1.2L6.3 16.8Z"/>' +
    "</svg>";
  // Round-5 held-weapon icons (the files the user dropped in assets/icons/weapons)
  const WEAPON_ICON = {
    chain: "./assets/icons/weapons/Chain_Chomp.png",
    red_shell: "./assets/icons/weapons/red-shell-2x.png",
    green_shell: "./assets/icons/weapons/green-shell-2x.png",
    banana: "./assets/icons/weapons/banana-2x.png",
    oil: "./assets/icons/weapons/MKAGPDX_Sticky_Oil.png",
  };
  const weaponBox = { blue: $("#fb-weapon-blue"), red: $("#fb-weapon-red") };
  // weapon: a key => show that icon (armed); null => R5 but the slot is empty (dim
  // circle); undefined => not Round 5, hide the badge entirely.
  function setWeaponBadge(side, weapon) {
    const box = weaponBox[side];
    if (!box) return;
    if (weapon === undefined) {
      box.style.display = "none";
      return;
    }
    box.style.display = "flex";
    const img = box.querySelector("img");
    const url = WEAPON_ICON[weapon];
    if (url) {
      if (img.getAttribute("src") !== url) img.setAttribute("src", url);
      box.classList.add("armed");
      box.classList.remove("empty");
    } else {
      box.classList.add("empty");
      box.classList.remove("armed");
    }
  }
  const heartBox = { blue: $("#fb-hearts-blue"), red: $("#fb-hearts-red") };
  function setProgressPips(side, filled, max, kind) {
    const box = heartBox[side];
    if (!box) return;
    if (filled == null || !max) {
      box.style.display = "none";
      return;
    }
    box.style.display = "flex";
    const svg = kind === "tomato" ? TOMATO_SVG : kind === "flag" ? FLAG_SVG : HEART_SVG;
    if (box.childElementCount !== max || box.dataset.kind !== kind) {
      box.innerHTML = svg.repeat(max);
      box.dataset.kind = kind;
    }
    box.querySelectorAll(".fb-heart,.fb-tomato,.fb-flag").forEach((pip, i) => {
      const on = i < filled;
      pip.classList.toggle("alive", on);
      pip.classList.toggle("lost", !on);
    });
  }

  window.addEventListener("rl-snapshot", (e) => {
    const s = e.detail.stats;
    if (!s) return;
    refreshPortraits(); // pick up character switches without a reload
    const r = s.round || {};
    const total = Math.max(1, r.total ?? 1);
    $("#fb-round-i").textContent = (r.index ?? 0) + 1;
    $("#fb-round-t").textContent = total;
    $("#fb-algo-blue").textContent = r.labelBlue || s.algoBlue || "";
    $("#fb-algo-red").textContent = r.labelRed || s.algoRed || "";
    // bars = each side's RECENT win share; the rAF loop eases the fill toward this smoothly
    const rr = s.recentRate || {};
    barTarget.blue = (rr.blue ?? 0) * 100;
    barTarget.red = (rr.red ?? 0) * 100;
    // round-win dots: a point lights under each character for every round they won
    const sb = s.score?.blue ?? 0,
      sr = s.score?.red ?? 0;
    $("#fb-dots-blue")
      .querySelectorAll("i")
      .forEach((d, i) => d.classList.toggle("on", i < sb));
    $("#fb-dots-red")
      .querySelectorAll("i")
      .forEach((d, i) => d.classList.toggle("on", i < sr));

    // Arena 4: remaining lives (hearts). Arena 2: collected-tomato count. Arena 5:
    // captured flags. Any other round hides the same shared progress row.
    const frame = e.detail.frame;
    // the held-weapon badge is Round-5 only; hide it every other round
    setWeaponBadge("blue", undefined);
    setWeaponBadge("red", undefined);
    const hearts =
      frame && frame.gameMode === "missileSurvival" ? frame.hearts : null;
    if (hearts) {
      const maxHearts = frame.maxHearts || 3;
      setProgressPips("blue", hearts.blue, maxHearts, "heart");
      setProgressPips("red", hearts.red, maxHearts, "heart");
    } else if (frame && frame.gameMode === "captureFlag") {
      const cap = frame.captures || {};
      const max = frame.capturesToWin || 3;
      setProgressPips("blue", cap.blue || 0, max, "flag");
      setProgressPips("red", cap.red || 0, max, "flag");
      const w = frame.weapons || {};
      setWeaponBadge("blue", w.blue ?? null);
      setWeaponBadge("red", w.red ?? null);
    } else if (frame && frame.nStars) {
      const bitCount = (bits) => {
        let count = 0;
        for (let n = Number(bits) >>> 0; n; n >>>= 1) count += n & 1;
        return count;
      };
      setProgressPips("blue", bitCount(frame.blueStars), frame.nStars, "tomato");
      setProgressPips("red", bitCount(frame.redStars), frame.nStars, "tomato");
    } else {
      setProgressPips("blue", null, null, "heart");
      setProgressPips("red", null, null, "heart");
    }

    const finishKey = document.getElementById("rl-finish-key");
    const finishTxt = document.getElementById("rl-finish-txt");
    if (finishKey && finishTxt) {
      // this round's result comes straight from roundResults (set only when T is
      // pressed): 'blue' | 'red' | 'draw' | null. It drives the label + the T-square
      // colour, and tells terminateStage the stage is already decided.
      const result = s.roundResults?.[r.index ?? 0] || null;
      latestResult = result;
      finishKey.classList.remove("armed", "done", "blue", "red", "draw");
      if (result === "blue" || result === "red") {
        finishKey.classList.add("done", result);
        finishTxt.textContent = result === "blue" ? "Player" : "CPU";
      } else if (result === "draw") {
        finishKey.classList.add("done", "draw");
        finishTxt.textContent = "Draw";
      } else {
        finishTxt.textContent = "Terminate";
      }
    }
  });

  return { el: hud, terminate: terminateStage };
}
