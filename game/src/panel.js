// The training control panel (toggle with C). A clean, Nintendo-style dashboard:
// per-round matchup (read-only), live training controls, the tunable
// hyperparameters (which feed straight back into the trainer), live stats, the
// learning curves, an episode replay, and each model's learned value heatmap.
//
// Talks to the backend through window.RL (set up in main.js):
//   RL.control({cmd,...})  RL.setHeatmap('red'|'blue'|null)
//   RL.replay.{load,seek,toggle,stop,setFps,active}  (episode replay contract)
// and listens for 'rl-snapshot' (live stats) and 'rl-qinspect' (clicked tile Q).

import { initGraphs } from './graphs.js';

// read-only display names for whichever algorithms the current round pits together
export const NAMES = {
  value_iteration: 'Value Iteration', policy_iteration: 'Policy Iteration',
  qlearning: 'Q-Learning', sarsa: 'SARSA', expected_sarsa: 'Expected-SARSA',
  monte_carlo: 'Every-visit MC', first_visit_mc: 'First-visit MC',
  dqn: 'DQN', double_dqn: 'Double-DQN', dueling_dqn: 'Dueling-DQN',
  reinforce: 'REINFORCE', actor_critic: 'Actor-Critic', ppo: 'PPO',
};
const ACTION_NAMES = ['North', 'South', 'West', 'East'];
// Peach's Castle is viewed from the opposite side of the matrix. Present the
// conventional N/S/W/E order while reading the matching backend indices.
const PEACH_ACTION_ORDER = [1, 0, 3, 2];

// slider 0..100 <-> steps/sec on a log scale (2 .. 15000)
const sliderToSpeed = (v) => Math.round(Math.pow(15000, v / 100)); // 1/s (v=0) -> 15000/s (v=100)
const speedToSlider = (sps) => 100 * Math.log(sps) / Math.log(15000); // inverse of the above
// Picking a replay just MOVES the speed slider to this pace (a watchable 5/s); the slider
// still drives the replay from there, exactly like the live game.
const REPLAY_VIEW_SPS = 5;

// per-level control scoping. DP planners (Value / Policy Iteration) plan with the
// discount γ + a planning-speed knob, so the learning controls (α, ε) hide there.
// Neural-net (DQN) controls only ever show on a DQN round.
export const DP_ALGOS = new Set(['value_iteration', 'policy_iteration']);
export const DQN_ALGOS = new Set(['dqn', 'double_dqn', 'dueling_dqn']);
export const PG_ALGOS = new Set(['reinforce', 'actor_critic', 'ppo']);

// transport icons: centred SVGs that take the button's colour via currentColor
const SVG = {
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2.2v14H6z"/><path d="M18 5 8.5 12 18 19z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5 15.5 12 6 19z"/><path d="M15.8 5H18v14h-2.2z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7.5 5v14L18 12z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.2v14H7z"/><path d="M13.8 5h3.2v14h-3.2z"/></svg>',
};

// slider fill colours: blue = tunes OUR model (Blue); gray = global / both models
const C_OURS = '#1f5fd0';
const C_GLOBAL = '#141518'; // black fill for the global / structural sliders (was gray)
const CPU_NAMES = ['Mario', 'Luigi', 'Yoshi', 'Toadette', 'Pauline', 'Koopa', 'Bowser', 'Peach', 'Toad', 'Parabones'];
const CPU_LEVEL_LABELS = ['Rookie', 'Rookie', 'Amateur', 'Amateur', 'Skilled', 'Skilled', 'Veteran', 'Veteran', 'Master', 'Champion'];

// Tunable training hyperparameters. Per-model controls follow the selected
// header model; match-wide controls always route through setParams.
export const PARAMS = [
  { key: 'targetEpisodes', label: 'Stop after (episodes)', min: 0, max: 20000, step: 100, color: C_GLOBAL, scope: 'always', desc: 'Stops new training episodes at this count. 0 keeps running.', fmt: (v) => (v <= 0 ? 'no limit' : (+v).toLocaleString()) },
  { key: 'maxSteps', label: 'Max steps / episode', min: 50, max: 10000, step: 50, color: C_GLOBAL, scope: 'always', desc: 'Caps episode length (timeout). Race rounds end here if nobody reaches the goal; the survival round runs to this many steps if the models keep their lives.', fmt: (v) => (+v).toLocaleString() },
  { key: 'alpha', label: 'Learning rate α', min: 0.01, max: 1, step: 0.01, color: C_OURS, scope: 'learn', desc: 'How strongly one new experience changes this model. Dynamic Programming does not use α. Monte Carlo applies α/4 to its higher-variance full-return updates for stability.', fmt: (v) => (+v).toFixed(2) },
  { key: 'gamma', label: 'Discount γ', min: 0, max: 1, step: 0.01, color: C_OURS, scope: 'always', desc: 'How much future rewards matter. Higher values make the model plan farther ahead.', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsStart', label: 'ε start', min: 0, max: 1, step: 0.01, color: C_OURS, scope: 'eps', desc: 'Chance of a random action at the start of training.', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsEnd', label: 'ε end', min: 0, max: 0.5, step: 0.01, color: C_OURS, scope: 'eps', desc: 'Final random-action chance after decay. It does not have to reach zero.', fmt: (v) => (+v).toFixed(2) },
  { key: 'epsEpisodes', label: 'ε decay (episodes)', min: 100, max: 20000, step: 100, color: C_OURS, scope: 'eps', desc: 'Episodes needed to move linearly from ε start to ε end, not to zero.', fmt: (v) => (+v).toLocaleString() },
];

// shared display + reset helpers
const fLoc = (v) => (+v).toLocaleString();

// Match-wide and algorithm-specific settings, scoped per round by showRelevant():
//   'dp'   -> DP planners (Value/Policy Iteration): convergence + sweep cap + speed
//   'dqn'  -> neural value rounds: replay / batch / target-net / width
//   'always' -> every round (the reproducibility seed)
// Arena scopes keep each round's world controls out of unrelated tabs.
// `sect` places the slider in the Algorithm-internals ('algo') or World ('world')
// card. `def` is the backend default (for Reset). `enc`/`dec` map slider-space
// <-> backend-space where they differ (dpTheta rides a log/exponent slider).
export const GLOBAL_PARAMS = [
  // --- algorithm internals ---
  { key: 'dpTheta', label: 'Convergence tolerance θ', min: -9, max: -1, step: 1, sect: 'algo', scope: 'dp', def: 1e-5,
    desc: 'After one full pass over every state, planning stops when the largest value change is below θ. Policy Iteration must also make zero policy changes. Smaller θ is stricter.',
    enc: (e) => Math.pow(10, Math.round(e)), dec: (t) => Math.max(-9, Math.min(-1, Math.round(Math.log10(t || 1e-5)))),
    fmt: (e) => (10 ** Math.round(e)).toFixed(-Math.round(e)) },
  { key: 'dpMaxIters', label: 'Maximum Bellman sweeps', min: 50, max: 5000, step: 50, sect: 'algo', scope: 'dp', def: 2000,
    desc: 'One sweep updates every state once. This is only a safety ceiling: reaching it stops planning without proving convergence.', fmt: fLoc },
  { key: 'dpPlanning', label: 'Planning speed (sweeps / step)', min: 0.1, max: 5, step: 0.05, color: C_OURS, sect: 'algo', scope: 'dp', def: 0.6,
    desc: 'How much planning happens between moves. 1.0 = one full pass over all states per game step; 0.5 = one pass every two steps; 2.0 = two passes per step. It changes planning speed, not the final solution.', fmt: (v) => (+v).toFixed(2) },
  // Network architecture first, then the training-loop knobs - all per-side, grouped.
  { key: 'dqnHidden', label: 'Hidden width', min: 32, max: 512, step: 32, sect: 'algo', scope: 'dqn', def: 128, color: C_OURS, desc: "Neurons per hidden layer of this model's Q-network.", fmt: fLoc },
  { key: 'dqnLayers', label: 'Hidden layers', min: 1, max: 5, step: 1, sect: 'algo', scope: 'dqn', def: 2, color: C_OURS, desc: "How many hidden layers deep this model's Q-network is.", fmt: fLoc },
  { key: 'dqnBatch', label: 'Batch size', min: 8, max: 256, step: 8, sect: 'algo', scope: 'dqn', def: 64, color: C_OURS, desc: 'How many past experiences are sampled from memory for each gradient update.', fmt: fLoc },
  { key: 'dqnBuffer', label: 'Replay buffer', min: 5000, max: 200000, step: 5000, sect: 'algo', scope: 'dqn', def: 50000, color: C_OURS, desc: 'Size of the memory of past experiences it trains from (a rolling window). Bigger = more varied but less recent.', fmt: fLoc },
  { key: 'dqnWarmup', label: 'Warmup steps', min: 0, max: 10000, step: 250, sect: 'algo', scope: 'dqn', def: 500, color: C_OURS, desc: 'Experiences collected BEFORE training starts, so the first updates are not drawn from an almost-empty memory.', fmt: fLoc },
  { key: 'dqnTargetSync', label: 'Target sync (steps)', min: 50, max: 5000, step: 50, sect: 'algo', scope: 'dqn', def: 500, color: C_OURS, desc: 'How often the stable "target" copy of the network is refreshed. Larger = steadier but slower to follow.', fmt: fLoc },
  { key: 'dqnNstep', label: 'N-step returns', min: 1, max: 10, step: 1, sect: 'algo', scope: 'dqn', def: 3, color: C_OURS, desc: 'How many steps of future reward are folded into one learning target. 1 = standard DQN.', fmt: fLoc },
  // --- Round-5 policy-gradient internals (REINFORCE / Actor-Critic / PPO). Most
  // apply live; hidden width rebuilds the network. Some only affect certain algos. ---
  { key: 'pgHidden', label: 'Hidden width', min: 32, max: 512, step: 32, sect: 'algo', scope: 'pg', def: 128, desc: 'Neurons per hidden layer of the policy (and value) network. Rebuilds the network.', fmt: fLoc },
  { key: 'pgEntropy', label: 'Entropy bonus', min: 0, max: 0.1, step: 0.005, sect: 'algo', scope: 'pg', def: 0.01, desc: 'Reward for keeping the policy random (exploration). Higher = explores longer before committing. Used by all three PG algorithms.', fmt: (v) => (+v).toFixed(3) },
  { key: 'pgLambda', label: 'GAE λ', min: 0.8, max: 1, step: 0.01, sect: 'algo', scope: 'pg', def: 0.95, desc: 'Generalised-advantage bias/variance knob for Actor-Critic and PPO. 1 = high-variance Monte-Carlo advantage; lower = more bootstrapping. (Ignored by REINFORCE.)', fmt: (v) => (+v).toFixed(2) },
  { key: 'pgValueCoef', label: 'Value loss weight', min: 0, max: 1, step: 0.05, sect: 'algo', scope: 'pg', def: 0.5, desc: 'How strongly the critic (value) loss is weighted against the policy loss in Actor-Critic and PPO. (Ignored by REINFORCE.)', fmt: (v) => (+v).toFixed(2) },
  { key: 'pgHorizon', label: 'Rollout horizon', min: 16, max: 1024, step: 16, sect: 'algo', scope: 'pg', def: 64, desc: 'Steps collected before each update for Actor-Critic (default 64) and PPO (default 512). Longer = steadier but fewer, slower updates. (Ignored by REINFORCE.)', fmt: fLoc },
  { key: 'pgClip', label: 'PPO clip ε', min: 0.05, max: 0.5, step: 0.05, sect: 'algo', scope: 'pg', def: 0.2, desc: 'PPO trust-region size: caps how far each update moves the policy (ratio clipped to 1±ε). Smaller = safer, slower. (PPO only.)', fmt: (v) => (+v).toFixed(2) },
  { key: 'pgEpochs', label: 'PPO epochs', min: 1, max: 10, step: 1, sect: 'algo', scope: 'pg', def: 4, desc: 'How many optimisation passes PPO takes over each rollout. More = more sample reuse per batch. (PPO only.)', fmt: fLoc },
  { key: 'pgMinibatch', label: 'PPO minibatch', min: 8, max: 512, step: 8, sect: 'algo', scope: 'pg', def: 128, desc: 'Minibatch size PPO uses for its SGD passes over each rollout. (PPO only.)', fmt: fLoc },
  // --- Round-1 game mechanics (Peach's Castle: ice puddles + Mystery Blocks).
  // These scope to 'r1' and live in the World card. Each edit re-solves both DP planners. ---
  { key: 'slipProb', label: 'Puddle slip chance', min: 0, max: 0.9, step: 0.05, sect: 'world', scope: 'r1', def: 0.30, desc: 'Chance that an ice move goes sideways; the two side directions split this probability.', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'blockGhostProb', label: 'Mystery Block outcome', min: 0, max: 1, step: 0.05, sect: 'world', scope: 'r1', def: 0.5, desc: 'Probability that a Mystery Block grants Ghost. The remaining probability causes Freeze.', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'ghostLen', label: 'Ghost length (tiles)', min: 1, max: 8, step: 1, sect: 'world', scope: 'r1', def: 4, desc: 'Number of landed tiles for which wall-phasing stays active.', fmt: (v) => `${Math.round(v)}` },
  { key: 'freezeLen', label: 'Freeze length (turns)', min: 1, max: 8, step: 1, sect: 'world', scope: 'r1', def: 3, desc: 'Turns lost when a Mystery Block produces Freeze.', fmt: (v) => `${Math.round(v)}` },
  { key: 'coinReward', label: 'Coin reward', min: 0, max: 1, step: 0.05, sect: 'world', scope: 'r1', def: 0.2, desc: 'Optional reward added once when the model collects one of its coins.', fmt: (v) => (+v).toFixed(2) },
  { key: 'blockReward', label: 'Mystery Block reward', min: 0, max: 1, step: 0.05, sect: 'world', scope: 'r1', def: 0.15, desc: 'One-time reward when a Mystery Block grants Ghost.', fmt: (v) => (+v).toFixed(2) },
  // --- Round-2 dynamics. Hazard placement/counts belong to the validated
  // seeded course; expose only controls that genuinely alter the MDP. ---
  { key: 'r2SlipProb', label: 'Puddle slip chance', min: 0, max: 0.9, step: 0.01, sect: 'world', scope: 'r2', def: 0.12, desc: 'Chance that a move made while standing on a puddle skids to one of the two perpendicular directions. A plant-zone landing eliminates that racer until the next episode while the rival continues.', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'r2TomatoReward', label: 'Tomato reward', min: 0, max: 2, step: 0.05, sect: 'world', scope: 'r2', def: 0.35, desc: 'One-time reward paid when this model collects each required tomato. Revisiting the same tomato pays nothing.', fmt: (v) => (+v).toFixed(2) },
  { key: 'r3SlipProb', label: 'Wet-cell slip chance', min: 0, max: 0.9, step: 0.05, sect: 'world', scope: 'r3', def: 0.20, desc: 'Chance that a move made while standing on a wet puddle skids to one of the two perpendicular directions. This is the variance that lets one racer fall behind, so the cage pickup becomes a real catch-up tool.', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'r3CageReward', label: 'Cage reward', min: 0, max: 1, step: 0.05, sect: 'world', scope: 'r3', def: 0.2, desc: 'One-time bonus paid when this model grabs its cage pickup WHILE BEHIND, so the detour is learned as a catch-up move. Grabbing while ahead pays nothing.', fmt: (v) => (+v).toFixed(2) },
  { key: 'r3CageLen', label: 'Cage freeze length (turns)', min: 1, max: 15, step: 1, sect: 'world', scope: 'r3', def: 6, desc: 'Turns the rival stays frozen (immobile and shielded from Goombas) after you drop a cage on it by grabbing your pickup.', fmt: (v) => `${Math.round(v)}` },
  // --- Round-4 game feel (Ruined Kingdom survival). Applied live to the arena. ---
  { key: 'r4MissileSpeed', label: 'Missile speed', min: 2, max: 10, step: 0.2, sect: 'world', scope: 'r4', def: 5.4, desc: "Top speed of a Banzai Bill at full pressure. Below the flyer's own ~7 speed, a single Bill is always outrunnable.", fmt: (v) => (+v).toFixed(1) },
  { key: 'r4MissileHoming', label: 'Missile homing', min: 0, max: 1.5, step: 0.05, sect: 'world', scope: 'r4', def: 0.5, desc: 'How sharply a Bill turns to track you (rad/s). 0 = flies straight; higher = much harder to juke past.', fmt: (v) => (+v).toFixed(2) },
  { key: 'r4Hearts', label: 'Hearts (lives)', min: 1, max: 9, step: 1, sect: 'world', scope: 'r4', def: 3, desc: 'How many hits each character survives before the round ends. Changing this restarts the episode.', fmt: (v) => `${Math.round(v)}` },
  { key: 'r4HitPenalty', label: 'Hit penalty', min: -5, max: -0.1, step: 0.1, sect: 'world', scope: 'r4', def: -2, desc: 'Reward lost when a Bill takes one of your hearts. More negative = the model fears getting hit more.', fmt: (v) => (+v).toFixed(1) },
  { key: 'r4ActionRepeat', label: 'Action repeat', min: 1, max: 8, step: 1, sect: 'world', scope: 'r4', def: 4, desc: 'How many 0.02 s steps each chosen direction is held before the model may change it. 1 = decide every step (the greedy policy jitters); higher = the model commits to a direction, which stabilises both learning and dodging. 4 is the tuned default.', fmt: (v) => `${Math.round(v)}` },
  // --- Round-5 game mechanics (Tostarena: Bowser's airship hazard) ---
  { key: 'r5BowserCount', label: 'Cannonballs per volley', min: 0, max: 6, step: 1, sect: 'world', scope: 'r5', def: 1, desc: "How many cannonballs the airship fires at the board each volley. 0 turns the airship off; higher makes dodging a bigger part of the round.", fmt: (v) => `${Math.round(v)}` },
  { key: 'r5BowserInterval', label: 'Airship fire rate', min: 0.5, max: 30, step: 0.5, sect: 'world', scope: 'r5', def: 2.5, desc: 'Seconds between cannon volleys. Lower = the airship fires more often.', fmt: (v) => `${(+v).toFixed(1)}s` },
  { key: 'r5BowserSpeed', label: 'Cannonball speed', min: 1, max: 20, step: 0.5, sect: 'world', scope: 'r5', def: 10, desc: 'How fast the fired cannonballs fly across the board (units/s). Faster ones are harder to dodge.', fmt: (v) => (+v).toFixed(1) },
  { key: 'r5AgentSight', label: 'Cannonball sight range', min: 1, max: 20, step: 0.5, sect: 'world', scope: 'r5', def: 6, desc: 'How far ahead (metres) an agent senses an incoming cannonball in its observation. Larger = more warning to dodge.', fmt: (v) => (+v).toFixed(1) },
  // --- reproducibility ---
  { key: 'trainSeed', label: 'Random seed', min: -1, max: 1000, step: 1, sect: 'world', scope: 'always', def: -1, fmt: (v) => (v < 0 ? 'auto' : String(Math.round(v))) },
];


