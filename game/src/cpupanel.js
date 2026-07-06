// The CPU (Red) config panel - opens on the RIGHT with N, a mirror of the player's
// Hyperparameters panel but for the opponent. Every slider is LOCKED (read-only) so
// you can inspect the CPU's values; an Unlock button lets you override them live
// (the override lasts until the chosen CPU character/tier changes).
//
// Red params route to setRedParams; the two shared globals (max steps, stop after)
// route to setParams, same as the left panel.

import { PARAMS, DP_ALGOS, DQN_ALGOS, NAMES } from './panel.js';
import { getCpuName } from './startmenu.js';
import { initCurves } from './graphs.js';

const GLOBAL_KEYS = new Set(['maxSteps', 'targetEpisodes']);   // shared by both models
const TIER_LABELS = { 1: 'Rookie', 2: 'Amateur', 3: 'Skilled', 4: 'Veteran', 5: 'Master' };

const STYLE = `
#rl-cpanel{position:fixed;top:0;right:0;height:100%;width:384px;z-index:10;
  transform:translateX(398px);transition:transform .34s cubic-bezier(.2,.8,.2,1);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#1f1f21;background:#f3f4f6;box-shadow:-3px 0 24px rgba(0,0,0,.26);
  border-left:1px solid #e0e2e6;overflow-y:auto;overflow-x:hidden;}
#rl-cpanel.open{transform:translateX(0);}
#rl-cpanel::-webkit-scrollbar{width:11px;}
#rl-cpanel::-webkit-scrollbar-thumb{background:#cdd0d6;border-radius:6px;border:3px solid #f3f4f6;}
#rl-cpanel .hdr{position:sticky;top:0;z-index:2;padding:15px 16px 13px;background:#fff;border-bottom:1px solid #e6e8ec;}
#rl-cpanel .hdr h1{margin:0;font-size:16px;font-weight:800;letter-spacing:-.2px;display:flex;align-items:center;gap:9px;}
#rl-cpanel .hdr h1::before{content:"";width:5px;height:17px;border-radius:3px;background:#d4141f;}
#rl-cpanel .hdr .sub{margin:7px 0 0;font-size:11px;color:#9a9da4;}
#rl-cpanel .hdr .myalgo{margin-top:11px;}
#rl-cpanel .hdr .myalgo b{display:block;font-size:21px;font-weight:800;color:#d4141f;letter-spacing:-.3px;line-height:1.15;}
#rl-cpanel .hdr .myalgo em{display:block;font-style:normal;font-size:10.5px;color:#9a9da4;margin-top:4px;}
/* the lock toggle: a small rounded button top-right of the header (red when unlocked) */
#rl-cpanel .hdr .lockbtn{position:absolute;top:13px;right:14px;width:34px;height:34px;padding:0;
  display:grid;place-items:center;border:1px solid #d7dade;border-radius:10px;background:#fff;
  color:#8a8d94;cursor:pointer;transition:background .12s,color .12s,border-color .12s;}
#rl-cpanel .hdr .lockbtn:hover{background:#f0f1f3;color:#54565c;border-color:#c4c8ce;}
#rl-cpanel .hdr .lockbtn.locked{background:#d4141f;border-color:#b8101a;color:#fff;}
#rl-cpanel .hdr .lockbtn.locked:hover{background:#b8101a;color:#fff;}
#rl-cpanel .hdr .lockbtn svg{width:18px;height:18px;display:block;}
#rl-cpanel section{margin:11px 11px;padding:13px 14px;background:#fff;border:1px solid #e6e8ec;border-radius:13px;box-shadow:0 1px 2px rgba(20,20,30,.04);}
#rl-cpanel h2{margin:0 0 12px;font-size:10.5px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:#8a8d94;}
#rl-cpanel button{width:100%;padding:9px 6px;border:1px solid #d7dade;border-radius:9px;background:#fff;color:#26272b;
  font:inherit;font-size:12px;font-weight:600;cursor:pointer;outline:none;transition:background .12s,border-color .12s,color .12s;}
#rl-cpanel button:focus,#rl-cpanel button:focus-visible{outline:none;box-shadow:none;}
#rl-cpanel button:hover{background:#f0f1f3;}
#rl-cpanel button.primary{background:#d4141f;border-color:#b8101a;color:#fff;}
#rl-cpanel button.primary:hover{background:#b8101a;}
#rl-cpanel .plegend{display:flex;gap:16px;margin:0 0 14px;font-size:10.5px;color:#8a8d94;}
#rl-cpanel .plegend i{display:inline-block;width:9px;height:9px;border-radius:3px;vertical-align:middle;margin-right:5px;}
#rl-cpanel .ctl{margin:0 0 13px;}
#rl-cpanel .ctl:last-child{margin-bottom:0;}
#rl-cpanel .ctl .row{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;margin-bottom:6px;}
#rl-cpanel .ctl .row span{color:#54565c;}
#rl-cpanel .ctl .row b{font-variant-numeric:tabular-nums;color:#1f1f21;font-weight:700;}
#rl-cpanel input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:3px;
  background:#e1e3e8;outline:none;margin:0;cursor:pointer;}
#rl-cpanel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;
  border-radius:50%;background:#fff;border:2px solid var(--fill,#d4141f);box-shadow:0 1px 2px rgba(0,0,0,.3);}
#rl-cpanel input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;
  border:2px solid var(--fill,#d4141f);box-shadow:0 1px 2px rgba(0,0,0,.3);}
#rl-cpanel input[type=range]:disabled{cursor:default;}
#rl-cpanel input[type=range]:disabled::-webkit-slider-thumb{background:#eef0f3;cursor:default;}
#rl-cpanel input[type=range]:disabled::-moz-range-thumb{background:#eef0f3;cursor:default;}
#rl-cpanel .note{font-size:10.5px;color:#a2a5ac;margin:11px 0 0;line-height:1.45;}
#rl-cpanel .stat{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:7px 0;border-bottom:1px solid #f0f1f3;}
#rl-cpanel .stat:last-child{border-bottom:0;}
#rl-cpanel .stat>span{color:#54565c;}
#rl-cpanel .stat b{font-variant-numeric:tabular-nums;font-weight:700;}
#rl-cpanel .seg{display:flex;border:1px solid #d7dade;border-radius:9px;overflow:hidden;}
#rl-cpanel .seg button{width:auto;flex:1;border:0;border-right:1px solid #d7dade;border-radius:0;background:#fff;}
#rl-cpanel .seg button:last-child{border-right:0;}
#rl-cpanel .seg button.active{background:#1f1f21;color:#fff;}
#rl-cpanel .hint{font-size:11px;color:#a2a5ac;margin-top:7px;line-height:1.45;}
/* per-side learning curves (built by graphs.js initCurves) */
#rl-cpanel .chart{margin:0 0 14px;}
#rl-cpanel .chart:last-child{margin-bottom:0;}
#rl-cpanel .chart .ct{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
#rl-cpanel .chart .ct h3{margin:0;font-size:11.5px;font-weight:700;color:#3a3b40;}
#rl-cpanel .chart .ct .lg{font-size:9.5px;color:#9a9da4;display:flex;gap:10px;}
#rl-cpanel .chart .ct .lg i{display:inline-block;width:10px;height:3px;border-radius:2px;vertical-align:middle;margin-right:4px;}
#rl-cpanel .chart canvas{width:100%;height:94px;background:#fbfbfc;border:1px solid #eceef1;border-radius:9px;display:block;}
`;

