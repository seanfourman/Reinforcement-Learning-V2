# Rival Minds - a live reinforcement-learning tournament

Two agents, **Red** and **Blue**, play the **same** task head-to-head while you
watch them learn (or plan) live and on-screen. It is a five-round tournament, and
each round pits two **rival algorithms** against each other in a themed arena.
The table shows the defaults; the start menu accepts any algorithm from that
round's compatible family:

| Round | Arena                         | Red vs Blue                          |
| ----- | ----------------------------- | ------------------------------------ |
| 1     | Peach's Castle                | **Value Iteration** vs **Policy Iteration** (Dynamic Programming: a stochastic maze race) |
| 2     | New Donk City                 | **Every-visit MC** vs **First-visit MC** (Monte-Carlo) |
| 3     | Fossil Falls                  | **SARSA** vs **Q-Learning** (on-policy vs off-policy TD) |
| 4     | Ruined Kingdom                | **DQN** vs **Double-DQN** (continuous, function approximation) |
| 5     | Tostarena                     | **Actor-Critic** vs **PPO** (Policy Gradient) |

The two models are **real Python reinforcement learning** running in a background
thread; the browser is a live 3D viewer that polls the match and renders it. Each
side owns an independent model. In New Donk City they learn mirrored copies of
the same seeded course and do not observe the rival, keeping the tabular state
Markov and the competition fair.

You pick the two characters in the start menu: **Blue is you**, **Red is the CPU**
(the CPU's arena-specific hyperparameters scale with the character's strength).
Red uses the CPU character's compatible algorithm; Blue uses your selected
algorithm.

## The five rooms - states, rewards, and the hyperparameters that solve them

Every room is a small **escape room**: reach its single terminal (the goal / final
capture) to advance. The reward always includes a **per-step time cost**, so a faster
solution earns a higher return - solving quickly *is* the objective. Difficulty rises
room to room (bigger state space, more actions, dynamic hazards). The "tuned" values
below are the Blue defaults the app ships with (they solve each room reliably); every
one is live-editable from the Control panel (`C`).

### Room 1 - Peach's Castle (Dynamic Programming: Value Iteration vs Policy Iteration)

Model **known**, so we *plan* with the Bellman equations instead of sampling.

- **State (|S| = 23,488):** `(your tile x collected-mask x status)` = 225 board cells x
  a 4-bit mask of which of your coins / Mystery Blocks you have claimed x an 8-value
  power-up / frozen countdown. It is a genuine **stochastic MDP**: **ice tiles** slip
  (30% chance a move deflects sideways) and Mystery Blocks give a random Ghost/Freeze
  outcome, so the transition `P(s'|s,a)` is probabilistic and known to the planner.
- **Actions (4):** North / South / West / East.
- **Rewards:** step `-0.01`; coin `+0.2`; Mystery-Block bonus `+0.15`; reach the Power
  Moon `+1.0`; lose `-1.0`.
- **Terminal:** first to the Power Moon (a dead heat draws).
- **Tuned params (DP has no alpha/epsilon):** discount **gamma = 0.98**, convergence
  threshold **theta = 1e-5**, sweep cap **2000**, planning speed **0.6** Bellman sweeps
  per tick, ice slip **30%**. VI and PI both converge to the same optimal V\*; the race
  is which planner gets a usable partial policy first.

### Room 2 - New Donk City (Monte-Carlo control: First-visit vs Every-visit)

Model **unknown**; the agent learns only from **complete-episode returns** (no
bootstrapping). A creative extra beyond the brief's SARSA/Q pair - Monte Carlo completes
the Sutton and Barto progression, and SARSA and Q-Learning both appear next door in Room 3.

- **State (|S| = 2,088):** `(your tile x 3-bit tomato mask)` = 261 reachable cells x
  which of your 3 tomatoes you already hold. The mask keeps the state **Markov** (the
  return-to-goal depends on what you still need to collect). **Puddles** add a 12% skid.
- **Actions (4):** North / South / West / East.
- **Rewards:** step `-0.01`; collect a tomato (first time) `+0.35`; gather all 3 + reach
  the goal `+1.0`; eaten in a plant zone `-1.0`.
- **Terminal:** hold all 3 tomatoes, then reach the top goal.
- **Tuned params:** **alpha = 0.19**, **gamma = 0.98**, epsilon **0.90 -> 0.05** decayed
  over **7,200** episodes. MC needs *sustained* exploration because an update only lands
  after a long full-course return - hence the long decay.

### Room 3 - Fossil Falls (Temporal-Difference control: SARSA vs Q-Learning)

Model **unknown**, learned online with **one-step TD** - **SARSA** (on-policy) races
**Q-Learning** (off-policy) head-to-head, so the brief's Room-2 (SARSA) and Room-3
(Q-Learning) requirements are both demonstrated here.

