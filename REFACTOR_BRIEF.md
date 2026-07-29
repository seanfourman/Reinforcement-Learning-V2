# Python Refactor Brief (for Fable)

**Mission:** reorganize the PYTHON side of this working, 5-round RL tournament game into
clean, tidy, textbook-quality code that a student can present and navigate instantly.
Someone should be able to ask "how many layers does the DQN have?" and the answer is
"open `arenas/r4_ruined_kingdom/dqn.py`," found in seconds.

**This is a RESTRUCTURE, not a rewrite.** Behavior, tuning, learning, visuals, and the
browser API must stay byte-for-byte identical. If the game plays even slightly differently
after you finish, you have failed. You are only reorganizing FILES and rewiring IMPORTS.

---

## 0. Read this whole file, then read the actual code before moving anything.

The game is served by `game/serve.py` (a plain Python HTTP server) which runs the two
models live in a background thread and streams the match to the browser over a small JSON
API. The browser (`game/src/**`, do not touch) is a pure viewer that polls those endpoints.

Start `python game/serve.py`, open it, and watch all 5 rounds train. **That running game is
your BASELINE.** You compare against it constantly.

---

## 1. Hard constraints (do not violate)

- **Standard library only** for anything new, plus the deps already in use (`numpy`,
  `gymnasium`, and `torch` which is imported LAZILY, only for the deep rounds 4-5). Do NOT
  add dependencies. Do NOT install a linter/formatter into the project.
- **The game must keep running the entire time.** Verify after every meaningful step, never
  only at the end.
- **The `serve.py` <-> browser JSON API is a hard contract.** You may move/rename Python
  files and rewire imports freely, but the API routes AND the exact JSON shapes they return
  must not change. Change a key or a route and the JS breaks silently until the game is
  visibly broken. The routes are: `/api/snapshot`, `/api/world`, `/api/worlds`,
  `/api/values` (with `mode=visits|q|policy` + `cell=r,c`), `/api/vstats`, `/api/mdp`,
  `/api/field`, `/api/replay`, `/api/replays`, `/api/dp`, and POST `/api/control`.
  They map to `match.*` methods (`snapshot`, `world_json`, `all_worlds`, `value_grid`,
  `q_grid`, `policy_grid`, `q_at`, `visit_grid`, `visit_stats`, `mdp_spec`, `replay`,
  `replays_index`, `dp_report`, plus the control handlers). Keep every one of those method
  names and return shapes identical.
- **Do NOT touch:** the JavaScript (`game/src/**`), the assets (`game/assets/**`, which are
  Git LFS), `game/index.html`, or the game's behavior/tuning. No changing hyperparameters,
  CPU ladders, reward values, network sizes, epsilon schedules, seeds, etc. Only the Python
  file ORGANIZATION changes.
- **No em dashes** anywhere in comments/docs. Use commas, colons, parentheses, hyphens.

---

## 2. Before you move a single file

1. **Confirm nothing else is editing this repo.** There has been a concurrent process
   committing and pushing. If files change under you mid-refactor, STOP and tell the user.
2. **Ensure the working game is committed and pushed** (a clean revert point). If there are
   uncommitted changes, surface them before you start. Moving files is only safe when you
   can `git reset --hard` back to a running version.
3. **Launch and verify the baseline:** `python game/serve.py`, open the browser, confirm all
   5 rounds render, train, switch algorithms, and the panel/replays work. Write down what
   "correct" looks like so you can diff against it later.

---

## 3. The golden rule: MOVE and EXTRACT, never DUPLICATE

The algorithms are already one-per-arena, so putting them in arena folders is a MOVE, not a
copy:

| Round | Arena             | Algorithms (Red vs Blue defaults)              | Currently in |
|-------|-------------------|------------------------------------------------|--------------|
| R1    | Peach's Castle    | Value Iteration vs Policy Iteration (DP)       | `dp.py`      |
| R2    | New Donk City     | Every-visit MC vs First-visit MC               | `agents.py`  |
| R3    | Fossil Falls      | SARSA vs Q-Learning (+ Expected-SARSA)         | `agents.py`  |
| R4    | Ruined Kingdom    | DQN vs Double-DQN (+ Dueling-DQN)              | `dqn.py`     |
| R5    | Tostarena         | Actor-Critic vs PPO (+ REINFORCE)             | `pg.py`      |

**What is genuinely shared stays in ONE place and is never copied:**
- the base tabular Agent (epsilon-greedy action selection + the Q-table) that MC and TD both
  build on,
- the base PG agent and base DQN agent that the variants (Double/Dueling, AC/PPO) extend,
- the grid environment ENGINE (movement, the step loop, observation plumbing) shared by
  R1/R2/R3,