const STYLE = `
@property --hue{syntax:'<color>';inherits:true;initial-value:#1f5fd0;}
#rl-panel{position:fixed;top:0;left:0;height:100%;width:min(465px,100vw);z-index:58;--hue:#1f5fd0;
  transform:translateX(calc(-100% - 24px));
  transition:transform .5s cubic-bezier(.19,1,.22,1),width .5s cubic-bezier(.16,1,.3,1),--hue .3s ease;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#1f1f21;background:#f3f4f6;box-shadow:3px 0 30px rgba(0,0,0,.24);
  overflow:hidden;}
#rl-panel.open{transform:translateX(0);}
#rl-panel .rl-body{height:100%;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;
  scrollbar-width:none;-ms-overflow-style:none;padding-bottom:0;transition:padding-bottom .25s ease;}
#rl-panel.has-dp-converged .rl-body,
#rl-panel.has-train-done .rl-body{padding-bottom:96px;}
/* scroll stays, scrollbar hidden (Chromium/WebKit here; Firefox/IE via the rule above) */
#rl-panel .rl-body::-webkit-scrollbar{width:0;height:0;display:none;}

/* Pinned post-convergence notice. The body is the panel's scroll container while
   this absolute box stays anchored to the panel; reserved body padding keeps the
   last card fully scrollable above it instead of hiding underneath. */
#rl-panel .converged-pin{position:absolute;left:0;right:0;bottom:0;z-index:12;
  display:flex;align-items:center;gap:12px;min-height:84px;box-sizing:border-box;padding:14px 18px;
  border:0;border-radius:0;background:#1f7a3d;color:#fff;
  box-shadow:0 -7px 22px rgba(16,70,34,.2);
  animation:convergedPinIn .3s cubic-bezier(.2,.9,.25,1);}
#rl-panel .converged-pin[hidden]{display:none;}
#rl-panel .converged-pin-icon{flex:none;width:42px;height:42px;
  display:grid;place-items:center;color:#fff;}
#rl-panel .converged-pin-icon svg{width:29px;height:29px;fill:none;stroke:currentColor;
  stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;}
#rl-panel .converged-pin-copy{min-width:0;display:flex;flex-direction:column;gap:3px;}
#rl-panel .converged-pin-copy b{font-size:13px;line-height:1.2;letter-spacing:.65px;
  text-transform:uppercase;color:#fff;}
#rl-panel .converged-pin-copy span{font-size:11.5px;line-height:1.38;color:rgba(255,255,255,.9);}
@keyframes convergedPinIn{from{opacity:0;transform:translateY(14px) scale(.98)}
  to{opacity:1;transform:translateY(0) scale(1)}}

/* sticky header with the live matchup */
#rl-panel .hdr{position:sticky;top:0;z-index:2;padding:15px 16px 14px;background:#fff;
  border-bottom:1px solid #e6e8ec;}
/* arena name (left) + round tag pushed to the far right - the header's title row.
   On the CPU model the lock swings in top-right, so reserve space then to avoid an overlap. */
#rl-panel .hdr .harena{display:flex;align-items:center;gap:10px;margin-top:0;
  padding-right:0;transition:padding-right .3s ease;}
#rl-panel[data-model="cpu"] .hdr .harena{padding-right:42px;}
/* 5 round-result dots (pushed to the right of the arena name): who won each round */
#rl-panel .hdr .rdots{flex:none;margin-left:auto;display:flex;gap:6px;align-items:center;}
#rl-panel .hdr .rdot{width:12px;height:12px;border-radius:50%;background:#d7dade;}   /* not played yet = grey */
#rl-panel .hdr .rdot.b{background:#1f5fd0;} #rl-panel .hdr .rdot.r{background:#e60012;} #rl-panel .hdr .rdot.d{background:#8b5cf6;}
#rl-panel .hdr .rdot.cur{box-shadow:0 0 0 2px #fff,0 0 0 3.5px #c4c8ce;}   /* the round in progress */
#rl-panel .hdr .harena b{font-size:23px;font-weight:800;letter-spacing:-.5px;color:#1f1f21;line-height:1.3;
  min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-bottom:1px;}
/* the model being trained + who it faces */
#rl-panel .hdr .myalgo{margin-top:12px;padding-top:11px;border-top:1px solid #f0f1f3;}
#rl-panel .hdr .myalgo .mlabel{display:block;font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#a2a5ac;}
/* the model selector: two plain text columns (Your model | CPU model), NO card boxes.
   A solid colour block (blue for you, red for CPU) sits behind the ACTIVE column;
   switching slides that block to the other side and recolours it (--hue). */
/* mselect spans the FULL panel width: -16px side margins cancel the .hdr padding, so each
   half of the block reaches a panel edge on its own (no reliance on bleeding through padding);
   -14px margin-bottom drops it to the header's bottom line. */
#rl-panel .hdr .mselect{position:relative;display:flex;gap:0;margin:12px -16px -14px;isolation:isolate;}
/* the solid colour block: square. Positioned by left/right INSETS (not width+transform) so
   the reaching edge is pinned straight to the panel edge (right:-2px / left:-2px overshoot,
   clipped by #rl-panel's overflow-x:hidden) with no transform sub-pixel rounding. The inner
   edge sits on centre; animating left+right keeps a constant width, so it still slides. */
#rl-panel .hdr .msel-wash{position:absolute;z-index:0;top:0;bottom:0;left:-2px;right:50%;pointer-events:none;
  background:var(--hue);border-radius:0;opacity:.82;
  transition:left .34s cubic-bezier(.4,.75,.2,1),right .34s cubic-bezier(.4,.75,.2,1);}
#rl-panel[data-model="cpu"] .hdr .msel-wash{left:50%;right:-2px;}
#rl-panel .hdr .msel{flex:1;min-width:0;text-align:left;border:0;border-radius:0;background:transparent;
  position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;padding:13px 16px;cursor:pointer;transition:opacity .2s;}
#rl-panel .hdr .msel.active{background:transparent;color:inherit;border-color:transparent;} /* neutralise the global button.active dark fill/white text */
#rl-panel .hdr .msel:not(.active){opacity:.45;}
#rl-panel .hdr .msel:not(.active):hover{opacity:.75;}
#rl-panel .hdr .msel .msel-k{display:block;font-size:8.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#a2a5ac;}
#rl-panel .hdr .msel .msel-n{display:block;font-size:16px;font-weight:800;letter-spacing:-.3px;line-height:1.15;margin-top:3px;color:#7c7f86;
  white-space:nowrap;overflow:visible;text-overflow:clip;transition:color .2s;}
#rl-panel .hdr .msel .msel-s{display:block;font-style:normal;font-size:9.5px;font-weight:700;color:#a8abb2;margin-top:4px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#rl-panel .hdr .msel.active .msel-n{color:#fff;} /* name goes white on the coloured block (was the same hue as the bg) */
/* on the active (coloured) band the label + subline go white; the model name keeps its accent */
#rl-panel .hdr .msel.active .msel-k{color:#fff;}
#rl-panel .hdr .msel.active .msel-s{color:rgba(255,255,255,.9);}
/* the CPU model tints the learning sliders + the tab accent red (--hue transitions) */
#rl-panel[data-model="cpu"]{--hue:#d4141f;}
#rl-panel .plegend .ple-hue{background:var(--hue);}
#rl-panel[data-model="cpu"] .rl-tab.active{color:#d4141f;}
#rl-panel[data-model="cpu"] .rl-tab-hl::before{background:radial-gradient(72% 118% at 50% 100%,rgba(212,20,31,.13),rgba(212,20,31,0) 70%);}
#rl-panel[data-model="cpu"] .rl-tab-hl::after{background:#d4141f;}
#rl-panel .hdr .myalgo b{display:block;font-size:20px;font-weight:800;color:#1f5fd0;letter-spacing:-.3px;line-height:1.15;margin-top:3px;}
#rl-panel .hdr .myalgo em{display:block;font-style:normal;font-size:10.5px;color:#9a9da4;margin-top:5px;}
/* ===== Playback sits at the top ALWAYS (not a tab); an underline tab row below
   it picks ONE section. Active tab = coloured text + a line under it with a soft
   glow rising above the line. ===== */
#rl-panel .hdr{z-index:4;}                            /* header stays above the tab bar */
#rl-panel .rl-tabs{position:sticky;top:0;z-index:3;display:flex;gap:0;padding:0 8px;
  background:#fff;border-bottom:1px solid #e6e8ec;overflow-x:auto;scrollbar-width:none;}
#rl-panel .rl-tabs::-webkit-scrollbar{display:none;}
#rl-panel .rl-tab{flex:1 0 62px;min-width:62px;position:relative;padding:11px 3px 12px;border:0;border-radius:0;background:none;
  color:#8a8d94;font:inherit;font-size:10.5px;font-weight:700;letter-spacing:-.2px;cursor:pointer;outline:none;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .2s ease,background-color .22s ease;}
#rl-panel .rl-tab:hover{background:#eff1f5;}   /* soft light bg fades in on hover */
/* our .active also matches the global button.active (dark segmented-control style),
   so override its background/border back off for tabs */
#rl-panel .rl-tab.active{color:#1f5fd0;background:none;border-color:transparent;}
/* one sliding highlight (glow + underline) that animates between tabs; JS sets its
   width + translateX to the active tab. The glow fades on the sides AND the top
   (radial from the bottom centre), the line is the crisp bar at the bottom. */
#rl-panel .rl-tab-hl{position:absolute;bottom:0;left:0;height:100%;width:0;pointer-events:none;z-index:0;
  transform:translateX(0);transition:transform .24s cubic-bezier(.4,0,.2,1),width .24s cubic-bezier(.4,0,.2,1);}
#rl-panel .rl-tab-hl::before{content:"";position:absolute;inset:0;
  background:radial-gradient(72% 118% at 50% 100%,rgba(31,95,208,.15),rgba(31,95,208,0) 70%);}
#rl-panel .rl-tab-hl::after{content:"";position:absolute;left:2px;right:2px;bottom:0;height:2.5px;background:#1f5fd0;}
#rl-panel .rl-tab{z-index:1;}   /* text/labels sit above the sliding highlight */
/* show only the active section; the tab names it, so hide the big in-panel heading
   and keep just the one-line description at the top of the section */
#rl-panel .rl-group{display:none;margin:0;}
#rl-panel .rl-group.active{display:block;}
#rl-panel .rl-group-h{display:none;}
#rl-panel .rl-group-sub{display:block;margin:14px 12px 2px;font-size:11.5px;line-height:1.45;color:#6a6d75;}

/* cards */
#rl-panel section{margin:11px 11px;padding:13px 14px;background:#fff;border:1px solid #e6e8ec;
  border-radius:13px;box-shadow:0 1px 2px rgba(20,20,30,.04);}
#rl-panel h2{margin:0 0 12px;font-size:10.5px;font-weight:800;letter-spacing:.9px;
  text-transform:uppercase;color:#8a8d94;}
/* ---- Playback: the REPLAY corner tag + the grow-in replay scrubber ---- */
#rl-panel #rl-sec-playback{position:relative;overflow:hidden;} /* clip the tag to the card's corner */
/* REPLAY tag: fills the card's TOP-RIGHT corner (flush to the top + right edges; the
   top-right rounds with the card via the section's overflow, the inner bottom-left is
   rounded). Drops in top->bottom via .show; on HOVER its two stacked faces slide DOWN
   so it swaps to a red "Back to live" (clicking it exits the replay). */
#rl-panel .reptag{position:absolute;top:0;right:0;z-index:4;width:118px;height:26px;margin:0;padding:0;border:0;
  background:none;overflow:hidden;border-radius:0 0 0 12px;cursor:pointer;outline:none;
  opacity:0;transform:translateY(-100%);pointer-events:none;
  transition:transform .3s cubic-bezier(.34,1.28,.5,1),opacity .22s ease;}
#rl-panel .reptag.show{opacity:1;transform:translateY(0);pointer-events:auto;}
#rl-panel .reptag-face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap;
  transition:transform .3s cubic-bezier(.4,0,.2,1);}
#rl-panel .reptag-front{background:#1f5fd0;transform:translateY(0);}
#rl-panel .reptag.red .reptag-front{background:#e60012;}                  /* red model -> red REPLAY */
#rl-panel .reptag-back{background:#5e626b;transform:translateY(-100%);}   /* BACK TO LIVE = grey (both models) */
#rl-panel .reptag:hover .reptag-front{transform:translateY(100%);}       /* front exits DOWN */
#rl-panel .reptag:hover .reptag-back{transform:translateY(0);}           /* back drops in from top */
/* replay scrubber: grows in / collapses out instead of popping */
#rl-panel #rl-rep-scrub{max-height:0;opacity:0;overflow:hidden;margin:0;
  transition:max-height .34s ease,opacity .26s ease,margin-top .34s ease;}
#rl-panel #rl-rep-scrub.show{max-height:74px;opacity:1;margin-top:13px;}
/* slim, rounded scrollbar inside the replay list */
#rl-panel .replist{scrollbar-width:thin;scrollbar-color:#c6ccd6 transparent;}
#rl-panel .replist::-webkit-scrollbar{width:10px;}
#rl-panel .replist::-webkit-scrollbar-button{display:none;width:0;height:0;}
#rl-panel .replist::-webkit-scrollbar-track{background:transparent;}
#rl-panel .replist::-webkit-scrollbar-thumb{background:#c6ccd6;border-radius:99px;border:3px solid #fff;background-clip:padding-box;}
#rl-panel .replist::-webkit-scrollbar-thumb:hover{background:#aab2bf;background-clip:padding-box;}

/* buttons */
#rl-panel .btns{display:flex;gap:7px;}
#rl-panel .btns[hidden]{display:none;}   /* [hidden] must beat the flex rule above */
#rl-panel .btns+.btns{margin-top:7px;}
#rl-panel button{flex:1;padding:9px 6px;border:1px solid #d7dade;border-radius:9px;background:#fff;
  color:#26272b;font:inherit;font-size:12px;font-weight:600;cursor:pointer;outline:none;
  transition:background .12s,border-color .12s,color .12s;}
#rl-panel button:focus{outline:none;}
#rl-panel button:focus-visible{outline:2px solid var(--hue);outline-offset:2px;
  box-shadow:0 0 0 1px #fff;}
#rl-panel button:hover{background:#f0f1f3;}
#rl-panel button:active{background:#e7e8eb;}
#rl-panel button.primary{background:#1f5fd0;border-color:#1a52b8;color:#fff;}
#rl-panel button.primary:hover{background:#1a52b8;}
#rl-panel button.active{background:#1f1f21;border-color:#1f1f21;color:#fff;}
/* the CPU lock: top-right of the header; swings in from the right on the CPU model */
#rl-panel .lockbtn{position:absolute;top:13px;right:14px;z-index:6;width:34px;height:34px;padding:0;
  display:grid;place-items:center;border:1px solid #d7dade;border-radius:50%;background:#fff;color:#8a8d94;cursor:pointer;
  opacity:0;transform:translateX(64px) rotate(14deg);pointer-events:none;
  transition:opacity .26s ease,transform .4s cubic-bezier(.34,1.42,.5,1),background .12s,color .12s,border-color .12s;}
#rl-panel .lockbtn.show{opacity:1;transform:translateX(0) rotate(0);pointer-events:auto;}
#rl-panel .lockbtn:hover{background:#f0f1f3;color:#54565c;border-color:#c4c8ce;}
#rl-panel .lockbtn.locked{background:#dc3e47;border-color:#dc3e47;color:#fff;} /* same red as the CPU model block: #d4141f at 82% over white */
#rl-panel .lockbtn.locked:hover{background:#d4141f;border-color:#d4141f;color:#fff;}
#rl-panel .lockbtn svg{width:18px;height:18px;display:block;}
/* the ARENA-2 turbo: EXACTLY the CPU lock's top-right slot + swing-in (the lock is CPU-only,
   the turbo is on your Blue model, so they never collide). A blue lightning that JUMPS the
   training thousands of episodes into the future on click. Like the lock, it reserves header
   space (via [data-turbo="on"]) so the round-result dots never slide under it. */
#rl-panel .turbobtn{position:absolute;top:13px;right:14px;z-index:6;width:34px;height:34px;padding:0;
  display:grid;place-items:center;border:1px solid #cdd8ee;border-radius:50%;background:#fff;color:#1f5fd0;cursor:pointer;
  opacity:0;transform:translateX(64px) rotate(14deg);pointer-events:none;
  transition:opacity .26s ease,transform .4s cubic-bezier(.34,1.42,.5,1),background .12s,color .12s,border-color .12s;}
#rl-panel .turbobtn.show{opacity:1;transform:translateX(0) rotate(0);pointer-events:auto;}
#rl-panel .turbobtn:hover{background:#eef3fc;border-color:#a9c2ee;}
#rl-panel[data-turbo="on"] .hdr .harena{padding-right:42px;}   /* mirror the lock's reserve */
/* mid-skip: solid blue + a soft pulse, clicks disabled until the jump finishes */
#rl-panel .turbobtn.working{background:#1f5fd0;border-color:#1f5fd0;color:#fff;cursor:default;pointer-events:none;
  animation:turboPulse 1s ease-in-out infinite;}
@keyframes turboPulse{0%,100%{box-shadow:0 0 0 0 rgba(31,95,208,.36)}50%{box-shadow:0 0 0 6px rgba(31,95,208,0)}}
#rl-panel .turbobtn svg{width:18px;height:18px;display:block;}
/* while a turbo skip runs, gray out + LOCK the whole panel behind a scrim (shows the countdown) */
#rl-panel .ff-scrim{position:absolute;inset:0;z-index:50;display:none;align-items:center;justify-content:center;
  background:rgba(243,244,246,.74);backdrop-filter:grayscale(.55) blur(1.5px);-webkit-backdrop-filter:grayscale(.55) blur(1.5px);}
#rl-panel[data-ff="on"] .ff-scrim{display:flex;}
#rl-panel .ff-card{display:flex;flex-direction:column;align-items:center;gap:9px;padding:22px 32px;border-radius:16px;
  background:#fff;box-shadow:0 12px 34px rgba(0,0,0,.17);border:1px solid #e6e8ec;text-align:center;}
#rl-panel .ff-card .ff-bolt{width:42px;height:42px;border-radius:50%;background:#eef3fc;color:#1f5fd0;
  display:grid;place-items:center;animation:turboPulse 1s ease-in-out infinite;}
#rl-panel .ff-card .ff-bolt svg{width:24px;height:24px;}
#rl-panel .ff-card b{font-size:15px;letter-spacing:.3px;color:#1f1f21;}
#rl-panel .ff-card .ff-n{font-size:12.5px;color:#6b7280;font-variant-numeric:tabular-nums;}
/* locked learning sliders (CPU + locked) read grayed out; black shared sliders stay open */
#rl-panel .ctl.learn{transition:opacity .15s;}
#rl-panel .ctl.learn:has(input:disabled){opacity:.5;}
#rl-panel input[type=range]:disabled{cursor:default;}
#rl-panel input[type=range]:disabled::-webkit-slider-thumb{background:#eef0f3;cursor:default;}
#rl-panel input[type=range]:disabled::-moz-range-thumb{background:#eef0f3;cursor:default;}
/* media-player transport: prev round | play/pause | next round */
#rl-panel .transport{display:flex;align-items:center;justify-content:center;gap:20px;margin-top:2px;}
#rl-panel .transport button{flex:none;padding:0;display:flex;align-items:center;justify-content:center;}
#rl-panel .tbtn{width:44px;height:44px;border-radius:50%;border:1.5px solid #d7dade;background:#fff;color:#3a3d44;}
#rl-panel .tbtn:hover{background:#f0f1f3;border-color:#c4c8ce;}
#rl-panel .tplay{width:54px;height:54px;border-radius:50%;border:none;background:#141518;color:#fff;}
#rl-panel .tplay:hover{background:#2a2b30;}
#rl-panel .transport button svg{width:18px;height:18px;display:block;fill:currentColor;}
#rl-panel .tplay svg{width:21px;height:21px;}
/* sliders (speed + every hyperparameter) */
#rl-panel .ctl{margin:0 0 13px;}
#rl-panel .ctl:last-child{margin-bottom:0;}
#rl-panel .ctl .row{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;margin-bottom:6px;}
#rl-panel .ctl .row span{color:#54565c;}
#rl-panel .ctl .row b{font-variant-numeric:tabular-nums;color:#1f1f21;font-weight:700;}
#rl-panel input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:3px;
  background:#e1e3e8;outline:none;margin:0;cursor:pointer;}
#rl-panel input[type=range]:focus-visible{outline:2px solid var(--hue);outline-offset:4px;}
#rl-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;
  border-radius:50%;background:#fff;border:2px solid var(--fill,#8a8d94);box-shadow:0 1px 2px rgba(0,0,0,.3);}
#rl-panel input[type=range]::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;
  border:2px solid var(--fill,#8a8d94);box-shadow:0 1px 2px rgba(0,0,0,.3);}
#rl-panel .note{font-size:10.5px;color:#a2a5ac;margin:11px 0 0;line-height:1.45;}
#rl-panel .plegend{display:flex;gap:16px;margin:0 0 14px;font-size:10.5px;color:#8a8d94;}
#rl-panel .plegend i{display:inline-block;width:9px;height:9px;border-radius:3px;vertical-align:middle;margin-right:5px;}

/* key/value stats */
#rl-panel .stat{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;
  padding:7px 0;border-bottom:1px solid #f0f1f3;}
#rl-panel .stat:last-child{border-bottom:0;}
#rl-panel .stat>span{color:#54565c;}
#rl-panel .stat b{font-variant-numeric:tabular-nums;font-weight:700;}

/* contest bar */
#rl-panel .bar{height:10px;border-radius:0;background:#eceef1;overflow:hidden;display:flex;margin:0 0 11px;}
#rl-panel .bar i{display:block;height:100%;transition:width .3s;}
#rl-panel .bar .r{background:#e60012;} #rl-panel .bar .b{background:#1f5fd0;} #rl-panel .bar .d{background:#8b5cf6;}
#rl-panel .bar .t{background:#8a8d94;}
#rl-panel .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle;}
/* action-distribution rows: a label + a Red mini-bar over a Blue mini-bar */
#rl-panel .actlist{display:flex;flex-direction:column;gap:8px;}
#rl-panel .actrow{display:flex;align-items:center;gap:9px;}
#rl-panel .actrow .al{width:34px;flex:none;font-size:11.5px;font-weight:700;color:#54565c;}
#rl-panel .actrow .ab{flex:1;height:7px;border-radius:4px;background:#eceef1;overflow:hidden;position:relative;}
#rl-panel .actrow .ab+.ab{margin-top:0;}
#rl-panel .actrow .ab i{display:block;height:100%;transition:width .3s;}
#rl-panel .actrow .ab i.r{background:#e60012;} #rl-panel .actrow .ab i.b{background:#1f5fd0;}
/* briefing card + two-column (Red vs Blue) comparison tables */
#rl-panel .brief-matchup{font-size:14.5px;font-weight:800;color:#1f1f21;margin:0 0 3px;letter-spacing:-.2px;}
#rl-panel .brief-sub{font-size:10px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:#8a8d94;margin:15px 0 7px;}
#rl-panel #rl-brief .stat b.rw-pos{color:#1f7a3d;}   /* positive rewards green */
#rl-panel #rl-brief .stat b.rw-neg{color:#c0392b;}   /* penalties red */
/* State & observation - the briefing's centrepiece card */
#rl-panel #rl-brief .so-card{margin:9px 0 6px;padding:15px 15px 13px;border:1px solid #e4e7ec;border-radius:14px;
  background:linear-gradient(180deg,#f8f9fc,#eef1f6);box-shadow:0 1px 3px rgba(20,22,28,.05);}
#rl-panel #rl-brief .so-hero{display:flex;align-items:baseline;gap:9px;padding-bottom:11px;margin-bottom:3px;border-bottom:1px solid #e2e5ea;}
#rl-panel #rl-brief .so-big{font-size:33px;font-weight:800;letter-spacing:-1.2px;color:#1f1f21;line-height:.9;font-variant-numeric:tabular-nums;}
#rl-panel #rl-brief .so-unit{font-size:12px;font-weight:700;color:#9a9da4;letter-spacing:.2px;}
#rl-panel #rl-brief .so-row{padding:9px 0 8px;border-bottom:1px solid #e7eaef;}
#rl-panel #rl-brief .so-row:last-child{border-bottom:0;padding-bottom:1px;}
#rl-panel #rl-brief .so-k{display:block;font-size:9px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#a2a5ac;margin-bottom:4px;}
#rl-panel #rl-brief .so-v{display:block;font-size:11.5px;color:#4b4d53;line-height:1.5;}
/* the state vector as a VISUAL stacked bar (segment width = share of dimensions) + legend */
#rl-panel #rl-brief .sv-bar{display:flex;height:26px;border-radius:7px;overflow:hidden;gap:2px;background:transparent;margin:3px 0 11px;}
#rl-panel #rl-brief .sv-seg{display:flex;align-items:center;justify-content:center;min-width:14px;
  color:#fff;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.2px;
  border-radius:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.15);}
#rl-panel #rl-brief .sv-legend{display:flex;flex-direction:column;gap:8px;}
#rl-panel #rl-brief .sv-item{display:grid;grid-template-columns:auto auto 1fr;align-items:baseline;column-gap:8px;row-gap:2px;}
#rl-panel #rl-brief .sv-dot{width:10px;height:10px;border-radius:3px;align-self:center;}
#rl-panel #rl-brief .sv-lab{font-size:11.5px;font-weight:800;color:#2a2c31;}
#rl-panel #rl-brief .sv-dim{font-size:10.5px;font-weight:800;color:#8a8d94;font-variant-numeric:tabular-nums;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;}
#rl-panel #rl-brief .sv-det{grid-column:2 / -1;font-size:10.5px;color:#7a7d84;line-height:1.45;}
/* the observation vector, shown as a code-style tuple */
#rl-panel #rl-brief .so-tuple{display:block;margin-top:7px;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  font-size:11px;font-weight:700;color:#1f5fd0;background:#eef2fa;border:1px solid #e0e6f2;border-radius:8px;
  padding:7px 9px;letter-spacing:.2px;line-height:1.5;}
/* opponent visibility: a square two-line badge with the explanation to its right */
#rl-panel #rl-brief .so-opp{display:flex;align-items:center;gap:12px;margin-top:3px;}
#rl-panel #rl-brief .so-sq{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;
  width:68px;height:68px;border-radius:13px;text-align:center;}
#rl-panel #rl-brief .so-sq b{display:block;font-size:11px;font-weight:800;letter-spacing:.7px;line-height:1.5;}
#rl-panel #rl-brief .so-sq.no{background:#f3eaea;color:#b0555a;}
#rl-panel #rl-brief .so-sq.yes{background:#e7f0ff;color:#1f5fd0;}
#rl-panel #rl-brief .so-opp-txt{font-size:11.5px;color:#4b4d53;line-height:1.5;}
/* State FACTORS - a discrete |S| shown as multiplied chips (grid rounds) */
#rl-panel #rl-brief .sf-chips{display:flex;align-items:stretch;flex-wrap:wrap;gap:6px;margin:6px 0 2px;}
#rl-panel #rl-brief .sf-x{display:flex;align-items:center;color:#b7bac1;font-weight:800;font-size:15px;}
#rl-panel #rl-brief .sf-chip{display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-width:52px;padding:7px 11px;border-radius:11px;border:1px solid #e2e5ea;background:#f6f7f9;}
#rl-panel #rl-brief .sf-chip b{font-size:16px;font-weight:800;color:var(--fc);line-height:1;font-variant-numeric:tabular-nums;}
#rl-panel #rl-brief .sf-chip span{font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#6b7280;margin-top:4px;}
#rl-panel #rl-brief .sf-total{font-size:11.5px;color:#5a5d63;margin:9px 0 2px;}
#rl-panel #rl-brief .sf-total b{font-size:14px;font-weight:800;color:#1f1f21;font-variant-numeric:tabular-nums;}
#rl-panel #rl-brief .sf-legend{display:flex;flex-direction:column;gap:5px;margin-top:7px;}
#rl-panel #rl-brief .sf-li{display:grid;grid-template-columns:auto auto 1fr;align-items:baseline;column-gap:8px;}
#rl-panel #rl-brief .sf-dot{width:9px;height:9px;border-radius:3px;align-self:center;}
#rl-panel #rl-brief .sf-lk{font-size:11px;font-weight:800;color:#2a2c31;}
#rl-panel #rl-brief .sf-ld{font-size:10.5px;color:#7a7d84;line-height:1.4;}
/* Actions - compass arrow chips (4-way) or one wide label chip (arenas) */
#rl-panel #rl-brief .act-chips{display:flex;flex-wrap:wrap;gap:7px;margin:2px 0 4px;}
#rl-panel #rl-brief .act-chip{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:52px;
  padding:8px 12px;border:1px solid #e2e5ea;border-radius:11px;background:#f6f7f9;
  font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#6b7280;}
#rl-panel #rl-brief .act-chip b{font-size:19px;font-weight:800;color:#2a2c31;line-height:1;}
#rl-panel #rl-brief .act-chip.wide{flex-direction:row;text-transform:none;letter-spacing:.2px;font-size:12px;
  color:#2a2c31;font-weight:700;padding:11px 13px;}
/* Round-4 POWER-UPS: a card per collectible, colour-accented, with a SEEK / AVOID tag.
   --pc = the pickup's colour (drives the left accent + the icon). */
#rl-panel #rl-brief .pk-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:8px 0 2px;}
#rl-panel #rl-brief .pk-card{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;
  padding:12px 12px 12px 15px;border-radius:13px;background:#fff;border:1px solid #e6e8ec;overflow:hidden;}
#rl-panel #rl-brief .pk-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--pc);}
#rl-panel #rl-brief .pk-card.bad{background:linear-gradient(180deg,#fff,#fffafa);}
#rl-panel #rl-brief .pk-ic{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;
  background:#f4f6f8;color:var(--pc);margin-bottom:5px;}
#rl-panel #rl-brief .pk-ic svg{width:21px;height:21px;display:block;}
#rl-panel #rl-brief .pk-name{font-size:13px;font-weight:800;color:#1f1f21;line-height:1.1;}
#rl-panel #rl-brief .pk-eff{font-size:11px;color:#4b4d53;font-weight:600;line-height:1.3;}
/* Round-5 weapon list: matches the tab's 11px body / bold-dark label rhythm */
#rl-panel #rl-brief .wpn-item{display:flex;align-items:center;gap:11px;margin:7px 0;
  font-size:11px;line-height:1.4;color:#4b4d53;font-weight:600;}
#rl-panel #rl-brief .wpn-item b{color:#1f1f21;font-weight:800;}
#rl-panel #rl-brief .wpn-ic{width:36px;height:36px;flex:none;object-fit:contain;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));}
#rl-panel #rl-brief .pk-dur{margin-top:5px;font-size:10px;font-weight:800;color:#6b7280;font-variant-numeric:tabular-nums;
  background:#f0f1f3;border-radius:20px;padding:2px 8px;letter-spacing:.2px;}
#rl-panel #rl-brief .pk-tag{position:absolute;top:9px;right:9px;font-size:8px;font-weight:800;letter-spacing:.6px;
  padding:3px 7px;border-radius:20px;}
#rl-panel #rl-brief .pk-card.good .pk-tag{background:#e7f6ec;color:#1f9d55;}
#rl-panel #rl-brief .pk-card.bad .pk-tag{background:#fdeceb;color:#dc4a45;}
/* ===== Challenge card SUB-TABS: a chip row that swaps panels inside the briefing ===== */
#rl-panel #rl-brief .bsub-bar{display:flex;gap:5px;flex-wrap:wrap;margin:1px 0 12px;}
#rl-panel #rl-brief .bsub-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 11px 6px 9px;
  border:1px solid #e2e5ea;border-radius:20px;background:#f6f7f9;color:#6b7280;font-size:11.5px;font-weight:700;
  cursor:pointer;transition:background .12s,color .12s,border-color .12s;}
#rl-panel #rl-brief .bsub-chip .bsub-ic,#rl-panel #rl-brief .bsub-chip .bsub-ic svg{width:15px;height:15px;display:block;}
#rl-panel #rl-brief .bsub-chip:hover{background:#eef0f3;color:#3a3c42;}
#rl-panel #rl-brief .bsub-chip.on{background:var(--hue);border-color:var(--hue);color:#fff;}
#rl-panel #rl-brief .bsub-panel{display:none;}
#rl-panel #rl-brief .bsub-panel.on{display:block;animation:bsubIn .18s ease;}
#rl-panel #rl-brief .bsub-panel .brief-sub:first-child{margin-top:2px;}
@keyframes bsubIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
/* ===== GAME tab: goal hero card + illustrated story timeline ===== */
#rl-panel #rl-brief .goal-card{display:flex;align-items:center;gap:13px;padding:14px 15px;border-radius:15px;margin:2px 0 6px;
  background:var(--hue);color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.13);}
#rl-panel #rl-brief .goal-ic{width:42px;height:42px;flex:none;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.18);}
#rl-panel #rl-brief .goal-ic svg{width:24px;height:24px;color:#fff;}
#rl-panel #rl-brief .goal-body{min-width:0;}
#rl-panel #rl-brief .goal-lbl{display:block;font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.72);}
#rl-panel #rl-brief .goal-txt{display:block;font-size:14px;font-weight:800;line-height:1.35;margin-top:3px;}
#rl-panel #rl-brief .story{display:flex;flex-direction:column;margin:5px 0 2px;}
#rl-panel #rl-brief .story-beat{display:flex;align-items:flex-start;gap:12px;padding:8px 0;}
#rl-panel #rl-brief .story-beat:not(:last-child){border-bottom:1px solid #f1f2f4;}
#rl-panel #rl-brief .story-ic{width:34px;height:34px;flex:none;border-radius:10px;display:grid;place-items:center;margin-top:1px;
  background:#eef3fc;color:#1f5fd0;}
#rl-panel #rl-brief .story-ic.bad{background:#fdecea;color:#e0563f;}
#rl-panel #rl-brief .story-ic.good{background:#e9f7ef;color:#1f9d55;}
#rl-panel #rl-brief .story-ic svg{width:19px;height:19px;display:block;}
#rl-panel #rl-brief .story-tx{font-size:12.5px;color:#3a3c42;line-height:1.5;padding-top:7px;}
/* Algorithm explanation cards (one per rival), accent-coloured by side */
#rl-panel #rl-brief .alg-card{border:1px solid #e6e8ec;border-radius:13px;padding:12px 13px;margin:9px 0;
  background:#fff;border-left:4px solid var(--ac);}
#rl-panel #rl-brief .alg-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
#rl-panel #rl-brief .alg-who{font-size:8.5px;font-weight:800;letter-spacing:.6px;color:#fff;padding:2px 7px;border-radius:20px;}
#rl-panel #rl-brief .alg-name{font-size:15px;font-weight:800;color:#1f1f21;}
#rl-panel #rl-brief .alg-fam{margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#9a9da4;}
#rl-panel #rl-brief .alg-tags{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 2px;}
#rl-panel #rl-brief .alg-cat{font-size:9.5px;font-weight:800;letter-spacing:.3px;padding:3px 8px;border-radius:20px;
  background:var(--ac);color:#fff;}
#rl-panel #rl-brief .alg-tg{font-size:9.5px;font-weight:700;padding:3px 8px;border-radius:20px;background:#eef0f3;color:#5a5d63;}
#rl-panel #rl-brief .alg-is{font-size:12.5px;font-weight:700;color:#1f1f21;line-height:1.5;margin:9px 0 2px;}
#rl-panel #rl-brief .alg-lbl{font-size:8.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--ac);margin:11px 0 3px;}
#rl-panel #rl-brief .alg-how{font-size:12px;color:#4b4d53;line-height:1.55;margin:0;}
/* the RL glossary primer at the top of the Algorithm tab */
#rl-panel #rl-brief .alg-primer{border:1px solid #e6e8ec;border-radius:13px;background:#fafbfc;padding:11px 13px;margin:2px 0 4px;}
#rl-panel #rl-brief .alg-primer summary{cursor:pointer;list-style:none;font-size:11.5px;font-weight:800;color:#3a3c42;display:flex;align-items:center;gap:7px;}
#rl-panel #rl-brief .alg-primer summary::-webkit-details-marker{display:none;}
#rl-panel #rl-brief .alg-primer summary::before{content:"";width:7px;height:7px;flex:none;border-right:2px solid #9aa0a8;border-bottom:2px solid #9aa0a8;transform:rotate(-45deg);transition:transform .15s;}
#rl-panel #rl-brief .alg-primer[open] summary::before{transform:rotate(45deg);}
#rl-panel #rl-brief .alg-primer dl{margin:9px 0 0;display:grid;grid-template-columns:auto 1fr;gap:5px 10px;}
#rl-panel #rl-brief .alg-primer dt{font-size:11.5px;font-weight:800;color:#1f5fd0;white-space:nowrap;}
#rl-panel #rl-brief .alg-primer dd{margin:0;font-size:11.5px;color:#4b4d53;line-height:1.45;}
/* Items / Enemies bestiary cards (icon + name + description), toned good/bad/info */
#rl-panel #rl-brief .be-grid{display:flex;flex-direction:column;gap:8px;margin:8px 0 2px;}
#rl-panel #rl-brief .be-card{display:flex;align-items:flex-start;gap:12px;padding:11px 13px;border:1px solid #e6e8ec;
  border-radius:13px;background:#fff;border-left:4px solid #9aa0a8;}
#rl-panel #rl-brief .be-card.good{border-left-color:#1f9d55;}
#rl-panel #rl-brief .be-card.bad{border-left-color:#e0563f;}
#rl-panel #rl-brief .be-card.info{border-left-color:#3f7fe0;}
#rl-panel #rl-brief .be-ic{width:38px;height:38px;flex:none;border-radius:11px;display:grid;place-items:center;background:#f4f6f8;color:#5a5d63;}
#rl-panel #rl-brief .be-card.good .be-ic{color:#1f9d55;}
#rl-panel #rl-brief .be-card.bad .be-ic{color:#e0563f;}
#rl-panel #rl-brief .be-card.info .be-ic{color:#3f7fe0;}
#rl-panel #rl-brief .be-ic svg{width:23px;height:23px;display:block;}
#rl-panel #rl-brief .be-txt{min-width:0;}
#rl-panel #rl-brief .be-txt b{display:block;font-size:13px;font-weight:800;color:#1f1f21;margin-bottom:2px;}
#rl-panel #rl-brief .be-txt span{font-size:11.5px;color:#4b4d53;line-height:1.5;}
/* collapsible "how this world works" - keeps the long procedural blurb out of sight by default */
#rl-panel #rl-brief .dyn-more{margin:11px 0 2px;border-top:1px solid #eceef1;padding-top:9px;}
#rl-panel #rl-brief .dyn-more summary{cursor:pointer;list-style:none;font-size:11.5px;font-weight:700;color:#6b7280;
  display:flex;align-items:center;gap:7px;}
#rl-panel #rl-brief .dyn-more summary::-webkit-details-marker{display:none;}
#rl-panel #rl-brief .dyn-more summary::before{content:"";width:7px;height:7px;flex:none;
  border-right:2px solid #9aa0a8;border-bottom:2px solid #9aa0a8;transform:rotate(-45deg);transition:transform .15s;}
#rl-panel #rl-brief .dyn-more[open] summary::before{transform:rotate(45deg);}
#rl-panel #rl-brief .dyn-more summary:hover{color:#3a3c42;}
#rl-panel #rl-brief .dyn-more p{font-size:11.5px;color:#6b7280;line-height:1.55;margin:8px 0 0;}
/* Reward structure - signed proportional bars. The bar + value are FIXED-width on
   the right and the label flexes, so every bar lines up in the same column no matter
   how long the number is. */
#rl-panel #rl-brief .rw-row{display:flex;align-items:center;gap:10px;
  font-size:11.5px;padding:6px 0;border-bottom:1px solid #f0f1f3;}
#rl-panel #rl-brief .rw-row:last-child{border-bottom:0;}
#rl-panel #rl-brief .rw-k{flex:1 1 auto;min-width:0;color:#4b4d53;line-height:1.35;}
#rl-panel #rl-brief .rw-track{flex:0 0 96px;height:7px;background:#eceef1;border-radius:4px;overflow:hidden;}
#rl-panel #rl-brief .rw-fill{display:block;height:100%;border-radius:4px;}
#rl-panel #rl-brief .rw-fill.pos{background:#1f9d63;}
#rl-panel #rl-brief .rw-fill.neg{background:#d9534f;}
#rl-panel #rl-brief .rw-val{flex:0 0 46px;text-align:right;font-weight:800;
  font-variant-numeric:tabular-nums;color:#4b4d53;white-space:nowrap;}
#rl-panel #rl-brief .rw-val.pos{color:#1f7a3d;}
#rl-panel #rl-brief .rw-val.neg{color:#c0392b;}
/* string-valued rewards (rates): no bar; the value wraps on the right, never overflows */
#rl-panel #rl-brief .rw-row.str .rw-val{flex:0 1 auto;max-width:52%;white-space:normal;
  text-align:right;color:#5a5d63;font-weight:700;font-size:11px;line-height:1.3;}
/* Hyperparameters - Blue vs Red mini-columns */
#rl-panel #rl-brief .lh-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:4px 0 2px;}
#rl-panel #rl-brief .lh-col{border:1px solid #e4e7ec;border-radius:12px;padding:11px 12px;background:#fbfbfc;}
#rl-panel #rl-brief .lh-who{font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;}
#rl-panel #rl-brief .lh-algo{font-size:11px;font-weight:700;color:#5a5d63;margin:1px 0 7px;}
#rl-panel #rl-brief .lh-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:3px 0;font-size:11px;color:#7a7d84;}
#rl-panel #rl-brief .lh-row b{color:#1f1f21;font-weight:800;font-variant-numeric:tabular-nums;}
#rl-panel #rl-brief .lh-note{font-size:10px;color:#9a9da4;line-height:1.4;margin-top:4px;}
/* Dynamics - two compact fact chips (no wall of text) */
#rl-panel #rl-brief .dyn-chips{display:flex;flex-wrap:wrap;gap:7px;}
#rl-panel #rl-brief .dyn-chip{display:flex;align-items:baseline;gap:6px;padding:7px 11px;border:1px solid #e2e5ea;
  border-radius:9px;background:#f6f7f9;font-size:10.5px;font-weight:700;color:#6b7280;}
#rl-panel #rl-brief .dyn-chip b{font-size:14px;font-weight:800;color:#2a2c31;font-variant-numeric:tabular-nums;}
#rl-panel .cmp-head{display:flex;align-items:center;font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;color:#a2a5ac;padding:0 0 6px;border-bottom:1px solid #f0f1f3;}
#rl-panel .cmp-head span{flex:1;}
#rl-panel .cmp-head .cr,#rl-panel .cmp-head .cb{flex:none;width:100px;text-align:center;white-space:nowrap;}
#rl-panel .cmp-head .cr{color:#e60012;} #rl-panel .cmp-head .cb{color:#1f5fd0;}
#rl-panel .cmp-row{display:flex;align-items:center;font-size:12.5px;padding:8px 0;border-bottom:1px solid #f0f1f3;}
#rl-panel .cmp-row:last-child{border-bottom:0;}
#rl-panel .cmp-row .cl{flex:1;color:#54565c;}
#rl-panel .cmp-row .cr,#rl-panel .cmp-row .cb{flex:none;width:100px;text-align:center;font-variant-numeric:tabular-nums;font-weight:700;}
#rl-panel .cmp-row .cr{color:#e60012;} #rl-panel .cmp-row .cb{color:#1f5fd0;}
/* win-lead dot removed (pointless per user); the .win class now has no visual effect */

/* descriptive note under the Algorithm-internals / World settings cards */
#rl-panel .cfgnote{font-size:10.5px;color:#a2a5ac;margin:12px 0 0;line-height:1.45;}
#rl-panel .ctl-help{font-size:9.8px;color:#92969e;line-height:1.4;margin:6px 0 0;}
#rl-panel .range-ends{display:flex;justify-content:space-between;margin-top:5px;color:#8a8d94;
  font-size:9px;font-weight:800;letter-spacing:.35px;text-transform:uppercase;}
#rl-panel .dp-status{font-weight:800;text-align:right;}
#rl-panel .dp-status.ok{color:#1f7a3d;}
#rl-panel .dp-status.limit{color:#b45b12;}
/* Dynamic Programming plans from a known model: there is no ε exploration, TD
   update signal, DQN loss, or growing learned-state table in this arena. Keep
   those cards in the DOM for the learning rounds, but never show them on DP. */
#rl-panel.is-dp #rl-training-eps,
#rl-panel.is-dp #rl-training-q,
#rl-panel.is-dp #rl-curve-d-eps,
#rl-panel.is-dp #rl-curve-d-td,
#rl-panel.is-dp #rl-explore{display:none!important;}

/* segmented control (value-map mode) */
#rl-panel .seg{display:flex;border:1px solid #d7dade;border-radius:9px;overflow:hidden;}
#rl-panel .seg button{flex:1;border:0;border-right:1px solid #d7dade;border-radius:0;background:#fff;}
#rl-panel .seg button:last-child{border-right:0;}
/* round the END buttons themselves (not just the container) so an active button promoted
   to its own compositing layer during its transition can't pop square corners */
#rl-panel .seg button:first-child{border-top-left-radius:8px;border-bottom-left-radius:8px;}
#rl-panel .seg button:last-child{border-top-right-radius:8px;border-bottom-right-radius:8px;}
#rl-panel .seg button.active{background:#1f1f21;color:#fff;}

/* top-30 replay browser (per model) */
#rl-panel .replist{max-height:196px;overflow-y:auto;margin:10px 0 0;border:1px solid #e6e8ec;border-radius:10px;}
#rl-panel .replist .rrow{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;
  flex:none;margin:0;padding:8px 11px;border:0;border-bottom:1px solid #f0f1f3;border-radius:0;
  background:#fff;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer;
  -webkit-appearance:none;appearance:none;}
#rl-panel .replist .rrow:last-child{border-bottom:0;}
#rl-panel .replist .rrow:hover{background:#f0f1f3;}
#rl-panel .replist .rrow:focus-visible{outline:2px solid var(--hue);outline-offset:-2px;}
#rl-panel .replist .rrow.sel{background:#eaf0fb;box-shadow:inset 3px 0 0 #1f5fd0;}
#rl-panel .replist.red .rrow.sel{background:#fceceb;box-shadow:inset 3px 0 0 #e60012;} /* red model = red selection */
#rl-panel .replist .rrow .rk{color:#9a9da4;font-weight:800;width:30px;flex:none;}
#rl-panel .replist .rrow .st{font-variant-numeric:tabular-nums;font-weight:700;color:#1f1f21;}
#rl-panel .replist .rrow .rt{color:#6b7280;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;}
#rl-panel .replist .rrow .ep{margin-left:auto;color:#9a9da4;font-size:11px;font-variant-numeric:tabular-nums;}
/* milestone rows: an agent-coloured dot + the event label (mixed models in one list) */
#rl-panel .replist .rrow .mdot{width:9px;height:9px;border-radius:50%;flex:none;background:#1f5fd0;}
#rl-panel .replist .rrow .mdot.red{background:#e60012;}
#rl-panel .replist .rrow .ml{font-weight:700;color:#1f1f21;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#rl-panel .replist .rrow.ms.sel{background:#f1f3f6;box-shadow:inset 3px 0 0 #6b7280;}
#rl-panel .replist .empty{padding:15px 12px;color:#9a9da4;font-size:12px;text-align:center;}

/* selected-replay detail card: full stats for the picked run */
#rl-panel .repdetail{margin:8px 0 0;border:1px solid #e6e8ec;border-radius:10px;padding:6px 11px;background:#fbfbfc;}
#rl-panel .repdetail[hidden]{display:none;}
#rl-panel .repdetail .rd-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
  font-size:11.5px;padding:4px 0;border-bottom:1px solid #f0f1f3;}
#rl-panel .repdetail .rd-row:last-child{border-bottom:0;}
#rl-panel .repdetail .rd-k{color:#7a7d84;}
#rl-panel .repdetail .rd-v{color:#1f1f21;font-weight:700;font-variant-numeric:tabular-nums;text-align:right;}

/* Q inspector */
#rl-panel #rl-qinspect:empty{display:none;} /* no empty gap under the value map until a tile is clicked */
#rl-panel .qrow{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;padding:3px 0;}
#rl-panel .qrow .qbar{flex:1;margin:0 9px;height:8px;background:#eceef1;border-radius:4px;position:relative;}
#rl-panel .qrow .qbar i{position:absolute;top:0;bottom:0;background:#8a8d94;border-radius:4px;}
#rl-panel .qrow.blk{opacity:.42;} /* action blocked here (wall / no-op) - not chosen */
#rl-panel .blktag{font-size:9px;color:#b23127;letter-spacing:.3px;text-transform:uppercase;}
#rl-panel .hint{font-size:11px;color:#a2a5ac;margin-top:7px;line-height:1.45;}

/* learning-curve charts (built by graphs.js into this panel) */
#rl-panel .chart{margin:0 0 14px;}
#rl-panel .chart:last-child{margin-bottom:0;}
#rl-panel .chart.zoom-focus{outline:2px solid #141518;outline-offset:3px;border-radius:10px;}
#rl-panel .chart .ct{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
#rl-panel .chart .ct h3{margin:0;font-size:11.5px;font-weight:700;color:#3a3b40;}
#rl-panel .chart .ct .lg{font-size:9.5px;color:#9a9da4;display:flex;gap:10px;}
#rl-panel .chart .ct .lg i{display:inline-block;width:10px;height:3px;border-radius:2px;vertical-align:middle;margin-right:4px;}
#rl-panel .chart canvas{width:100%;height:132px;background:#fbfbfc;border:1px solid #eceef1;border-radius:9px;display:block;}
`;

