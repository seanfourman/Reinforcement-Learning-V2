// The CPU (Red) model-specific sections, folded INTO the training control panel. There
// is no separate panel / key: the header's model selector switches a data-model flag on
// #rl-panel, and the CPU's sections (tagged data-model="cpu") take the place of the
// player's in the Tune + Inside tabs (everything else is shared). Every CPU slider is
// LOCKED (read-only) for inspection; the header lock (swings in on the CPU model) unlocks
// live overrides. Red params route to setRedParams; the two shared globals to setParams.

import { PARAMS, DP_ALGOS, DQN_ALGOS, NAMES } from './panel.js';

const GLOBAL_KEYS = new Set(['maxSteps', 'targetEpisodes']);   // shared by both models
const TIER_LABELS = { 1: 'Rookie', 2: 'Amateur', 3: 'Skilled', 4: 'Veteran', 5: 'Master' };

// Only what DIFFERS from the player panel: the swing-in lock and the locked-slider dim.
// (The red tab accent + the your/cpu section toggle live in panel.js.)
const STYLE = `
/* the lock: top-right of the panel; swings in from the right on the CPU model only */
#rl-panel .lockbtn{position:absolute;top:13px;right:14px;z-index:6;width:34px;height:34px;padding:0;
  display:grid;place-items:center;border:1px solid #d7dade;border-radius:50%;background:#fff;color:#8a8d94;cursor:pointer;
  opacity:0;transform:translateX(64px) rotate(14deg);pointer-events:none;
  transition:opacity .26s ease,transform .4s cubic-bezier(.34,1.42,.5,1),background .12s,color .12s,border-color .12s;}
#rl-panel .lockbtn.show{opacity:1;transform:translateX(0) rotate(0);pointer-events:auto;}
#rl-panel .lockbtn:hover{background:#f0f1f3;color:#54565c;border-color:#c4c8ce;}
#rl-panel .lockbtn.locked{background:#d4141f;border-color:#b8101a;color:#fff;}
#rl-panel .lockbtn.locked:hover{background:#b8101a;color:#fff;}
#rl-panel .lockbtn svg{width:18px;height:18px;display:block;}
/* locked CPU sliders read grayed out */
#rl-panel #rl-cp-hyper .ctl{transition:opacity .15s;}
#rl-panel #rl-cp-hyper .ctl:has(input:disabled){opacity:.5;}
#rl-panel #rl-cp-hyper input[type=range]:disabled{cursor:default;}
#rl-panel #rl-cp-hyper input[type=range]:disabled::-webkit-slider-thumb{background:#eef0f3;cursor:default;}
#rl-panel #rl-cp-hyper input[type=range]:disabled::-moz-range-thumb{background:#eef0f3;cursor:default;}
`;

// lock icons for the header toggle (closed = locked, open = editable)
const LOCK_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
const LOCK_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 7.8-1.1"/></svg>';

// Build the CPU's sections into `body` (they get tagged data-model="cpu" so panel.js's
// selector shows them in place of the player's), and wire the shared header's lock.
// `root` (= #rl-panel) reaches the header's CPU name/tier fields.
export function initCpuPanel(root, body, lockBtn) {
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

  body.insertAdjacentHTML('beforeend', `
    <section id="rl-cp-hyper" data-model="cpu">
      <h2>Hyperparameters</h2>
      <div class="plegend">
        <span><i style="background:#d4141f"></i>CPU param</span>
        <span><i style="background:#8a8d94"></i>Both models</span>
      </div>
      ${PARAMS.map(ctlHTML).join('')}
    </section>`);

  const $ = (sel) => root.querySelector(sel);

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

  // ---- lock / unlock (the lock lives in the shared header, passed in) ----
  lockBtn.innerHTML = LOCK_CLOSED;
  lockBtn.classList.add('locked');
  lockBtn.title = "Unlock to edit the CPU's values";
  let unlocked = false;
  const setUnlocked = (on) => {
    unlocked = on;
    root.querySelectorAll('#rl-cp-hyper input[type=range]').forEach((el) => { el.disabled = !on; });
    lockBtn.innerHTML = on ? LOCK_OPEN : LOCK_CLOSED;
    lockBtn.classList.toggle('locked', !on);
    lockBtn.title = on ? "Lock the CPU's values" : "Unlock to edit the CPU's values";
  };
  lockBtn.addEventListener('click', () => setUnlocked(!unlocked));

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
    root.querySelectorAll('#rl-cp-hyper .ctl[data-scope]').forEach((el) => {
      const sc = el.dataset.scope;
      let show = true;
      if (sc === 'learn') show = !isDP;
      else if (sc === 'dqn') show = isDqn;
      el.style.display = show ? '' : 'none';
    });
  };

  // ---- live mirror of the CPU's values (name/tier live in the header selector) ----
  window.addEventListener('rl-snapshot', (e) => {
    const s = e.detail.stats;
    if (!s) return;
    const algoEl = $('#rl-cp-algo');
    if (algoEl) algoEl.textContent = NAMES[s.algoRed] || s.algoRed || '-';
    const tierEl = $('#rl-cp-tier');
    const t = s.cpuTier || 0;
    if (tierEl) tierEl.textContent = t ? `Tier ${t} - ${TIER_LABELS[t] || ''}` : '';
    if (s.algoRed !== lastAlgoRed) { lastAlgoRed = s.algoRed; showRelevant(s.algoRed); }
    // while LOCKED, mirror the backend's live values; while unlocked, keep the user's edits
    if (!unlocked && s.redParams) {
      for (const p of PARAMS) {
        const el = $(`#rl-cp-${p.key}`);
        if (el && s.redParams[p.key] != null) { el.value = s.redParams[p.key]; setLabel(p); }
      }
    }
  });
}