- the continuous-arena ENGINE shared by R4/R5,
- the tournament driver / mediator (`match.py`), `worldgen`, the grid primitives, and the
  round registry.

**`env.py` and `continuous.py` are the hard part.** They are big files that branch internally
by round (R1 "rich" vs R2 hazards vs R3 goombas; R4 missiles vs R5 CTF). Do NOT copy them per
arena. EXTRACT each round's specific mechanics into that arena's file and keep the shared
engine generic in the shared layer. Design clean seams (hooks/overrides) so an arena adds only
its own logic. This extraction is the real work and the main risk; go slow and verify.

Why not just duplicate everything so nothing is shared? Because it makes your two other goals
worse: (a) "make sure everything actually works" gets harder, since one fix to shared logic
then has to be repeated in N copies and re-tested in N arenas (this is how "R2 works, R3
silently doesn't" bugs appear); and (b) "the best code you ever saw" is the opposite of
copy-pasted infrastructure. A shared base with per-arena specializations also tells the RL
story you are presenting: all tabular methods share value estimation and differ only in the
update rule, which IS the DP -> MC -> TD -> DQN -> PG arc.

---

## 4. Target layout (under `game/rl/`)

This is a strong default. Adapt where a real seam suggests otherwise, but keep the spirit.

```
game/rl/
  __init__.py
  core/                          # shared, NOT arena-specific  (NOTE: not "global" - reserved word)
    __init__.py
    base_agent.py                # base tabular agent: epsilon-greedy + Q-table
    grid_env.py                  # shared grid engine (movement + step loop) for R1/R2/R3
    continuous_arena.py          # shared continuous physics engine for R4/R5 (split if >500 lines)
    worldgen.py                  # world-generation entry + grid primitives (WALL/FLOOR/...)
    tournament.py                # the Match driver + browser mediator (was match.py)
    replays.py                   # replay + milestone capture (split out if tournament.py > 500 lines)
    registry.py                  # round_id -> module map, ROUND_ALGOS, ALGO_LABELS
  arenas/
    __init__.py
    r1_peach_castle/
      __init__.py
      world.py                   # was worlds/peach.py
      env.py                     # R1-specific mechanics (coins, ice/slip, Mystery Blocks)
      value_iteration.py
      policy_iteration.py
    r2_new_donk_city/
      __init__.py
      world.py                   # was worlds/city.py
      env.py                     # R2-specific (plants, spikes, warp pipes, stars)
      monte_carlo.py
      first_visit_mc.py
    r3_fossil_falls/
      __init__.py
      world.py                   # was worlds/fossilfalls.py
      env.py                     # R3-specific (goombas, cage, wet cells, pressure plates)
      sarsa.py
      qlearning.py
      expected_sarsa.py
    r4_ruined_kingdom/
      __init__.py
      world.py                   # was worlds/ruined.py
      arena.py                   # R4-specific continuous mechanics (Banzai Bills, hearts, pickups)
      dqn.py
      double_dqn.py
      dueling_dqn.py
    r5_tostarena/
      __init__.py
      world.py                   # was worlds/tostarena.py
      arena.py                   # R5-specific continuous mechanics (CTF, weapons, crates)
      reinforce.py
      actor_critic.py
      ppo.py
```

### Two Python gotchas the folder names hit head-on
- **Package folders must be valid Python identifiers.** `R4 - Ruined Kingdom` is NOT importable
  (spaces, dash, and apostrophe break `import`). Use snake_case like `r4_ruined_kingdom/` with
  an `__init__.py`. Keep the pretty display name ("Ruined Kingdom") in a module constant or
  docstring so the game still shows it. Same for files: `double_dqn.py`, not `dual-dqn.py`.
- **`global` is a reserved keyword**, so you cannot name a package `global/`. Use `core/`
  (or `shared/`).

---

## 5. Per-file rules

- **No file over ~500 lines.** If a module is bigger, split it by concern into files with
  obvious names.
- **Every filename answers "what's in here?" at a glance:** `base_agent.py`, `dqn.py`,
  `value_iteration.py`, `grid_env.py`, `tournament.py`.
- **A short module docstring at the top of every file:** what it is, which round/arena it
  serves, and how it fits the whole.
- **A comment or docstring before every class and function,** and before any non-obvious
  block, explaining WHAT it does and WHY, not restating the code line by line.
- **Order each file for presentation:** module docstring, imports, constants, base/shared
  class, then the specific implementations, then the factory/registry at the bottom. Reading
  top to bottom should read like a short lecture.
- **Remove dead code as you go:** unused functions, unreachable branches, commented-out
  blocks, dormant/abandoned code paths (there are some, e.g. old cliff-crossing paths).

---

## 6. The mediator: keep serve.py <-> browser working

`serve.py` does `sys.path.insert(0, game/rl)` then `from match import Match`, and routes HTTP
to `match.*`. When you move files you MUST rewire, in this order of blast radius:
1. `serve.py`'s `sys.path` and `from match import Match` (now `from core.tournament import Match`
   or similar).