// Fold every card into big titled groups, in the given order. Each group renders
// a large plain-language heading, an optional one-line subtitle, then its cards
// stacked vertically (one scrolling column). A catch-all 'More' group guarantees
// any unmapped/future section still appears (never silently dropped). Shared by
// the shared control panel.
//   groups = [[id, title, [sectionId, ...], subtitle?], ...]
export function organizeGroups(body, groups) {
  const mk = (id, title, sub) => {
    const g = document.createElement('div');
    g.className = 'rl-group';
    g.dataset.group = id;
    // (subtitle intentionally not rendered - the user removed the per-tab explainer
    // one-liner; the `sub` field in the group tuples is kept but ignored)
    g.innerHTML = `<h2 class="rl-group-h">${title}</h2>` +
      '<div class="rl-group-cards"></div>';
    return g;
  };
  const els = groups.map(([id, title, ids, sub]) => {
    const g = mk(id, title, sub);
    const cards = g.querySelector('.rl-group-cards');
    for (const sid of ids) {
      const sec = body.querySelector('#' + sid);
      if (sec) cards.appendChild(sec); // moves the node out of the flat body
    }
    return g;
  });
  const leftover = [...body.querySelectorAll(':scope > section')];
  if (leftover.length) {
    const g = mk('more', 'More');
    const cards = g.querySelector('.rl-group-cards');
    leftover.forEach((s) => cards.appendChild(s));
    els.push(g);
  }
  for (const g of els) body.appendChild(g);
}

