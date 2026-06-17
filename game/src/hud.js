// Tournament score HUD: BLUE top-left, RED top-right (as requested), with a
// round banner in the top centre (theme title + "Round i/N" + the matchup, e.g.
// "Value Iteration vs Policy Iteration"). Each side shows its cumulative
// tournament score (round-wins) big, plus this round's live win tally + rate.
//
// Purely event-driven: it listens for the 'rl-snapshot' CustomEvent that main.js
// dispatches every poll, and reads snapshot.stats.

const STYLE = `
#rl-hud{position:fixed;top:0;left:0;right:0;z-index:8;pointer-events:none;
  font-family:"Segoe UI",system-ui,sans-serif;display:flex;justify-content:space-between;
  align-items:flex-start;padding:12px 14px;}
.rl-side{min-width:170px;border-radius:12px;padding:8px 14px;color:#fff;
  box-shadow:0 6px 22px rgba(0,0,0,.35);backdrop-filter:blur(3px);}
.rl-side.blue{background:linear-gradient(135deg,rgba(40,86,160,.92),rgba(63,111,214,.86));
  border:1px solid #9cc0f5;text-align:left;}
.rl-side.red{background:linear-gradient(135deg,rgba(160,45,45,.92),rgba(216,71,63,.86));
  border:1px solid #f3b0ab;text-align:right;}
.rl-side .who{font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85;}
.rl-side .algo{font-size:13px;font-weight:600;margin-top:1px;}
.rl-side .score{font-size:40px;font-weight:800;line-height:1;margin-top:2px;
  font-variant-numeric:tabular-nums;text-shadow:0 2px 6px rgba(0,0,0,.4);}
.rl-side .round{font-size:11px;opacity:.85;margin-top:3px;}
#rl-banner{align-self:flex-start;margin-top:2px;text-align:center;color:#fff;
  background:rgba(20,22,38,.74);border:1px solid rgba(255,255,255,.18);
  border-radius:12px;padding:8px 20px;box-shadow:0 6px 22px rgba(0,0,0,.4);
  backdrop-filter:blur(3px);max-width:42vw;}
#rl-banner .ttl{font-size:16px;font-weight:700;letter-spacing:.5px;}
#rl-banner .rnd{font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.7;margin-top:1px;}
#rl-banner .vs{font-size:12px;margin-top:4px;}
#rl-banner .vs b.r{color:#ff9a90;} #rl-banner .vs b.b{color:#9cc0f5;}
`;

export function initHud() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const hud = document.createElement('div');
  hud.id = 'rl-hud';
  hud.innerHTML = `
    <div class="rl-side blue">
      <div class="who">Blue</div>
      <div class="algo" id="hud-algo-b">—</div>
      <div class="score" id="hud-score-b">0</div>
      <div class="round" id="hud-round-b">this round: 0 wins</div>
    </div>
    <div id="rl-banner">
      <div class="ttl" id="hud-title">—</div>
      <div class="rnd" id="hud-round">Round 1</div>
      <div class="vs" id="hud-vs"></div>
    </div>
    <div class="rl-side red">
      <div class="who">Red</div>
      <div class="algo" id="hud-algo-r">—</div>
      <div class="score" id="hud-score-r">0</div>
      <div class="round" id="hud-round-r">this round: 0 wins</div>
    </div>`;
  document.body.appendChild(hud);

  const $ = (id) => hud.querySelector(id);

  window.addEventListener('rl-snapshot', (e) => {
    const s = e.detail.stats;
    if (!s) return;
    const r = s.round || {};
    $('#hud-title').textContent = r.title || 'Arena';
    $('#hud-round').textContent = `Round ${(r.index ?? 0) + 1} / ${r.total ?? 1}`;
    $('#hud-vs').innerHTML =
      `<b class="r">${r.labelRed || s.algoRed}</b> vs <b class="b">${r.labelBlue || s.algoBlue}</b>`;
    $('#hud-algo-b').textContent = r.labelBlue || s.algoBlue || '';
    $('#hud-algo-r').textContent = r.labelRed || s.algoRed || '';
    $('#hud-score-b').textContent = s.score?.blue ?? 0;
    $('#hud-score-r').textContent = s.score?.red ?? 0;
    $('#hud-round-b').textContent = `this round: ${s.wins?.blue ?? 0} wins`;
    $('#hud-round-r').textContent = `this round: ${s.wins?.red ?? 0} wins`;
  });

  return { el: hud };
}
