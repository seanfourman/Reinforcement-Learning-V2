# Rival Minds - a live self-play RL tournament

Two agents, **Red** and **Blue**, play the **same** task head-to-head while you
watch them learn (or plan) live and on-screen. It is a five-round tournament, and
each round pits two **rival algorithms** against each other in a themed arena:

| Round | Arena                         | Red vs Blue                          |
| ----- | ----------------------------- | ------------------------------------ |
| 1     | Peach's Castle                | **Value Iteration** vs **Policy Iteration** (Dynamic Programming: a stochastic maze race) |
| 2     | New Donk City                 | **Every-visit MC** vs **First-visit MC** (Monte-Carlo) |
| 3     | Fossil Falls                  | **SARSA** vs **Q-Learning** (on-policy vs off-policy TD) |
| 4     | Ruined Kingdom                | **DQN** vs **Double-DQN** (continuous, function approximation) |
| 5     | Tostarena                     | **Actor-Critic** vs **PPO** (Policy Gradient) |

The two models are **real Python reinforcement learning** running in a background
thread; the browser is a live 3D viewer that polls the match and renders it. Pure
self-play - from each agent's point of view the rival is just part of the world.

You pick the two characters in the start menu: **Blue is you**, **Red is the CPU**
(the CPU's strength scales with the character's tier). Red always plays the red half
of each round's matchup above.

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
| `N`           | Open the **Training Control** panel               |
| `M`           | Open the **CPU** panel                            |
| Mouse drag    | Pan the camera                                    |
| WASD / arrows | Pan the camera                                    |
| Scroll wheel  | Zoom                                              |

## The Training Control panel (N)

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
- **Episode replay** - scrub the fastest winning episode step by step.
- **Fullscreen** - the button top-right expands the panel into a full dashboard.

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
| `rl/match.py`        | Live self-play loop, stats, value grids, thread-safe controls |
| `rl/worlds/`         | Per-round world layouts + the round/algorithm registry        |
| `src/main.js`        | Live poll client: builds the scene, drives the render loop    |
| `src/live.js`        | The two board agents, driven by polled frames                 |
| `src/themes/`        | Per-round arena geometry, palette, sky and camera             |
| `src/startmenu.js`   | Character select + cinematic start menu                       |
| `src/panel.js`       | The Training Control panel (N)                                 |
| `src/cpupanel.js`    | The CPU panel (M)                                             |
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
GET  /api/replay            the fastest winning episode, for the replay scrubber
POST /api/control           {cmd: play|pause|speed|reset|regenerate|setParams|
                             cpuTier|prevRound|nextRound|setRound|sideAlgo, ...}
```