// Playback is pinned at the top (handled separately, not a tab). The rest are
// TABS in a story order a newcomer can follow: understand the task -> see the
// score -> watch it learn -> tune it -> deeper knobs -> look inside its head ->
// rewatch great runs. Tuple is [id, title, [sectionIds], subtitle, tabLabel].
const N_GROUPS = [
  ['challenge', "What's the challenge?", ['rl-brief'],
    'The task both AIs are racing to solve, and how their two methods differ.', 'Challenge'],
  ['tune', 'Tune your AI', ['rl-sec-hyper'],
    'Change how your AI learns. Effects show up live.', 'Tune'],
  ['advanced', 'World', ['rl-sec-shared', 'rl-sec-algo', 'rl-sec-world'],
    'Deeper knobs for the algorithm and the world itself. Safe to ignore.', 'World'],
  ['inside', 'Inside the AI', ['rl-sec-value', 'rl-polagree', 'rl-dp', 'rl-va', 'rl-dqn', 'rl-actdist'],
    'Peek at what your AI has actually learned.', 'Inside'],
  ['progress', 'Training progress', ['rl-sec-training', 'rl-curve-d-rate', 'rl-curve-d-return', 'rl-curve-d-eps', 'rl-curve-d-len', 'rl-probe', 'rl-curve-d-td', 'rl-reward', 'rl-explore'],
    'Watch your AI (Blue) get better over time.', 'Progress'],
  ['score', 'Scoreboard', ['rl-compare', 'rl-outcomes'],
    'Who is winning right now.', 'Score'],
  ['replays', 'Replays', ['rl-replay', 'rl-traj'], '', 'Replays'],
];