export function initCpuPanel() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  // red fill for the CPU's own params, gray for the shared globals
  const fillOf = (key) => (GLOBAL_KEYS.has(key) ? '#8a8d94' : '#d4141f');
  const ctlHTML = (p) => `
    <div class="ctl" data-scope="${p.scope}">
      <div class="row"><span>${p.label}</span><b id="rl-cpv-${p.key}">-</b></div>
      <input type="range" id="rl-cp-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}"
        value="${p.min}" style="--fill:${fillOf(p.key)}" disabled>
    </div>`;

  // lock icons for the header toggle (closed = locked, open = editable)
  const LOCK_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
  const LOCK_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 7.8-1.1"/></svg>';

  const panel = document.createElement('div');
  panel.id = 'rl-cpanel';
  panel.innerHTML = `
    <div class="hdr">
      <button id="rl-cp-unlock" class="lockbtn locked" type="button" title="Unlock to edit the CPU's values" aria-label="Unlock to edit">${LOCK_CLOSED}</button>
      <h1>CPU Control</h1>
      <p class="sub" id="rl-cp-char">Opponent · read-only</p>
      <div class="myalgo"><b id="rl-cp-algo">-</b><em id="rl-cp-tier"></em></div>
    </div>
    <section>
      <h2>Hyperparameters</h2>
      <div class="plegend">
        <span><i style="background:#d4141f"></i>CPU param</span>
        <span><i style="background:#8a8d94"></i>Both models</span>
      </div>
      ${PARAMS.map(ctlHTML).join('')}
    </section>
    <section>
      <h2>CPU stats</h2>
      <div class="stat"><span>Exploration ε</span><b id="rl-cp-eps">-</b></div>
      <div class="stat"><span>Learned states</span><b id="rl-cp-q">-</b></div>
    </section>
    <section>
      <h2>Value map · CPU</h2>
      <div class="seg">
        <button id="rl-cp-h-off" class="active">Off</button>
        <button id="rl-cp-h-value">Value</button>
        <button id="rl-cp-h-visits">Visits</button>
      </div>
      <p class="hint">Value: each tile shows the CPU's Q for N / S / W / E. Visits: where the CPU
        travels (red = most, blue = least). Zoom in to read the numbers.</p>
    </section>`;
  document.body.appendChild(panel);
  initCurves(panel, 'red');   // Red's learning curves at the bottom of this panel

  const $ = (id) => panel.querySelector(id);

  // value map: this panel always shows the CPU model (Red), modes Off / Value / Visits
  const hb = { off: $('#rl-cp-h-off'), value: $('#rl-cp-h-value'), visits: $('#rl-cp-h-visits') };
  const setHeat = (m) => {
    for (const k in hb) hb[k].classList.toggle('active', k === m);
    window.RL.setHeatmap(m === 'off' ? null : 'red', m);
  };
  hb.off.addEventListener('click', () => setHeat('off'));
  hb.value.addEventListener('click', () => setHeat('value'));
  hb.visits.addEventListener('click', () => setHeat('visits'));
  // one shared overlay: if the player panel grabs it, fall back to Off here
  window.addEventListener('rl-heatmap', (e) => {
    if ((e.detail || {}).agent !== 'red') {
      for (const k in hb) hb[k].classList.toggle('active', k === 'off');
    }
  });
  const paintRange = (el) => {
    const min = +el.min, max = +el.max, v = +el.value;
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    const fill = el.style.getPropertyValue('--fill') || '#8a8d94';
    el.style.background = `linear-gradient(to right,${fill} ${pct}%,#e1e3e8 ${pct}%)`;
  };
  const setLabel = (p) => {
    const el = $(`#rl-cp-${p.key}`);
    $(`#rl-cpv-${p.key}`).textContent = p.fmt(+el.value);
    paintRange(el);
  };

  // ---- toggle (M key) ----
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !/input|select|textarea/i.test(e.target.tagName)) panel.classList.toggle('open');
  });

  // ---- lock / unlock ----
  let unlocked = false;
  const unlockBtn = $('#rl-cp-unlock');
  const setUnlocked = (on) => {
    unlocked = on;
    panel.querySelectorAll('.ctl input[type=range]').forEach((el) => { el.disabled = !on; });
    unlockBtn.innerHTML = on ? LOCK_OPEN : LOCK_CLOSED;
    unlockBtn.classList.toggle('locked', !on);
    unlockBtn.title = on ? "Lock the CPU's values" : "Unlock to edit the CPU's values";
  };
  unlockBtn.addEventListener('click', () => setUnlocked(!unlocked));

  // ---- edits (only fire while unlocked = enabled) ----
  let applyTimer = null, pendingKey = null;
  const sendOne = (key) => {
    const v = +$(`#rl-cp-${key}`).value;
    const cmd = GLOBAL_KEYS.has(key) ? 'setParams' : 'setRedParams';
    window.RL.control({ cmd, params: { [key]: v } });
  };
  for (const p of PARAMS) {
    setLabel(p);
    $(`#rl-cp-${p.key}`).addEventListener('input', () => {
      setLabel(p);
      pendingKey = p.key;
      clearTimeout(applyTimer);
      applyTimer = setTimeout(() => pendingKey && sendOne(pendingKey), 160);
    });
  }

  // ---- show only the controls relevant to Red's algorithm ----
  let lastAlgoRed = null;
  const showRelevant = (algoRed) => {
    const isDP = DP_ALGOS.has(algoRed);
    const isDqn = DQN_ALGOS.has(algoRed);
    panel.querySelectorAll('.ctl[data-scope]').forEach((el) => {
      const sc = el.dataset.scope;
      let show = true;
      if (sc === 'learn') show = !isDP;
      else if (sc === 'dqn') show = isDqn;
      el.style.display = show ? '' : 'none';
    });
  };

  // ---- live mirror of the CPU's values ----
  window.addEventListener('rl-snapshot', (e) => {
    const s = e.detail.stats;
    if (!s) return;
    const nm = getCpuName();
    $('#rl-cp-char').textContent = nm ? `${nm} · the Computer` : 'Opponent · read-only';
    $('#rl-cp-algo').textContent = NAMES[s.algoRed] || s.algoRed || '-';
    const t = s.cpuTier || 0;
    $('#rl-cp-tier').textContent = t ? `Tier ${t} · ${TIER_LABELS[t] || ''}` : '';
    if (s.algoRed !== lastAlgoRed) { lastAlgoRed = s.algoRed; showRelevant(s.algoRed); }
    // while LOCKED, mirror the backend's live values; while unlocked, keep the user's edits
    if (!unlocked && s.redParams) {
      for (const p of PARAMS) {
        const el = $(`#rl-cp-${p.key}`);
        if (el && s.redParams[p.key] != null) { el.value = s.redParams[p.key]; setLabel(p); }
      }
    }
    if (s.redEpsilon != null) $('#rl-cp-eps').textContent = s.redEpsilon.toFixed(2);
    if (s.qStates) $('#rl-cp-q').textContent = s.qStates.red.toLocaleString();
  });
}