2. Every internal import across the moved modules (`from env import ...`,
   `from continuous import ...`, `import worldgen`, `from agents import ...`, the DP/DQN/PG
   factories, etc.).
3. The round registry (`ROUND_MODULES`, `ROUND_ALGOS`, `make_world`, `round_algos`).

After rewiring, the API routes and the exact JSON returned by every `match.*` method listed in
section 1 must be identical. The JS is untouched, so if a shape drifts the game breaks.

---

## 7. Verification (prove it, do not assume)

Run these after each step and again at the very end:
- `python -c "import ..."` for every module: no broken imports.
- Construct and tick all five rounds with no error:
  `for r in 1..5: Match(round_id=r).tick()`.
- Start `serve.py`, hit each API route, and confirm the JSON shape matches the baseline
  (compare a `/api/mdp`, `/api/snapshot`, `/api/world` before and after).
- Open the game: all 5 rounds render and train, algorithm switching works, every panel tab
  works, replays and milestones work.
- Sanity-check behavior against the baseline: same tuning, same learning speed, same visuals.
  A refactor that changes behavior is a bug, not an improvement.
- Note: `serve.py` caches bytecode, so RESTART it after editing any `rl/*.py`, or you will test
  stale code.

---

## 8. What NOT to do

- Do not change any game logic, values, tuning, seeds, or the API.
- Do not touch the JavaScript, the assets, or `index.html`.
- Do not add dependencies.
- Do not duplicate the engine (`env`/`continuous`/base classes). Extract, do not copy.
- Do not "improve" or retune the algorithms while reorganizing. Reorganize only. If you spot a
  real bug, note it and ask before changing behavior.

---

## 9. Current module map (your starting point, in `game/rl/`)

- `env.py` - the grid environment for R1/R2/R3. Branches internally: `rich` (R1: coins, ice,
  Mystery Blocks), `hazardous` + `star_mode` (R2: plants, spikes, pipes, stars), `goomba_mode`
  (R3: goombas, cage, wet cells, pressure plates). SPLIT: shared engine -> `core/grid_env.py`,
  per-round logic -> each arena's `env.py`.
- `continuous.py` - the continuous arena for R4 (`missile_game`) and R5 (`ctf_game`). SPLIT:
  shared physics -> `core/continuous_arena.py`, R4 vs R5 mechanics -> each arena's `arena.py`.
- `match.py` - the tournament driver AND the browser mediator: `mdp_spec`, `snapshot`, the
  value/q/policy/visit grids, `replay`/`replays_index`, milestones, CPU ladders
  (`RED_MODELS`, `R3_LADDER`, `R4_LADDER`, `R5_LADDER`, `red_params`, `blue_params`), award
  ceremony. This is the heart; move to `core/tournament.py` (+ maybe `core/replays.py`).
- `agents.py` - tabular algorithms: `QLearning`, `Sarsa`, `ExpectedSarsa` (R3), `MonteCarlo`,
  `FirstVisitMonteCarlo` (R2), a base `Agent`, the `ALGORITHMS` registry, `make_agent`. SPLIT:
  base -> `core/base_agent.py`, MC -> R2, TD -> R3. Keep a registry that maps algo name ->
  class (the JS/API selects algorithms by these string names, so the names must not change).
- `dp.py` - `ValueIteration`, `PolicyIteration`, `make_dp` (R1). Move to R1.
- `dqn.py` - `DQNAgent`, `DoubleDQNAgent`, `DuelingDQNAgent`, `make_dqn` (R4). Move to R4.
- `pg.py` - base `PGAgent`, `REINFORCE`, `ActorCritic`, `PPO`, `make_pg` (R5). Move to R5.
- `worldgen.py` - re-export shim so `import worldgen` keeps working; sits on `worlds/grid.py`.
- `worlds/__init__.py` - `ROUND_MODULES`, `ROUND_ALGOS`, `ALGO_LABELS`, `make_world`. Becomes
  the round `registry.py`.
- `worlds/{peach,city,fossilfalls,ruined,tostarena}.py` - the world generators. Move each to
  its arena's `world.py`.
- `worlds/grid.py` - shared grid `World` primitives (`WALL`/`FLOOR`/spawns/`validate`). Move to
  `core/`.