// Build the sticky tab bar (one tab per group) and wire it to swap sections. The
// tab bar pins right under the sticky header; clicking a tab shows only that
// group and scrolls the panel back to the top.
export function buildTabs(panel, body, groups) {
  // the header may live OUTSIDE `body` (the merged panel shares one header across two
  // view containers) - fall back to the panel's header for the sticky offset
  const hdr = body.querySelector('.hdr') || panel.querySelector('.hdr');
  const bar = document.createElement('div');
  bar.className = 'rl-tabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Control menu sections');
  const tabs = [...body.querySelectorAll('.rl-group')].map((g) => {
    const meta = groups.find((x) => x[0] === g.dataset.group);
    g.id = `rl-group-${g.dataset.group}`;
    g.setAttribute('role', 'tabpanel');
    const btn = document.createElement('button');
    btn.id = `rl-tab-${g.dataset.group}`;
    btn.type = 'button';
    btn.className = 'rl-tab';
    btn.dataset.group = g.dataset.group;
    btn.textContent = (meta && (meta[4] || meta[1])) || g.dataset.group;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', g.id);
    g.setAttribute('aria-labelledby', btn.id);
    bar.appendChild(btn);
    return { btn, g };
  });
  // place the tab bar right before the first section (i.e. below any pinned-top
  // cards like Playback), falling back to just after the header
  const firstGroup = body.querySelector('.rl-group');
  if (firstGroup) body.insertBefore(bar, firstGroup);
  else hdr.insertAdjacentElement('afterend', bar);
  // one sliding highlight (glow + underline) that animates between tabs; sits
  // behind the labels (inserted first) and is positioned by JS to the active tab
  const hl = document.createElement('div');
  hl.className = 'rl-tab-hl';
  bar.insertBefore(hl, bar.firstChild);
  let hlPlaced = false;
  const moveHl = () => {
    const act = tabs.find((t) => t.btn.classList.contains('active'));
    if (!act || !act.btn.offsetWidth) return;              // hidden: metrics not ready yet
    if (!hlPlaced) hl.style.transition = 'none';           // first placement must not slide in from 0
    hl.style.width = act.btn.offsetWidth + 'px';
    hl.style.transform = 'translateX(' + act.btn.offsetLeft + 'px)';
    if (!hlPlaced) { void hl.offsetWidth; hl.style.transition = ''; hlPlaced = true; }
  };
  // keep the tab bar pinned directly below the (also-sticky) header, and the
  // highlight aligned. The header can measure 0 while the panel is hidden during
  // the start menu, so recompute on tab switch, first snapshot, and resize.
  const setOffset = () => { if (hdr.offsetHeight) bar.style.top = hdr.offsetHeight + 'px'; moveHl(); };
  const activate = (id) => {
    for (const { btn, g } of tabs) {
      const on = g.dataset.group === id;
      g.classList.toggle('active', on);
      g.hidden = !on;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      if (on) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    moveHl();
    body.scrollTop = 0;
  };
  tabs.forEach(({ btn }) => btn.addEventListener('click', () => activate(btn.dataset.group)));
  bar.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const current = tabs.findIndex(({ btn }) => btn.classList.contains('active'));
    let next = current;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else next = (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    activate(tabs[next].g.dataset.group);
    tabs[next].btn.focus();
  });
  if (tabs.length) activate(tabs[0].g.dataset.group);
  setOffset();
  window.addEventListener('resize', setOffset);
  window.addEventListener('rl-snapshot', setOffset, { once: true });
  if (window.ResizeObserver) {
    new ResizeObserver(setOffset).observe(hdr);
    new ResizeObserver(moveHl).observe(bar);   // reposition the highlight if the bar reflows
  }
  return activate;
}