- **State (|S| = 9,840):** `(your tile x Goomba patrol phase x rival flag x secret-door
  flag)` = 205 cells x the 4-step patrol phase the Goombas cycle on x a compact
  ahead/level/behind + cage-ready rival flag (6) x whether your pressure-plate door is
  open. A **wet-cell skid** (tunable, ~20%) is the variance that lets a racer fall behind.
- **Actions (5):** North / South / West / East / **Stay** (wait out a Goomba).
- **Rewards:** step `-0.01`; reach the goal first `+1.0`; grab your cage (freeze the
  rival) `+0.2`; caught by a Goomba `-1.0`; rival finishes first `-1.0`.
- **Terminal:** first to the shared exit at top-centre.
- **Tuned params:** **alpha = 0.20**, **gamma = 0.98**, epsilon **1.0 -> 0.05** over
  **3,000** episodes.

### Room 4 - Ruined Kingdom (Deep RL / function approximation: DQN vs Double-DQN)

Model **unknown**, state **continuous**, so a neural network approximates Q. Built to
the brief's spec: a **10 x 10 metre** room, a **0.02 s** decision step, and **discrete
velocity** on each axis (`Vx, Vy in {-1, 0, 1}`, no momentum). Movement stability comes
from **action-repeat** (a chosen heading is held for 4 steps) rather than momentum.

- **State (55-vector):** 5 own kinematics (position x/z, velocity x/z, rim clearance) +
  5 own effect timers (speed / shield / slow / freeze / post-hit mercy) + the 3 nearest
  Banzai Bills x 8 (present, relative x/z, velocity x/z, aimed-at-me, time-to-impact,
  predicted miss) + the 3 nearest pickups x 7 (present, relative x/z, 4-way type one-hot).
- **Actions (9):** 8 compass directions + stay.
- **Rewards:** stay alive `+0.2 / s`; dodge a Bill aimed at you `+0.15`; shift a closing
  missile's projected miss `+/-0.25 / s`; lose a heart `-2.0`; rival loses its last heart
  `+0.05`.
- **Terminal:** each racer has 3 hearts; a hit costs one - last one standing wins.
- **Tuned params:** learning rate **alpha = 0.30** (Adam lr), **gamma = 0.99**, epsilon
  **1.0 -> 0.05** over **2,500** episodes; network **128 x 2**, minibatch **64**, replay
  buffer **50,000**, **500**-step warmup, target-net sync every **500** steps, **3-step**
  returns, **action-repeat 4**.

### Room 5 - Dry Dry Desert (Policy Gradient: Actor-Critic vs PPO, also REINFORCE)

Model **unknown**, and the policy itself is a network (policy-*based*, not value-based) -
it **samples** its actions, so there is no epsilon; exploration comes from an **entropy
bonus**. This is the brief's optional obstacle room: **Bowser's Airship** hurls dynamic
objects the racers must **dodge**, and the observation exposes a **tunable sight range**
(how many metres ahead, centre-to-centre, an incoming object is seen). A fresh random
layout can be generated any time ("New world") to test the learned policy.

- **State (66-vector):** 4 own kinematics + 4 opponent terms (rival relative pos/vel) +
  5 flag terms (relative x/z + free / you-carry / rival-carries) + 4 base vectors +
  4 status terms (carrying, both stun timers, capture lead) + 2 crates x3 + a 5-way
  held-weapon one-hot + rival-armed flag + 2 shells x5 + 2 traps x4 + **3 thrown Bowser
  objects x5 within the sight range** (present, relative x/z, velocity x/z) - so it can
  dodge them.
- **Actions (10):** 8 compass thrusts + coast + **USE** (fire the held weapon).
- **Rewards:** grab the flag `+0.15`; steal it (tag) `+0.40`; lose it `-0.40`; capture at
  your base `+1.0`; concede a capture `-0.30`; smash a crate `+0.10`; chain-yank `+0.08`;
  shell hit `+0.30`; banana/oil snare `+0.25`; get stunned `-0.05`; win the round `+/-2.0`;
  step `-0.002`.
- **Terminal:** first to **3 captures** (else most captures at timeout).
- **Tuned params:** learning rate **alpha = 0.20**, **gamma = 0.98**, entropy bonus
  **0.01**, GAE **lambda = 0.95**, value-loss weight **0.5**, rollout **horizon** (64 for
  Actor-Critic, 512 for PPO), PPO **clip = 0.2**, PPO **epochs = 4**, minibatch **128**,
  network **128**. Decision step **0.05 s**; object sight range **6 m** (tunable).

The CPU (Red) reads the same knobs, but its values come from the chosen character's
**difficulty tier** (10 characters, easy -> hard): a weaker character learns slower
(lower alpha), plans less far (lower gamma), and stays more random (higher epsilon, or
higher entropy in Room 5); a stronger one converges fast and plays near-optimally.

