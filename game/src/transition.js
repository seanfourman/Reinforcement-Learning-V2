// Video-game-style arena transition. A full-screen curtain wipes in, the world
// is rebuilt while the screen is covered, a "Round N - <Theme>" card flips up,
// then the curtain wipes away to reveal the new arena.
//
// Pure DOM/CSS (independent of the three.js scene), so it works regardless of
// what the renderer is doing. Driven by a small setTimeout sequence.

const STYLE = `
#rl-curtain{position:fixed;inset:0;z-index:50;pointer-events:none;opacity:0;
  background:radial-gradient(120% 120% at 50% 40%,#202444 0%,#0b0d1a 75%);
  transition:opacity .42s ease;display:flex;align-items:center;justify-content:center;}
#rl-curtain.show{opacity:1;pointer-events:auto;}
#rl-curtain .card{transform:translateY(18px) scale(.96);opacity:0;
  transition:transform .5s cubic-bezier(.2,.9,.2,1),opacity .5s ease;
  text-align:center;color:#fff;font-family:"Segoe UI",system-ui,sans-serif;}
#rl-curtain.show .card{transform:translateY(0) scale(1);opacity:1;}
#rl-curtain .pre{font-size:13px;letter-spacing:6px;text-transform:uppercase;
  color:#8fb4f5;opacity:.9;}
#rl-curtain .ttl{font-size:54px;font-weight:800;margin:6px 0 4px;letter-spacing:1px;
  text-shadow:0 4px 24px rgba(0,0,0,.6);}
#rl-curtain .vs{font-size:16px;color:#d8d8e6;}
#rl-curtain .vs b.r{color:#ff9a90;} #rl-curtain .vs b.b{color:#9cc0f5;}
`;

export function createTransition() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const curtain = document.createElement('div');
  curtain.id = 'rl-curtain';
  curtain.innerHTML = `<div class="card">
      <div class="pre" id="rl-cur-pre">Round 1</div>
      <div class="ttl" id="rl-cur-ttl">Arena</div>
      <div class="vs" id="rl-cur-vs"></div>
    </div>`;
  document.body.appendChild(curtain);

  const pre = curtain.querySelector('#rl-cur-pre');
  const ttl = curtain.querySelector('#rl-cur-ttl');
  const vs = curtain.querySelector('#rl-cur-vs');
  let busy = false;

  function play(worldJson, stats, doRebuild) {
    if (busy) { doRebuild(); return; }   // never skip the rebuild
    busy = true;
    const r = (stats && stats.round) || {};
    pre.textContent = `Round ${(r.index ?? (worldJson.roundId - 1)) + 1}`
      + (r.total ? ` / ${r.total}` : '');
    ttl.textContent = worldJson.title || r.title || 'Arena';
    const lr = r.labelRed || (stats && stats.algoRed) || '';
    const lb = r.labelBlue || (stats && stats.algoBlue) || '';
    vs.innerHTML = lr && lb ? `<b class="r">${lr}</b> &nbsp;vs&nbsp; <b class="b">${lb}</b>` : '';

    curtain.classList.add('show');
    // rebuild while fully covered, then reveal
    setTimeout(() => { doRebuild(); }, 460);
    setTimeout(() => { curtain.classList.remove('show'); }, 1500);
    setTimeout(() => { busy = false; }, 1960);
  }

  return { play };
}