export function initPanel() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const ctlHTML = (p) => {
    const learn = p.color === C_OURS;   // a per-model learning knob (tints blue <-> red)
    const fill = learn ? 'var(--hue)' : (p.color || C_GLOBAL);
    const showHelp = ['dpTheta', 'dpMaxIters', 'dpPlanning'].includes(p.key);
    const outcomeEnds = p.key === 'blockGhostProb'
      ? '<div class="range-ends"><span>Freeze</span><span>Ghost</span></div>' : '';
    const tip = (p.desc || '').replace(/"/g, '&quot;');
    return `
    <div class="ctl${learn ? ' learn' : ''}" data-scope="${p.scope}">
      <div class="row"><span title="${tip}">${p.label}</span><b id="rl-pv-${p.key}">-</b></div>
      <input type="range" id="rl-p-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.min}" title="${tip}" style="--fill:${fill}">
      ${outcomeEnds}
      ${showHelp && p.desc ? `<p class="ctl-help">${p.desc}</p>` : ''}
    </div>`;
  };
  // Scope drives placement: coloured controls tune one selected model; black
  // controls affect both models / the run / the environment and belong in World.
  const tuneParams = [...PARAMS, ...GLOBAL_PARAMS].filter((p) => p.color === C_OURS);
  const sharedParams = PARAMS.filter((p) => p.color !== C_OURS);
  const algoParams = GLOBAL_PARAMS.filter((p) => p.sect === 'algo' && p.color !== C_OURS);
  const worldParams = GLOBAL_PARAMS.filter((p) => p.sect === 'world' && p.color !== C_OURS);

  const panel = document.createElement('div');
  panel.id = 'rl-panel';
  panel.innerHTML = `
    <div class="rl-body">
    <div class="hdr">
      <button class="lockbtn" type="button" aria-label="Unlock the CPU's values"></button>
      <button class="turbobtn" type="button" aria-label="Turbo: fast-forward training"></button>
      <div class="harena"><b id="rl-arena">-</b><div class="rdots" id="rl-round"></div></div>
      <div class="mselect" role="group" aria-label="Model view">
        <span class="msel-wash" aria-hidden="true"></span>
        <button type="button" class="msel your active" data-view="your" aria-pressed="true">
          <span class="msel-k">Your model</span>
          <b class="msel-n" id="rl-mb">-</b>
          <em class="msel-s" id="rl-vs"></em>
        </button>
        <button type="button" class="msel cpu" data-view="cpu" aria-pressed="false">
          <span class="msel-k">CPU model</span>
          <b class="msel-n" id="rl-cp-algo">-</b>
          <em class="msel-s" id="rl-cp-tier"></em>
        </button>
      </div>
    </div>
    <section id="rl-sec-playback" class="qk">
      <h2>Playback</h2>
      <button id="rl-rep-tag" class="reptag" type="button" aria-label="Back to live">
        <span class="reptag-face reptag-front">Replay</span>
        <span class="reptag-face reptag-back">Back to live</span>
      </button>
      <div class="transport" role="group" aria-label="Playback controls">
        <button id="rl-prev" class="tbtn" type="button" aria-label="Previous round">${SVG.prev}</button>
        <button id="rl-play" class="tplay" type="button" aria-label="Pause live training">${SVG.pause}</button>
        <button id="rl-next" class="tbtn" type="button" aria-label="Next round">${SVG.next}</button>
      </div>
      <div class="ctl" id="rl-rep-scrub">
        <div class="row"><span id="rl-rep-info">Replay</span><b id="rl-rep-frame"></b></div>
        <input type="range" id="rl-rep-seek" min="0" max="0" value="0"
          aria-label="Replay position" style="--fill:#1f5fd0">
      </div>
      <div class="btns" style="margin-top:14px;">
        <button id="rl-reset">↺ Reset</button>
        <button id="rl-regen">⟳ New world</button>
      </div>
      <div class="ctl" style="margin-top:13px;">
        <div class="row"><span>Speed</span><b id="rl-spd-val">-</b></div>
        <input type="range" id="rl-speed" min="0" max="100" value="10"
          aria-label="Simulation and replay speed" style="--fill:#141518">
      </div>
    </section>
    <section id="rl-sec-hyper" class="qk">
      <h2><span id="rl-ple-model">Your model</span> parameters</h2>
      ${tuneParams.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-shared">
      <h2>Run &amp; episodes</h2>
      ${sharedParams.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-algo">
      <h2>Algorithm internals</h2>
      ${algoParams.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-world">
      <h2>World &amp; dynamics</h2>
      ${worldParams.map(ctlHTML).join('')}
    </section>
    <section id="rl-sec-training" class="qk">
      <h2>Training</h2>
      <div class="stat"><span>Episode</span><b id="rl-ep">0</b></div>
      <div class="stat" id="rl-curriculum" hidden><span>Full-course / section starts</span><b id="rl-curriculum-val">0 / 0</b></div>
      <div class="stat" id="rl-training-eps"><span>Exploration ε</span><b id="rl-eps">1.00</b></div>
      <div class="stat fullonly"><span>Total steps</span><b id="rl-steps">0</b></div>
      <div class="stat fullonly"><span>Avg full-course length</span><b id="rl-len">-</b></div>
      <div class="stat fullonly"><span>Last full-course return (B / R)</span><b id="rl-ret">-</b></div>
      <div class="stat fullonly" id="rl-training-q"><span>Learned states (B / R)</span><b id="rl-q">0 / 0</b></div>
    </section>
    <section id="rl-sec-value" class="qk">
      <h2>Value map</h2>
      <div class="seg" role="group" aria-label="Diagnostic map mode">
        <button id="rl-h-off" type="button" class="active" aria-pressed="true">Off</button>
        <button id="rl-h-policy" type="button" aria-pressed="false">Policy</button>
        <button id="rl-h-value" type="button" aria-pressed="false">Value</button>
        <button id="rl-h-visits" type="button" aria-pressed="false">Visits</button>
      </div>
      <p class="hint" id="rl-map-context"></p>
      <div id="rl-qinspect" style="margin-top:8px;"></div>
    </section>
    </div>
    <aside id="rl-converged-pin" class="converged-pin" hidden aria-live="polite">
      <span class="converged-pin-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>
      </span>
      <span class="converged-pin-copy">
        <b>Models converged</b>
        <span>Planning is finished. Both models now compete using their fixed policies.</span>
      </span>
    </aside>
    <aside id="rl-train-done-pin" class="converged-pin" hidden aria-live="polite">
      <span class="converged-pin-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>
      </span>
      <span class="converged-pin-copy">
        <b>Training complete</b>
        <span class="td-sub">The episode limit was reached; training has stopped.</span>
      </span>
    </aside>`;
  document.body.appendChild(panel);

  // learning-curve charts + episode replay (built by graphs.js) into the same
  // .rl-body wrapper, then fold every card (native + the graphs.js sections) into
  // the big titled groups. Any section not named still shows (catch-all group) so
  // nothing is ever silently dropped.
  const body = panel.querySelector('.rl-body');
  const playback = body.querySelector('#rl-sec-playback');
  const lockBtn = body.querySelector('.lockbtn');
  const turboBtn = body.querySelector('.turbobtn');
  const hdrEl = body.querySelector('.hdr');
  initGraphs(body); // the player's graph sections

  // Playback pinned at the top (not a tab); fold everything else into the tabbed groups.
  playback.remove();
  organizeGroups(body, N_GROUPS);
  hdrEl.insertAdjacentElement('afterend', playback);
  buildTabs(panel, body, N_GROUPS);

  // ---- model selector: picking the CPU tints the accent + the learning sliders
  // red (via --hue) and shows the CPU's values; the lock swings in and locks ONLY those red
  // sliders. The black (shared) sliders stay open. No section swap / whole-tab fade. The
  // per-model helpers (loadLearn / applyLock / rewriteModelLabel / reShowRelevant / lock UI)
  // are defined further down once the sliders are wired; applyModel calls them at click time.
  panel.dataset.model = 'your';
  const msels = [...panel.querySelectorAll('.mselect .msel')];
  let lastEps = { blue: 1, red: 1 };
  const updateEps = () => {
    const el = panel.querySelector('#rl-eps');
    if (el) el.textContent = ((panel.dataset.model === 'cpu' ? lastEps.red : lastEps.blue) ?? 0).toFixed(2);
  };
  let lastParams = {}, lastRedParams = {}, cpuLocked = true;
  const applyModel = (m) => {
    panel.dataset.model = m;   // tints --hue (blue <-> red) + the tab accent
    updateEps();
    loadLearn();               // learning sliders -> the selected model's values
    applyLock();               // red learning sliders locked only on CPU + locked
    rewriteModelLabel(m);      // legend "Your model" <-> "CPU model" (rewrite animation)
    reShowRelevant();          // controls relevant to the selected model's algorithm
    window.dispatchEvent(new CustomEvent('rl-modelview', { detail: { model: m } }));
    window.dispatchEvent(new Event('resize'));
  };
  const setModel = (m) => {
    const changed = panel.dataset.model !== m;
    msels.forEach((b) => {
      const on = b.dataset.view === m;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    lockBtn.classList.toggle('show', m === 'cpu'); // the lock swings in on the CPU model
    if (!changed) return;
    applyModel(m);
  };
  msels.forEach((b) => b.addEventListener('click', () => setModel(b.dataset.view)));

  const $ = (id) => panel.querySelector(id);
  const popcount = (value) => {
    let n = value | 0, count = 0;
    while (n) { count += n & 1; n >>>= 1; }
    return count;
  };
  const setMapContext = (mask, total, replay = false) => {
    const el = $('#rl-map-context');
    if (!el) return;
    if (mask == null || !total) {
      el.textContent = replay
        ? 'Replay motion may include exploration; the map shows the frozen greedy model. Tied greedy actions have no arrow.'
        : '';
      return;
    }
    el.textContent = `Model context: ${popcount(mask)}/${total} tomatoes collected.` +
      (replay ? ' Motion may include ε exploration or a puddle skid; Policy/Value show the frozen greedy model.' : '') +
      ' Policy arrows appear only for a unique greedy action.';
  };

  // paint the filled (left-of-thumb) part of a range slider red
  const paintRange = (el) => {
    if (!el) return;
    const min = +el.min, max = +el.max, v = +el.value;
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    const fill = el.style.getPropertyValue('--fill') || '#8a8d94';
    el.style.background = `linear-gradient(to right,${fill} ${pct}%,#e1e3e8 ${pct}%)`;
  };

  // ---- open / close the control menu (C key) ----
  if (new URLSearchParams(location.search).has('panel')) panel.classList.add('open');
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && panel.classList.contains('open')) {
      e.preventDefault();
      panel.classList.remove('open');
      return;
    }
    if (e.code !== 'KeyC' || /input|select|textarea/i.test(e.target.tagName)) return;
    if (getComputedStyle(panel).display === 'none') return; // hidden while the start menu is up
    window.RL?.panels?.toggle?.();
  });
  // ---- playback ----
  let paused = false;
  // arena nav (prev/next round) must fire ONCE per press, not once PER CLICK -
  // spamming next used to advance a round on every click. A shared lock silently
  // swallows the extra clicks for ~one transition (no visual disable).
  let navLock = false;
  const navRound = (cmd) => {
    if (navLock) return; // ignore the spam while a change is already under way
    navLock = true;
    window.RL.control({ cmd });
    setTimeout(() => { navLock = false; }, 2600); // ~one iris transition
  };
  $('#rl-prev').addEventListener('click', () => navRound('prevRound'));
  $('#rl-next').addEventListener('click', () => navRound('nextRound'));
  const speed = $('#rl-speed');
  // Round 4 runs a 5x-finer sim step (0.02 s vs 0.1 s), so it needs 5x the steps/sec
  // for the SAME on-screen pace. speedMul carries that factor per round, so both the
  // number the user sees AND the rate the sim runs at include it (e.g. slider 5 -> 25).
  let speedMul = 1;
  const effSpeed = () => Math.round(sliderToSpeed(+speed.value) * speedMul);
  const showSpeed = () => {
    $('#rl-spd-val').textContent = `${effSpeed().toLocaleString()} / s`;
    paintRange(speed);
  };
  const sendSpeed = () => window.RL.control({ cmd: 'speed', value: effSpeed() });
  // a loaded replay plays at the CURRENT speed setting (mapped to a watchable fps)
  const replayFps = () => Math.max(1, Math.min(60, effSpeed()));
  // move the slider to ~5/s (accounting for the round's speedMul so the shown number is 5)
  const setSpeedToReplayPace = () => {
    speed.value = Math.max(0, Math.min(100, Math.round(speedToSlider(REPLAY_VIEW_SPS / speedMul))));
    showSpeed();
    sendSpeed();
  };

  // ---- Arena-2 TURBO: a blue lightning button that sits in the CPU lock's exact slot
  // (top-right of the header). One click JUMPS training TURBO_SKIP episodes into the future
  // instantly - no rendering, the server burns through them and reports progress. Shown only
  // in Arena 2 (round index 1) on the Blue (your) model, so it never overlaps the CPU lock.
  const TURBO_BOLT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>';
  const TURBO_SKIP = 5000;    // episodes to fast-forward per click
  turboBtn.innerHTML = TURBO_BOLT;
  // full-panel scrim shown WHILE a skip runs: grays out + blocks the whole menu, with a
  // live countdown. Sibling of .rl-body (so .rl-body's own styling can't dim the message).
  const ffScrim = document.createElement('div');
  ffScrim.className = 'ff-scrim';
  ffScrim.setAttribute('aria-live', 'polite');
  ffScrim.innerHTML = `<div class="ff-card"><span class="ff-bolt">${TURBO_BOLT}</span><b>Skipping ahead</b><span class="ff-n"></span></div>`;
  panel.appendChild(ffScrim);
  const ffN = ffScrim.querySelector('.ff-n');
  let turboRound = -1, ffRemaining = 0, ffFiredAt = 0;
  const updateTurboBtn = () => {
    const show = turboRound === 1 && panel.dataset.model === 'your';
    turboBtn.classList.toggle('show', show);
    if (show) panel.dataset.turbo = 'on'; else delete panel.dataset.turbo; // reserve header space
    const working = ffRemaining > 0;
    turboBtn.classList.toggle('working', working);
    // gray out + lock the whole menu while the skip is running
    if (working) { panel.dataset.ff = 'on'; ffN.textContent = `${ffRemaining.toLocaleString()} episodes to go`; }
    else delete panel.dataset.ff;
    const label = working
      ? `Skipping ahead - ${ffRemaining.toLocaleString()} episodes to go`
      : `Turbo: jump ${TURBO_SKIP.toLocaleString()} episodes into the future`;
    turboBtn.title = label;
    turboBtn.setAttribute('aria-label', label);
  };
  turboBtn.addEventListener('click', () => {
    if (ffRemaining > 0) return;                 // already skipping
    ffFiredAt = performance.now();
    ffRemaining = TURBO_SKIP;                     // optimistic; the snapshot corrects it
    updateTurboBtn();
    window.RL.control({ cmd: 'fastForward', episodes: TURBO_SKIP });
  });
  // the snapshot poll drives the working state + re-enables the button when the jump ends
  const setFfRemaining = (n) => {
    const v = Math.max(0, n | 0);
    // ignore a stale 0 for a beat after firing (the server may not have started the skip yet)
    if (v === 0 && performance.now() - ffFiredAt < 1500) return;
    if (v === ffRemaining) return;
    ffRemaining = v;
    updateTurboBtn();
  };
  // switching Blue <-> CPU only shows/hides the button (state is server-side)
  window.addEventListener('rl-modelview', updateTurboBtn);

  const setSpeedRound = (roundIndex) => {
    // continuous arenas run a finer tick than the 0.1 s reference, so their step rate
    // is scaled up for the SAME on-screen pace: R4 (0.02 s) x5, R5 (0.05 s) x2.
    const mul = roundIndex === 3 ? 5 : roundIndex === 4 ? 2 : 1;
    if (mul === speedMul) return;
    speedMul = mul;
    showSpeed();
    sendSpeed();
    if (window.RL.replay?.active?.()) window.RL.replay.setFps(replayFps());
  };
  speed.addEventListener('input', () => {
    showSpeed();
    sendSpeed();
    if (window.RL.replay?.active?.()) window.RL.replay.setFps(replayFps());
  });
  showSpeed();
  sendSpeed();

  // play/pause is DUAL-MODE: drives the loaded replay when there is one, else the live game
  const playBtn = $('#rl-play');
  const setLiveIcon = () => {
    playBtn.innerHTML = paused ? SVG.play : SVG.pause;
    playBtn.setAttribute('aria-label', paused ? 'Resume live training' : 'Pause live training');
  };
  playBtn.addEventListener('click', () => {
    if (window.RL.replay?.active?.()) window.RL.replay.toggle(); // icon updates via rl-replay-state
    else {
      paused = !paused;
      window.RL.control({ cmd: paused ? 'pause' : 'play' });
      setLiveIcon();
    }
  });
  $('#rl-regen').addEventListener('click', () => window.RL.control({ cmd: 'regenerate' }));
  $('#rl-reset').addEventListener('click', () => window.RL.control({ cmd: 'reset' }));

  // ---- replay controls: revealed in Playback while a recorded run is loaded ----
  const repTag = $('#rl-rep-tag'), scrubEl = $('#rl-rep-scrub'), seekEl = $('#rl-rep-seek');
  const repInfo = $('#rl-rep-info'), repFrame = $('#rl-rep-frame');
  seekEl.addEventListener('input', () => { paintRange(seekEl); window.RL.replay?.seek?.(+seekEl.value); });
  repTag.addEventListener('click', () => window.RL.replay?.stop?.()); // the tag itself = Back to live
  let lastReplayActive = false;
  window.addEventListener('rl-replay-state', (e) => {
    const s = e.detail || {};
    const on = !!s.active;
    repTag.classList.toggle('show', on);   // slides in from the corner / out again
    scrubEl.classList.toggle('show', on);  // grows in / collapses
    // red model -> the whole replay UI (tag REPLAY bg, play button, scrubber) goes red
    const red = on && s.agent === 'red';
    // A replay owns the model context. Synchronize on EVERY replay-state event
    // (including Blue -> Red replacement while already active), and lock the
    // selector so its label can never disagree with the historical overlay.
    if (on) setModel(red ? 'cpu' : 'your');
    msels.forEach((b) => {
      b.disabled = on;
      b.setAttribute('aria-disabled', on ? 'true' : 'false');
    });
    repTag.classList.toggle('red', red);
    // live = gray (CSS default), blue replay = blue, red replay = red
    playBtn.style.background = on ? (red ? '#e60012' : '#1f5fd0') : '';
    if (on) {
      setMapContext(s.tomatoMask, s.nTomatoes, true);
      if (!lastReplayActive) setSpeedToReplayPace();  // moving into a replay: drop the slider to 5/s
      window.RL.replay?.setFps?.(replayFps());        // play at whatever the slider now reads
      seekEl.style.setProperty('--fill', red ? '#e60012' : '#1f5fd0'); // scrubber matches the model
      seekEl.max = Math.max(0, (s.total || 1) - 1);
      if (document.activeElement !== seekEl) { seekEl.value = s.idx; paintRange(seekEl); } // don't fight a drag
      repInfo.textContent = s.label || 'Replay';
      repFrame.textContent = s.total ? `${s.idx + 1}/${s.total}` : '';
      playBtn.innerHTML = s.playing ? SVG.pause : SVG.play;
      playBtn.setAttribute('aria-label', s.playing ? 'Pause replay' : 'Play replay');
    } else {
      setMapContext(null, null, false);
      setLiveIcon(); // back to live: restore the live play/pause icon
    }
    lastReplayActive = on;
  });

  // ---- hyperparameters + global settings: drive the trainer live (debounced) ----
  // one combined list so labels / seeding / sends cover both the per-side learning
  // sliders (PARAMS) and the global structural sliders (GLOBAL_PARAMS).
  const ALL_PARAMS = [...PARAMS, ...GLOBAL_PARAMS];
  const setLabel = (p) => {
    $(`#rl-pv-${p.key}`).textContent = p.fmt(+$(`#rl-p-${p.key}`).value);
    paintRange($(`#rl-p-${p.key}`));
  };
  // Send only the keys the user actually touched, so nudging α never triggers a
  // structural world rebuild such as changing the seed.
  let applyTimer = null;
  let seedTimer = null;
  const emptyPending = () => ({ mine: {}, cpu: {} });
  let pending = emptyPending();
  const flush = () => {
    const { mine, cpu } = pending;
    pending = emptyPending();
    if (Object.keys(mine).length) window.RL.control({ cmd: 'setParams', params: mine });
    if (Object.keys(cpu).length) window.RL.control({ cmd: 'setRedParams', params: cpu });
    applyTimer = null;
  };
  const queue = (p) => {
    const raw = +$(`#rl-p-${p.key}`).value;
    // Random seed rebuilds the entire world. During a drag or held arrow key,
    // keep replacing the requested seed and trigger exactly once after input settles.
    if (p.key === 'trainSeed') {
      clearTimeout(seedTimer);
      seedTimer = setTimeout(() => {
        window.RL.control({ cmd: 'setParams', params: { trainSeed: raw } });
        seedTimer = null;
      }, 700);
      return;
    }
    // Capture the destination now: switching model tabs before the debounce
    // expires must not redirect an edit to the other model.
    const target = panel.dataset.model === 'cpu' && p.color === C_OURS ? 'cpu' : 'mine';
    pending[target][p.key] = p.enc ? p.enc(raw) : raw;
    clearTimeout(applyTimer);
    applyTimer = setTimeout(flush, 160);
  };
  for (const p of ALL_PARAMS) {
    setLabel(p);
    $(`#rl-p-${p.key}`).addEventListener('input', () => { setLabel(p); queue(p); });
  }
  // set a slider from a BACKEND-space value (dec-maps enc params) - seeding only
  const setFromBackend = (p, val) => {
    const el = $(`#rl-p-${p.key}`);
    if (!el || val == null) return;
    const next = p.dec ? p.dec(val) : val;
    if (+el.value === +next) return;
    el.value = next;
    setLabel(p);
  };

  let lastAlgoBlue = null, lastAlgoRed = null;  // re-show relevant controls per model + round
  let lastRoundIndex = -1;  // round-scoped world controls depend on the arena, not just the algorithm

  // show only the controls that matter for THIS round: hide α / ε on DP rounds
  // (planners use only γ); algorithm internals and arena dynamics each appear
  // only where they apply. Then hide any settings card left empty.
  const showRelevant = (algoBlue, roundIndex) => {
    const isDP = DP_ALGOS.has(algoBlue);
    const isDqn = DQN_ALGOS.has(algoBlue);
    const isPg = PG_ALGOS.has(algoBlue);
    panel.classList.toggle('is-dp', isDP);
    const vis = (sc) => {
      switch (sc) {
        case 'learn': return !isDP;               // learning rate α: every learner (not DP)
        case 'eps': return !isDP && !isPg;        // ε-greedy schedule: not DP, not PG (PG samples its policy)
        case 'dp': return isDP;                   // convergence + sweeps + speed: DP round
        case 'dqn': return isDqn;                 // replay / batch / target-net: DQN rounds only
        case 'pg': return isPg;                   // policy-gradient internals: R5 (REINFORCE/AC/PPO)
        case 'r1': return roundIndex === 0;       // Round-1 game mechanics (ice + "?" blocks)
        case 'r2': return roundIndex === 1;       // Round-2 game mechanics (regioned maze: pipes + puddles)
        case 'r3': return roundIndex === 2;       // Round-3 game mechanics (Fossil Falls wet cells)
        case 'r4': return roundIndex === 3;       // Round-4 game feel (missiles / hearts / hit penalty)
        case 'r5': return roundIndex === 4;       // Round-5 game feel (Bowser airship: throw count/speed/sight)
        default: return true;                     // 'always'
      }
    };
    panel.querySelectorAll('.ctl[data-scope]').forEach((el) => {
      el.style.display = vis(el.dataset.scope) ? '' : 'none';
    });
    // collapse a settings card whose every slider is now hidden
    ['rl-sec-hyper', 'rl-sec-shared', 'rl-sec-algo', 'rl-sec-world'].forEach((id) => {
      const sec = panel.querySelector('#' + id);
      if (!sec) return;
      sec.hidden = ![...sec.querySelectorAll('.ctl[data-scope]')].some((el) => el.style.display !== 'none');
    });
  };

  // ---- per-model helpers used by applyModel (defined here, once the sliders exist) ----
  const loadLearn = () => {
    const src = panel.dataset.model === 'cpu' ? lastRedParams : lastParams;
    for (const p of ALL_PARAMS) if (p.color === C_OURS) setFromBackend(p, src[p.key]);
  };
  const applyLock = () => {
    const disable = panel.dataset.model === 'cpu' && cpuLocked;
    panel.querySelectorAll('.ctl.learn input[type=range]').forEach((el) => { el.disabled = disable; });
  };
  const reShowRelevant = () =>
    showRelevant(panel.dataset.model === 'cpu' ? lastAlgoRed : lastAlgoBlue, lastRoundIndex);
  // legend label rewrite: erase the current text, then type the target (a small typewriter)
  let rewriteTimer = null;
  const rewriteModelLabel = (m) => {
    const el = panel.querySelector('#rl-ple-model');
    if (!el) return;
    const target = m === 'cpu' ? 'CPU model' : 'Your model';
    clearInterval(rewriteTimer);
    let cur = el.textContent;
    rewriteTimer = setInterval(() => {
      if (cur.length) { cur = cur.slice(0, -1); el.textContent = cur; }
      else {
        clearInterval(rewriteTimer);
        let i = 0;
        rewriteTimer = setInterval(() => {
          if (i < target.length) el.textContent = target.slice(0, ++i);
          else clearInterval(rewriteTimer);
        }, 26);
      }
    }, 16);
  };
  // the CPU lock (top-right, swings in on the CPU model): locks only the red learning sliders
  const LOCK_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
  const LOCK_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 7.8-1.1"/></svg>';
  const updateLockUI = () => {
    lockBtn.innerHTML = cpuLocked ? LOCK_CLOSED : LOCK_OPEN;
    lockBtn.classList.toggle('locked', cpuLocked);
    const action = cpuLocked ? "Unlock to edit the CPU's values" : "Lock the CPU's values";
    lockBtn.title = action;
    lockBtn.setAttribute('aria-label', action);
  };
  updateLockUI();
  lockBtn.addEventListener('click', () => {
    cpuLocked = !cpuLocked;
    updateLockUI();
    applyLock();
  });

  // ---- value-map mode ----
  // ONE value map, shared by both views: it targets whichever model is selected (Blue =
  // you, Red = CPU). Modes Off / Value / Policy / Visits.
  const hbtns = { off: $('#rl-h-off'), value: $('#rl-h-value'), policy: $('#rl-h-policy'), visits: $('#rl-h-visits') };
  const heatAgent = () => (panel.dataset.model === 'cpu' ? 'red' : 'blue');
  const markHeatMode = (m) => {
    for (const k in hbtns) {
      const on = k === m;
      hbtns[k].classList.toggle('active', on);
      hbtns[k].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };
  const setMode = (m) => {
    markHeatMode(m);
    if (m === 'off') { window.RL.setHeatmap(null); $('#rl-qinspect').innerHTML = ''; }
    else window.RL.setHeatmap(heatAgent(), m);
  };
  hbtns.off.addEventListener('click', () => setMode('off'));
  hbtns.value.addEventListener('click', () => setMode('value'));
  hbtns.policy.addEventListener('click', () => setMode('policy'));
  hbtns.visits.addEventListener('click', () => setMode('visits'));
  // switching model re-points an active overlay at the newly-selected model
  window.addEventListener('rl-modelview', () => {
    const cur = Object.keys(hbtns).find((k) => hbtns[k].classList.contains('active'));
    if (cur && cur !== 'off') setMode(cur);
  });
  // if some other source grabs the single overlay, fall back to Off here
  window.addEventListener('rl-heatmap', (e) => {
    if ((e.detail || {}).agent !== heatAgent()) {
      markHeatMode('off');
      $('#rl-qinspect').innerHTML = '';
    }
  });

  // ---- live stats ----
  window.addEventListener('rl-snapshot', (e) => {
    const s = e.detail.stats;
    if (!s) return;
    if (typeof s.paused === 'boolean') paused = s.paused;
    if (!window.RL.replay?.active?.()) setLiveIcon();
    if (!window.RL.replay?.active?.()) {
      const frame = e.detail.frame || {};
      const side = panel.dataset.model === 'cpu' ? 'red' : 'blue';
      setMapContext(frame[side + 'Stars'], frame.nStars, false);
    }
    // Cache both models, then continuously rehydrate every control that has no
    // debounced edit pending. This keeps seed, per-round max steps, CPU profiles
    // and reset values truthful.
    if (s.params) lastParams = s.params;
    if (s.redParams) lastRedParams = s.redParams;
    const modelParams = panel.dataset.model === 'cpu' ? lastRedParams : lastParams;
    for (const p of ALL_PARAMS) {
      const targetPending = p.color === C_OURS && panel.dataset.model === 'cpu'
        ? pending.cpu
        : pending.mine;
      const busy = Object.prototype.hasOwnProperty.call(targetPending, p.key)
        || (p.key === 'trainSeed' && seedTimer != null);
      if (busy) continue;
      const src = p.color === C_OURS ? modelParams : lastParams;
      setFromBackend(p, src?.[p.key]);
    }
    $('#rl-mb').textContent = NAMES[s.algoBlue] || s.algoBlue || '-';
    const redNm = NAMES[s.algoRed] || s.algoRed || '';
    const level = Math.max(0, Math.min(CPU_NAMES.length - 1, s.cpuLevel ?? 0));
    const cpuName = CPU_NAMES[level] || 'CPU';
    const cpuLabel = CPU_LEVEL_LABELS[level] || '';
    const tier = s.cpuTier ? `${cpuName} - ${cpuLabel}` : cpuName;
    $('#rl-vs').textContent = redNm
      ? `vs ${redNm}${tier ? ` - ${tier}` : ''}`
      : (tier ? `vs ${tier}` : '');
    // the CPU card in the header selector
    $('#rl-cp-algo').textContent = redNm || '-';
    $('#rl-cp-tier').textContent = s.cpuTier
      ? `${cpuName} · Tier ${s.cpuTier} - ${cpuLabel}` : cpuName;
    const r = s.round || {};
    const ri = r.index ?? 0;
    if (s.algoBlue !== lastAlgoBlue || s.algoRed !== lastAlgoRed || ri !== lastRoundIndex) {
      lastAlgoBlue = s.algoBlue; lastAlgoRed = s.algoRed; lastRoundIndex = ri;
      reShowRelevant();
      setSpeedRound(ri);   // R4 needs the 5x speed factor; others 1x
      turboRound = ri;
      updateTurboBtn();    // show the lightning only in Arena 2 on the Blue model
    }
    setFfRemaining(s.ffRemaining || 0); // drive the turbo button's skip-in-progress state
    // 5 round-result dots: blue / red / draw(purple) for played rounds, grey otherwise,
    // with a ring on the round currently in progress.
    const roundResults = s.roundResults || [];
    const roundTotal = r.total || roundResults.length || 5;
    let dotsHTML = '';
    for (let i = 0; i < roundTotal; i++) {
      const res = roundResults[i];
      const cls = res === 'blue' ? ' b' : res === 'red' ? ' r' : res === 'draw' ? ' d' : '';
      dotsHTML += `<i class="rdot${cls}${i === ri ? ' cur' : ''}"></i>`;
    }
    const roundEl = $('#rl-round');
    if (roundEl.innerHTML !== dotsHTML) roundEl.innerHTML = dotsHTML;
    $('#rl-arena').textContent = r.title || '';
    const tgt = s.targetEpisodes || 0;
    $('#rl-ep').textContent = tgt > 0
      ? `${s.episode.toLocaleString()} / ${tgt.toLocaleString()}`
      : s.episode.toLocaleString();
    // "Stop after N" reached: the trainer idles once episode >= target, so surface a
    // green completion pin (mirrors the DP convergence pin). DP rounds use their own.
    const trainDone = tgt > 0 && !DP_ALGOS.has(s.algoBlue) && s.episode >= tgt;
    const donePin = $('#rl-train-done-pin');
    if (donePin) {
      if (trainDone) $('#rl-train-done-pin .td-sub').textContent =
        `Reached ${tgt.toLocaleString()} episodes. Training has stopped; the models now play with their trained policies.`;
      donePin.hidden = !trainDone;
      panel.classList.toggle('has-train-done', trainDone);
    }
    const curriculum = s.curriculumEpisodes || 0;
    $('#rl-curriculum').hidden = curriculum <= 0 && ri !== 1;
    $('#rl-curriculum-val').textContent =
      `${(s.fullCourseEpisodes || 0).toLocaleString()} / ${curriculum.toLocaleString()}`;
    $('#rl-steps').textContent = s.totalSteps.toLocaleString();
    lastEps = { blue: s.epsilon, red: s.redEpsilon ?? lastEps.red };
    updateEps(); // Exploration ε follows the selected model (blue = you, red = CPU)
    $('#rl-len').textContent = s.avgEpisodeLen ? s.avgEpisodeLen.toFixed(0) : '-';
    const lr = s.lastReturn || { red: 0, blue: 0 };
    const sign = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
    $('#rl-ret').textContent = `${sign(lr.blue)} / ${sign(lr.red)}`;
    $('#rl-q').textContent = `${s.qStates.blue} / ${s.qStates.red}`;
  });

  // ---- Q inspector ----
  window.addEventListener('rl-qinspect', (e) => {
    const d = e.detail;
    if (!d || !d.q) { $('#rl-qinspect').innerHTML = '<p class="hint">No data for that tile yet.</p>'; return; }
    const lo = Math.min(...d.q, 0), hi = Math.max(...d.q, 0), span = hi - lo || 1;
    // star the action the agent WOULD take (best among EFFECTIVE actions), not just the
    // raw argmax - a higher-Q move that bumps a wall is blocked and shown dimmed
    const best = d.best;
    const ties = Array.isArray(d.ties) ? d.ties : [];
    const mask = d.mask || null;
    const actionNames = ACTION_NAMES;
    const actionOrder = lastRoundIndex === 0 ? PEACH_ACTION_ORDER : [0, 1, 2, 3];
    $('#rl-qinspect').innerHTML =
      `<div class="hint">Tile (${d.cell[0]}, ${d.cell[1]}) - ${d.agent === 'red' ? 'Red' : 'Blue'}</div>` +
      actionOrder.map((i, displayIndex) => {
        const q = d.q[i];
        const blk = mask && !mask[i];
        const mark = i === best ? ' ★' : (best == null && ties.includes(i) ? ' ◇' : '');
        return `<div class="qrow${blk ? ' blk' : ''}"><span>${actionNames[displayIndex]}${mark}${blk ? ' <span class="blktag">blocked</span>' : ''}</span>
          <span class="qbar"><i style="left:${((Math.min(q, 0) - lo) / span) * 100}%;
            width:${(Math.abs(q) / span) * 100}%"></i></span>
          <span>${q.toFixed(2)}</span></div>`;
      }).join('');
  });
}