Keep the algorithm string names (`value_iteration`, `policy_iteration`, `monte_carlo`,
`first_visit_mc`, `sarsa`, `qlearning`, `expected_sarsa`, `dqn`, `double_dqn`, `dueling_dqn`,
`reinforce`, `actor_critic`, `ppo`) EXACTLY as they are: the browser selects algorithms by
these strings through `/api/control`.

---

## 10. Suggested order of work (incremental, always-green)

1. Baseline: confirm the game runs, commit/push a revert point.
2. Move the leaf algorithm files first (they have the fewest dependents): `dp.py` -> R1,
   `dqn.py` -> R4, `pg.py` -> R5, split `agents.py` into R2 (MC) + R3 (TD) + `core/base_agent.py`.
   Rewire imports + the registry. Verify all 5 rounds tick after each move.
3. Move the world files into their arenas; update `make_world`/registry. Verify.
4. Split `env.py` (shared engine to `core/`, per-round logic to arenas). This is the delicate
   one; do it one round at a time and verify the game after each.
5. Split `continuous.py` the same way (R4, then R5).
6. Move `match.py` -> `core/tournament.py` (+ `replays.py` if needed), rewire `serve.py`. Verify
   the full game + every API route.
7. Final pass: file ordering, docstrings/comments before every function, sub-500-line splits,
   dead-code removal. Verify one last time end to end.

Green after every numbered step. If a step goes red and you cannot fix it quickly, revert that
step rather than piling on.

---

## 11. Documentation deliverables (do these AFTER the refactor is green and verified)

These are graded deliverables for the user's professor. Write them so that a reader who has
NEVER studied reinforcement learning finishes understanding every arena completely. The user
has said plainly: "I need to know and explain LITERALLY everything in this code, including what
DQN, PPO, Actor-Critic actually do." Take that literally. Explain from zero.

Put every doc somewhere TRACKED. Repo root is fine, or a `documentation/` folder. Do NOT put
them under `/docs/` - that path is gitignored and would not ship.

### 11a. README.md - per-arena states, rewards, and OPTIMAL parameters (the formal requirement)

The assignment (in Hebrew) requires:

> יש לצרף readme שמסביר בכל חדר את המבנה של המצבים והתקבולים ואת הפרמטרים שהתאימו לפתרון
> הבעיה בצורה האופטימלית.

Meaning: a README that explains, FOR EACH ROOM (arena): the structure of the STATES (מצבים),
the REWARDS (תקבולים), and the PARAMETERS that solved the problem OPTIMALLY.

So for every arena, the README must give:
- **The state structure** - what one state/observation is, and the full state space.
- **The rewards** - every reward and penalty term and what it is for.
- **The parameters that solve it optimally**, which means BOTH of these:
  1. **A table of all 10 CPU characters** (Mario level 0 .. Parabones level 9) with their exact
     hyperparameters for that arena. Pull them from the ladders in the tournament code
     (`RED_MODELS` plus the per-round `r2` block / `R3_LADDER` / `R4_LADDER` / `R5_LADDER`),
     and the player's Blue default.
  2. **The single BEST hyperparameter set for that specific world - one that is even stronger
     than Parabones (level 9), the "best best best" set.** Do NOT guess it. RUN a real
     hyperparameter search: train candidate settings, measure a concrete score (win-rate vs a
     fixed opponent, convergence speed, and final reward or survival time), pick the winner,
     and VERIFY with numbers that it beats Parabones' settings. State the method and the
     measured results. If Parabones is already at the performance ceiling for that world, prove
     it with the numbers and say so explicitly.
- **One sentence per parameter explaining WHY that value is optimal for this world**, tied to
  how the algorithm and the game work. Example: "gamma is near 1 because the only real reward
  arrives at the goal, so the agent has to value far-future reward to plan the whole route."

Note: the tabular arenas (R1/R2/R3) train in seconds, so full sweeps are cheap. R4/R5 use
PyTorch and train slower, so budget for that; if a full sweep is impractical, document the best
you found, the search you ran, and the reasoning, rather than inventing numbers.

### 11b. Bilingual full guide - English AND Hebrew (two mirrored files)

