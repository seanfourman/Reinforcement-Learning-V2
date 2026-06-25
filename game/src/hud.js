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
#rl-hud{position:fixed;top:0;left:0;right:0;z-index:8;pointer-events:none;display:flex;
  align-items:center;justify-content:center;gap:48px;padding:30px 16px 0;font-family:"Segoe UI",system-ui,sans-serif;}
.fb-side{flex:none;display:flex;align-items:center;gap:0;}
.fb-side.red{flex-direction:row-reverse;}
/* character portrait at the corner (on top, so the bar tucks in behind it) */
.fb-port{position:relative;z-index:10;height:98px;width:auto;filter:drop-shadow(0 5px 9px rgba(0,0,0,.6));}
.fb-side.blue .fb-port{transform:scaleX(-1);} /* flip the left one to face inward */
/* name tag (above) + meter (below), beside the character */
.fb-col{position:relative;flex:none;display:flex;flex-direction:column;gap:0;}
.fb-side.blue .fb-col{align-items:flex-start;}
.fb-side.red .fb-col{align-items:flex-end;}
/* slanted fighting-game name tag */
.fb-tag{display:inline-flex;border:2.5px solid #000;border-radius:3px;overflow:hidden;box-shadow:0 3px 7px rgba(0,0,0,.55);}
.fb-side.blue .fb-tag{transform:skewX(12deg);position:relative;z-index:3;left:-12px;}
.fb-side.red .fb-tag{transform:skewX(-12deg);flex-direction:row-reverse;position:relative;z-index:3;left:12px;}
.fb-px{padding:2px 8px;display:flex;align-items:center;font-weight:900;font-size:11px;letter-spacing:.5px;
  color:#1a1207;background:linear-gradient(180deg,#ffe171,#ffbf17);}
.fb-nm{padding:2px 13px;display:flex;align-items:center;font-weight:900;font-size:13.5px;color:#fff;
  white-space:nowrap;letter-spacing:.3px;text-shadow:0 1px 2px rgba(0,0,0,.6);}
.fb-side.blue .fb-nm{background:linear-gradient(180deg,#4f97ff,#1d4fc6);}
.fb-side.red .fb-nm{background:linear-gradient(180deg,#ff6a5d,#bf1c1c);}
/* BLACK track + thick black cartoonish border + 3D shadow; blue/red glossy fill kept */
.fb-meter{position:relative;z-index:5;width:300px;height:18px;border:3px solid #000;border-radius:5px;
  background:#0b0b0b;box-shadow:0 3px 0 #000,inset 0 2px 4px rgba(0,0,0,.7);}
.fb-side.blue .fb-meter{transform:skewX(12deg);left:-22px;}
.fb-side.red .fb-meter{transform:skewX(-12deg);left:22px;}
.fb-fill{position:absolute;top:0;bottom:0;left:0;width:0;background-size:200% 100%;border-radius:2px;
  animation:fb-shimmer 1.4s linear infinite;}
.fb-side.red .fb-fill{left:auto;right:0;}
.fb-side.blue .fb-fill{background-image:linear-gradient(90deg,#1f53c8,#5aa6ff,#cfe6ff,#5aa6ff,#1f53c8);
  box-shadow:inset 0 3px 4px rgba(255,255,255,.55),inset 0 -4px 6px rgba(0,0,0,.35),0 0 15px #57a0ff;}
.fb-side.red .fb-fill{background-image:linear-gradient(90deg,#bf1c1c,#ff7a6c,#ffd6cf,#ff7a6c,#bf1c1c);
  box-shadow:inset 0 3px 4px rgba(255,255,255,.55),inset 0 -4px 6px rgba(0,0,0,.35),0 0 15px #ff7060;}
@keyframes fb-shimmer{0%{background-position:0 0}100%{background-position:200% 0}}
.fb-rate{position:absolute;top:50%;transform:translateY(-50%);font-size:11px;font-weight:800;color:#fff;
  text-shadow:0 1px 3px #000;font-variant-numeric:tabular-nums;}
.fb-side.blue .fb-rate{right:6px;} .fb-side.red .fb-rate{left:6px;}
/* centre block: round number */
#fb-center{flex:none;display:flex;flex-direction:column;align-items:center;gap:5px;color:#fff;}
#fb-center .rnd{font-size:13px;font-weight:900;letter-spacing:2px;text-transform:uppercase;
  background:rgba(16,18,34,.82);border:2px solid rgba(255,255,255,.2);border-radius:8px;padding:4px 13px;
  box-shadow:0 4px 14px rgba(0,0,0,.5);white-space:nowrap;}
/* round-win dots under each bar — absolute so they don't change the column layout */
.fb-dots{position:absolute;top:100%;margin-top:7px;display:flex;gap:8px;}
.fb-side.blue .fb-dots{left:8px;}
.fb-side.red .fb-dots{right:8px;flex-direction:row-reverse;}
/* cartoonish dot: BLACK when not won + thick black border + 3D shadow; lights the side colour */
.fb-dots i{width:14px;height:14px;border-radius:50%;border:2.5px solid #000;background:#0c0c0c;
  box-shadow:0 2px 0 #000;transition:background .2s;}
.fb-side.blue .fb-dots i.on{background:radial-gradient(circle at 35% 30%,#7fb4ff,#2f6bd6);}
.fb-side.red .fb-dots i.on{background:radial-gradient(circle at 35% 30%,#ff8d80,#d8392c);}
`;

export function initHud() {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const hud = document.createElement("div");
  hud.id = "rl-hud";
  const sideHTML = (side, px) =>
    `<div class="fb-side ${side}">
      <img class="fb-port" id="fb-port-${side}" alt="" />
      <div class="fb-col">
        <div class="fb-tag"><span class="fb-px">${px}</span><span class="fb-nm" id="fb-algo-${side}">—</span></div>
        <div class="fb-meter"><div class="fb-fill" id="fb-fill-${side}"></div><span class="fb-rate" id="fb-rate-${side}"></span></div>
        <div class="fb-dots" id="fb-dots-${side}"></div>
      </div>
    </div>`;
  hud.innerHTML =
    sideHTML("blue", "P1") +
    `<div id="fb-center"><div class="rnd" id="fb-round">Round 1 / 1</div></div>` +
    sideHTML("red", "CPU");
  document.body.appendChild(hud);

  const $ = (id) => hud.querySelector(id);
  // crop each icon's transparent padding so the image box edge IS the character edge — then
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
  const fillBlue = $("#fb-fill-blue"), fillRed = $("#fb-fill-red");
  const rateBlue = $("#fb-rate-blue"), rateRed = $("#fb-rate-red");
  const barTarget = { blue: 0, red: 0 }, barCur = { blue: 0, red: 0 };
  const tickBars = () => {
    barCur.blue += (barTarget.blue - barCur.blue) * 0.08;
    barCur.red += (barTarget.red - barCur.red) * 0.08;
    fillBlue.style.width = `${barCur.blue.toFixed(2)}%`;
    fillRed.style.width = `${barCur.red.toFixed(2)}%`;
    rateBlue.textContent = `${Math.round(barCur.blue)}%`;
    rateRed.textContent = `${Math.round(barCur.red)}%`;
    requestAnimationFrame(tickBars);
  };
  requestAnimationFrame(tickBars);

  window.addEventListener("rl-snapshot", (e) => {
    const s = e.detail.stats;
    if (!s) return;
    refreshPortraits(); // pick up character switches without a reload
    const r = s.round || {};
    const total = Math.max(1, r.total ?? 1);
    $("#fb-round").textContent = `Round ${(r.index ?? 0) + 1} / ${total}`;
    $("#fb-algo-blue").textContent = r.labelBlue || s.algoBlue || "";
    $("#fb-algo-red").textContent = r.labelRed || s.algoRed || "";
    // bars = each side's RECENT win share; the rAF loop eases the fill toward this smoothly
    const rr = s.recentRate || {};
    barTarget.blue = (rr.blue ?? 0) * 100;
    barTarget.red = (rr.red ?? 0) * 100;
    // round-win dots: a point lights under each character for every round they won
    const sb = s.score?.blue ?? 0,
      sr = s.score?.red ?? 0;
    $("#fb-dots-blue").querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < sb));
    $("#fb-dots-red").querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < sr));
  });

  return { el: hud };
}
