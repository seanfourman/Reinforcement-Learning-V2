# King vs Queen — a live self-play RL arena

Two agents (the **King** = red, the **Queen** = blue) start **untrained** and learn,
live and on-screen, to solve the **same** competitive task inside a fixed,
hand-designed 20×20 **castle**:

1. find **your** colored key, hidden in a **maze of furniture** inside your sealed
   bedroom (the arched door is locked until you hold it; the two bedrooms are sealed
   so colored keys can never be stolen),
2. leave through the door into the shared **dining hall**,
3. grab the single **gold key** — the only stealable one (step onto the holder to
   take it),
4. reach the north **escape gate** holding the gold key. **First one out wins.**

The castle is two mirrored, furnished bedrooms (bottom) — bookshelves, beds,
wardrobes, chests — opening through **arched wooden doors** into a grand **dining
hall** with a carpet runner, chandeliers and long tables.

The world also has learnable **mechanics**: **teleporter mirrors** (step on one,
warp to its twin), a **wall lever** that arms a **snare trap** (it flings whoever
steps on it — including you — back to spawn), **key-stealing** by contact, and a
**ladder + catwalk** that climbs *over* an arena wall as a shortcut.

The two models are **real Python reinforcement learning** running in a background
thread; the browser is a live viewer. Pure self-play — from each agent's point of
view the rival is just part of the world.

## Run

```sh
python serve.py
```

A local server starts, trains the two models live, and opens the game in your
browser. Keep the console window open. (Needs Python 3 + `gymnasium` + `numpy`;
`torch` only if you add the optional DQN agent.)

## Controls

| Input        | Action                                                             |
| ------------ | ----------------------------------------------------------------- |
| `R`          | **Reset** both models — they relearn from scratch on the same castle |
| `M`          | Open the medieval **panel**                                        |
| Mouse drag   | Pan the camera                                                     |
| WASD / arrows| Pan the camera                                                     |
| Scroll wheel | Zoom                                                               |

## The panel (M)

- **Algorithm** — switch between **Q-learning**, **SARSA**, **Expected-SARSA**, and
  **Monte-Carlo** (resets learning on the current world).
- **Speed slider** — slow (watch them walk) ↔ fast (thousands of iterations fly by,
  the heatmap fills in). Plus **play/pause**, **new world**, **reset**.
- **Training stats** — iteration (episode), total steps, **ε** (explore vs exploit),
  average episode length, learned-state counts.
- **Contest** — live win tally + recent win-rate bars.
- **Learned value map** — overlay each model's **V(s)** heatmap on the grid
  ("what has it learned about standing on each tile"). **Click a tile** to inspect
  the per-action **Q(s,·)**.

## How the RL concepts are captured

| Concept                     | Where                                                            |
| --------------------------- | --------------------------------------------------------------- |
| Gymnasium env               | `rl/env.py` subclasses `gymnasium.Env` (reset/step/spaces)      |
| Explore vs exploit          | ε-greedy with decaying ε (shown live in the panel)              |
| TD control                  | Q-learning (off-policy), SARSA (on-policy), Expected-SARSA       |
| Monte-Carlo control         | episode-return updates (`rl/agents.py`)                          |
| V & Q functions             | the value heatmap (V) + the click-a-tile Q inspector            |
| Reward shaping              | potential-based shaping makes the long key→gold→escape chain learnable |
| DQN / Dynamic Programming   | extension points (see `rl/agents.py`, the plan)                 |

## Code map

| File / folder        | What it does                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `serve.py`           | Live RL server: static host + training thread + JSON API           |
| `rl/worldgen.py`     | The FIXED hand-designed castle (furnished bedrooms, dining hall, furniture list, mechanics) |
| `rl/env.py`          | `GridWorld(gymnasium.Env)` — mechanics, rewards, shaping, observation |
| `rl/agents.py`       | Tabular agents: Q-learning, SARSA, Expected-SARSA, Monte-Carlo     |
| `rl/match.py`        | Live self-play loop, stats, value grids, thread-safe controls      |
| `rl/train.py`        | Offline CLI smoke-test (proves the agents actually learn)          |
| `src/main.js`        | Live poll client: builds the scene, drives the loop                |
| `src/architecture.js`| Plastered castle walls + stone columns (merged runs, not cubes)    |
| `src/furniture.js`   | Beds/wardrobes/bookshelves/chests/tables + a GLTF model hook       |
| `src/doors.js`       | Arched wooden bedroom doors (swing open on the key)               |
| `src/dressing.js`    | Carpet runner, chandeliers, rugs (the dining-hall feel)            |
| `src/live.js`        | The King/Queen/keys, driven by polled frames                       |
| `src/mechanics.js`   | Mirrors, levers, traps, ladders/catwalk (3D)                       |
| `src/panel.js`       | The medieval M-panel + controls                                    |
| `src/heatmap.js`     | The learned-value heatmap overlay                                  |
| `src/build.js`       | Castle shell + outside nature                                      |
| `vendor/three/`      | Bundled three.js (no package manager needed)                       |

## Swapping in real 3D models (the GLTF hook)

Furniture is procedural by default, but you can drop in real models: put a `.glb`
in `textures/models/` and register it in `src/furniture.js`
(`registerModel('bed', 'textures/models/bed.glb')`). If a model is registered it
loads via GLTFLoader and replaces that piece everywhere; otherwise the procedural
mesh is used. (Add `vendor/three/addons/loaders/GLTFLoader.js` for three r184 first.)

## API (for the curious)

```
GET  /api/snapshot          {worldVersion, frame, stats}     (browser polls ~30Hz)
GET  /api/world             {worldVersion, world}            (fetched once on load)
GET  /api/values?agent=red  value heatmap V(s) per tile
GET  /api/values?agent=red&cell=r,c   per-action Q for one tile
POST /api/control           {cmd: regenerate|reset|pause|play|speed|algo, ...}
```