Write `GUIDE_EN.md` and `GUIDE_HE.md` with the SAME content, one per language. For EACH arena,
starting from zero and assuming no RL background:
- **The game:** the rules, the goal, how a match is won or lost.
- **The states:** what the agent perceives, in plain words first, then precisely.
- **The rewards:** what earns reward or penalty, and why it is shaped that way.
- **The algorithms, taught from nothing:** for every algorithm in that arena, first the plain
  intuition (what it IS and how it learns), THEN the mechanism:
  - R1 Value Iteration and Policy Iteration (Dynamic Programming): the Bellman equation, why it
    needs a known model of the world, and how VI differs from PI.
  - R2 Monte Carlo: learning from complete-episode returns; every-visit vs first-visit.
  - R3 SARSA and Q-Learning (Temporal Difference): the TD update, and on-policy vs off-policy.
  - R4 DQN, Double-DQN, Dueling-DQN: a neural network estimating Q-values; experience replay;
    the target network; what Double fixes (overestimated values); what Dueling separates (state
    value vs action advantage); and the actual network shape (how many layers and neurons, and
    why).
  - R5 REINFORCE, Actor-Critic, PPO (policy gradient): learning the policy directly; what the
    actor and the critic each do; the advantage and GAE; and PPO's clipped objective and why it
    keeps training stable.
- **Every hyperparameter the arena exposes,** what it does, and a sensible range: alpha, gamma,
  the epsilon schedule, DP theta and max sweeps and planning speed, the DQN knobs (hidden
  width, layers, batch, replay buffer, warmup, target-sync, n-step), the PG knobs (hidden
  width, entropy, GAE lambda, value-loss weight, rollout horizon, PPO clip, PPO epochs), and
  each world/game knob for that round.

Success test: the user can read `GUIDE_HE.md` and then teach the entire project to someone else.

### 11c. CODE_MAP.md - professor question to exact code location

A lookup table so any question a professor asks maps to a precise spot in the code. One row per
concept, columns: **Question / concept | File | Class or function**. Cover at least: the state
space, the action space, the reward function, epsilon-greedy exploration, the Bellman update
(VI/PI), the Monte-Carlo return update, the SARSA vs Q-Learning update, experience replay, the
target network, the DQN network architecture (layers and width), Double-DQN's action selection,
the Dueling value/advantage split, the policy network, the advantage / GAE, the PPO clip, the
discount gamma, on-policy vs off-policy, how the CPU difficulty ladder works, and how the
browser talks to Python (the serve.py API mediator).

Example row: `How many layers does the DQN network have? | arenas/r4_ruined_kingdom/dqn.py |
the network class __init__`.

Every file path and symbol in CODE_MAP.md must point at the NEW structure and must actually
exist. Verify each one after the refactor; a stale pointer is worse than none.

### 11d. Keep it all true

These docs describe the code, so they are only correct if the code is. Write them LAST, after
the refactor is green, and re-check every path, class name, parameter value, and number against
the final code before you call it done.

---

## 12. Practical gotchas (do not learn these the hard way)

- **PyTorch + Python version.** R4 and R5 use PyTorch (imported lazily; the tabular rounds do
  not need it). There is a known version sensitivity on this machine: torch works on one Python
  and not another (3.10 vs 3.14 has bitten this project before). BEFORE you verify R4/R5 or run
  the 11a hyperparameter search, confirm WHICH interpreter has a working `import torch` and use
  that one. If torch is missing you will see R4/R5 fail the instant their agents are built, and
  you will wrongly blame your refactor. Ask the user which Python to use if it is unclear.
- **Prove behavior is unchanged with a FIXED SEED.** The strongest check that a move changed
  nothing: run the SAME seeded scenario before and after and compare exact numbers. E.g.
  `Match(seed=7, round_id=r)` ticked N times must produce the identical episode count, returns,
  win tallies, and Q-values before and after. If any number moves, you changed behavior, not
  just structure. Do this per round after the risky steps (the env/continuous splits, the match
  move).
- **Move code AS-IS first, beautify second.** When relocating a class, copy the exact code and
  fix only the imports; get the game green; THEN do the comments/cleanup/reordering as a
  separate step. Rewriting logic while relocating is how silent bugs slip in.
- **Commit a green checkpoint after each numbered step in section 10.** The tree is small, so
  this is cheap and de-risks everything: if a later step breaks the game you revert one commit,
  not the whole refactor. It also protects your work from the concurrent editor in section 2.
- **Working beats clean when they conflict.** If a perfectly clean env/continuous split starts
  threatening behavior, ship a slightly-less-split version that WORKS and leave a note, rather
  than a beautiful version that is broken. The user's priority order is: it works, THEN it is
  clean.
- **You cannot SEE the WebGL game.** You verify Python functionally (imports resolve, all 5
  rounds tick, every API route returns the same JSON shape as the baseline). The visual
  confirmation (scenes render, panels/tabs/replays look right) is the user's eyes - at the end,
  explicitly hand that final visual check to them.
- **Leave `.claude/` and the memory files alone.** They are local tooling, not the project.