## Run

```sh
python serve.py
```

A local server starts, runs the two models live, and opens the game in your
browser. Keep the console window open. (Needs Python 3 + `gymnasium` + `numpy`;
`torch` only for the DQN rounds.)

## Controls

| Input         | Action                                            |
| ------------- | ------------------------------------------------- |
| `R`           | **Reset** both models (relearn from scratch)      |
| `C`           | Open/close the shared **Control** panel           |
| Mouse drag    | Pan the camera                                    |
| WASD / arrows | Pan the camera                                    |
| Scroll wheel  | Zoom                                              |

## The Control panel (C)

- **Playback** - play/pause, speed (slow = watch them walk, fast = thousands of
  iterations fly by), reset, new world, and prev/next round.
- **Hyperparameters** - discount γ (all rounds), plus learning rate α and the ε
  exploration schedule on the learning rounds. Blue sliders tune your model.
- **Training stats** - episode, total steps, ε, average episode length, returns,
  learned-state counts.
- **DP convergence** (Round 1) - per-sweep Bellman residual and mean state value for
  Value Iteration vs Policy Iteration, with a tunable convergence θ.
- **Learning curves** - return, episode length, ε, and win-rate over time.
- **Contest** - live win tally + recent win-rate bars.
- **Value map** - overlay each model's **V(s)** heatmap on the grid; click a tile to
  inspect the per-action **Q(s,·)**.
- **Episode replay** - browse each model's top 30 complete winning runs. Arena 2
  replays use the policy, value, Q, and visit context frozen with that episode.
The model selector in the panel header switches between your Blue model and the
CPU's locked Red profile.

## How the RL concepts are captured

| Concept                   | Where                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Gymnasium env             | `rl/env.py` / `rl/continuous.py` subclass `gymnasium.Env`   |
| Dynamic Programming       | Value Iteration + Policy Iteration (`rl/dp.py`, Round 1)     |
| TD control                | Q-Learning (off-policy), SARSA (on-policy), Expected-SARSA   |
| Monte-Carlo control       | episode-return updates                                      |
| Function approximation    | DQN / Double-DQN / Dueling-DQN (`rl/dqn.py`, Round 4)        |
| Policy gradient           | Actor-Critic / PPO / REINFORCE (`rl/pg.py`, Round 5)         |
| Explore vs exploit        | ε-greedy with a decaying ε (shown live in the panel)        |
| V & Q functions           | the value heatmap (V) + the click-a-tile Q inspector        |

## Code map

| File / folder        | What it does                                                  |
| -------------------- | ------------------------------------------------------------ |
| `serve.py`           | Live RL server: static host + training thread + JSON API      |
| `rl/env.py`          | `GridWorld(gymnasium.Env)` for the grid rounds                |
| `rl/continuous.py`   | `ContinuousArena` for the Round 4/5 continuous arenas         |
| `rl/dp.py`           | Value Iteration + Policy Iteration planners (Round 1)         |
| `rl/agents.py`       | Tabular agents: Q-Learning, SARSA, Expected-SARSA, Monte-Carlo |
| `rl/dqn.py`          | The DQN family: DQN / Double-DQN / Dueling-DQN (Round 4)      |
| `rl/pg.py`           | Policy Gradient: Actor-Critic / PPO / REINFORCE (Round 5)     |
| `rl/match.py`        | Live tournament loop, stats, value grids, thread-safe controls |
| `rl/worlds/`         | Per-round world layouts + the round/algorithm registry        |
| `src/main.js`        | Live poll client: builds the scene, drives the render loop    |
| `src/live.js`        | The two board agents, driven by polled frames                 |
| `src/themes/`        | Per-round arena geometry, palette, sky and camera             |
| `src/startmenu.js`   | Character select + cinematic start menu                       |
| `src/panel.js`       | The shared model/control panel (C)                             |
| `src/graphs.js`      | Learning-curve / DP-convergence charts + episode replay       |
| `src/heatmap.js`     | The learned-value heatmap overlay                             |
| `vendor/three/`      | Bundled three.js (no package manager needed)                  |

## API (for the curious)

```
GET  /api/snapshot          {worldVersion, frame, stats}   (browser polls ~30Hz)
GET  /api/world             {worldVersion, world}          (fetched on each round)
GET  /api/worlds            every round's world (prebuilt during the menu)
GET  /api/values?agent=red  value heatmap V(s) per tile
GET  /api/values?agent=red&cell=r,c   per-action Q for one tile
GET  /api/dp?agent=red      Round 1 DP convergence trace (per-sweep δ + mean V)
GET  /api/replays           top-30 complete winning runs for one model
GET  /api/replay            one replay by stable episode identity
POST /api/control           {cmd: play|pause|speed|reset|regenerate|setParams|
                             cpuTier|prevRound|nextRound|setRound|sideAlgo, ...}
```
