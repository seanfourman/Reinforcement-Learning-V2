"""Two-agent grid world - the live RL environment (Gymnasium API).

Each agent heads from its spawn to the goal tile; first one there WINS, a
simultaneous arrival is a DRAW. Round 1 (Peach's Castle) layers a REAL stochastic
MDP on top - scoring coins, slippery ICE, and "?" ghost/freeze blocks, all gated on
``self.rich`` (see state_transition / step). Round 2 currently uses the plain
grid dynamics while its seeded three-section city layout is established.

This subclasses ``gymnasium.Env`` to "capture" the Gymnasium concept, but it is a
two-agent env (PettingZoo-style): ``step`` takes a pair of actions and returns
per-agent obs/reward. The world is built by ``worldgen`` and a fresh one is
installed on ``reset(regenerate=True)`` (what pressing R triggers).

Coordinates are (row, col); the theme camera flips the view, so the goal reads
top-centre and the spawns bottom-left/right on screen.
"""

import random

import gymnasium as gym
from gymnasium import spaces

import worldgen
from worldgen import WALL

# --- actions: N, S, W, E ----------------------------------------------------
ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
N_ACTIONS = len(ACTIONS)
MOVE_ACTIONS = (0, 1, 2, 3)
# the two PERPENDICULAR actions an intended move can slip to on ice (N/S slip
# sideways to W/E, W/E slip to N/S) - used to build the stochastic ice transition.
PERP = {0: (2, 3), 1: (2, 3), 2: (0, 1), 3: (0, 1)}

# --- rewards ("cross": step cost + win/lose terminal) -------------------------
STEP_COST = 0.01
WIN = 1.0
LOSE = -1.0
MAX_STEPS = 400

# --- Round-1 game mechanics (active only where the world carries them) --------
COIN_REWARD = 0.2      # value of an optional coin (a detour trade-off vs step cost)
GHOST_LEN = 4          # steps of wall-phasing granted by a "?" ghost roll
FREEZE_LEN = 3         # steps stuck in place from a "?" freeze roll
SLIP_PROB = 0.30       # total chance an ice-cell move slips sideways (0.15 each way)
R2_SLIP_PROB = 0.12    # risky-shortcut skid chance (0.06 toward each perpendicular)
BLOCK_REWARD = 0.15    # bonus on a GHOST roll (keeps the Mystery Block gamble worth taking so the
                       # power-up actually shows; a FREEZE roll gets nothing - the risk)
STAR_REWARD = 0.35     # Round-2: reward for collecting a required tomato
                       # (shaping that keeps the multi-room hunt learnable for Monte-Carlo)


class GridWorld(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, seed=None, round_id=1, gen_cfg=None):
        super().__init__()
        self._seed = seed
        self.round_id = round_id
        self.gen_cfg = dict(gen_cfg or {})   # extra world-gen params (Round-2 hazard counts)
        self.max_steps = MAX_STEPS      # per-episode step cap (tunable from the panel)
        # Round-1 game mechanics, tunable LIVE from the panel (match.py pushes these onto
        # the env via set_dynamics after any (re)build). Kept as INSTANCE attrs - not module
        # constants - so the shared model (state_transition / _land) reads the CURRENT values
        # and the DP planners re-enumerate when a length changes. Defaults = module constants.
        self.slip_prob = SLIP_PROB         # total chance an ice move slips (half each side)
        self.r2_slip_prob = R2_SLIP_PROB   # Round-2 shortcut risk, independent of Round-1 ice
        self.ghost_len = GHOST_LEN         # floor tiles reachable while wall-phasing
        self.freeze_len = FREEZE_LEN       # turns stuck after a freeze roll
        self.block_ghost_prob = 0.5        # P(Ghost) on a Mystery Block; P(Freeze) = 1 - this
        self.coin_reward = COIN_REWARD     # value of an optional coin
        self.block_reward = BLOCK_REWARD   # bonus on a Ghost roll
        self.star_reward = STAR_REWARD     # Round-2: value of one of the 3 required Power Stars
        self.world = None
        self.rng = random.Random(seed)   # samples ice, puddles, blocks and pipe outcomes
        self.action_space = spaces.Discrete(N_ACTIONS)
        self.n_actions = N_ACTIONS        # match.py reads this off the env
        self._install(worldgen.generate(seed, round_id, **self.gen_cfg))

    # ---------------------------------------------------------------- install
    def _install(self, world):
        self.world = world
        self.objective = getattr(world, "objective", "cross")
        self.goal_set = {tuple(e) for e in world.escape}
        g = world.grid
        self.H, self.W = world.H, world.W
        # every non-wall cell is a graph node
        self.floor_cells = [(r, c) for r in range(self.H) for c in range(self.W)
                            if g[r][c] != WALL]
        self.cell_index = {cell: i for i, cell in enumerate(self.floor_cells)}
        self.n_cells = len(self.floor_cells)
        # the observation is simply the agent's cell index (a single-agent navigator)
        self.observation_space = spaces.MultiDiscrete([self.n_cells])

        # ---- Round-1 rich game layout (empty on every other round) -------------
        # PER-AGENT scoring coins + "?" power-up blocks (Red's and Blue's, mirror
        # pairs) and a SHARED set of icy/slippery cells. When all are empty, self.rich
        # is False and the env is a plain deterministic navigate-to-goal (rounds 2-3).
        self.coin_cells = {"red": list(getattr(world, "red_coins", [])),
                           "blue": list(getattr(world, "blue_coins", []))}
        self.block_cells = {"red": list(getattr(world, "red_blocks", [])),
                            "blue": list(getattr(world, "blue_blocks", []))}
        self.slip_cells = {tuple(s) for s in getattr(world, "slip", [])}
        # "rich" = Round 1's coin/Mystery-Block game (state = cell x mask x status).
        # Gated on coins/blocks ONLY, NOT slip: Round 2 also uses slippery cells but is
        # a DIFFERENT game (hazardous), so slip alone must not turn on the R1 machinery.
        self.rich = bool(self.coin_cells["red"] or self.coin_cells["blue"]
                         or self.block_cells["red"] or self.block_cells["blue"])
        # collect-mask bit layout per agent: coins take the low bits, blocks the next.
        self._n_coins = {a: len(self.coin_cells[a]) for a in ("red", "blue")}
        self._coin_bit = {a: {cell: i for i, cell in enumerate(self.coin_cells[a])}
                          for a in ("red", "blue")}
        self._block_bit = {a: {cell: self._n_coins[a] + k
                               for k, cell in enumerate(self.block_cells[a])}
                           for a in ("red", "blue")}
        # POSITION index: floor cells first (so cell_index-keyed states stay valid),
        # PLUS - on Round 1 - the interior maze-WALL cells the ghost power-up can phase
        # onto ONE CELL AT A TIME. Ghost stays inside the playable bbox (it can step onto
        # an interior wall but not out into the margin / off the board).
        if self.rich and self.floor_cells:
            rs = [r for r, _ in self.floor_cells]
            cs = [c for _, c in self.floor_cells]
            r0, r1, c0, c1 = min(rs), max(rs), min(cs), max(cs)
            inner_walls = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)
                           if g[r][c] == WALL]
            self.pos_cells = list(self.floor_cells) + inner_walls
        else:
            self.pos_cells = list(self.floor_cells)
        self.pos_index = {cell: i for i, cell in enumerate(self.pos_cells)}

        # ---- Round-2 hazards (New Donk City): spike traps, piranha plants, warp
        # pipes. Empty on every other round -> self.hazardous stays False and the
        # env is the plain deterministic navigate-to-goal skeleton. Round 2 adds
        # the collected-tomato mask below so progression locks remain Markov. ----
        self.spike_cells = {tuple(s) for s in getattr(world, "spikes", [])}
        self.plant_cells = {tuple(p) for p in getattr(world, "plants", [])}
        # A Piranha Plant occupies its own cell; its ATTACK ZONE is the eight
        # surrounding cells. Entering one of those neighbours kills the racer.
        # The plant cell itself is deliberately not lethal (future generators
        # should make it a wall so an actor cannot stand inside the model).
        self.plant_lethal = {
            (r + dr, c + dc)
            for r, c in self.plant_cells
            for dr in (-1, 0, 1)
            for dc in (-1, 0, 1)
            if (dr or dc)
            and 0 <= r + dr < self.H
            and 0 <= c + dc < self.W
        }
        # Both visible ends of a Pipe are active. Entering its entrance travels
        # to the generated destination; entering that exit again returns to the
        # original entrance. This also prevents actors from walking through the
        # solid exit model as if it were an ordinary floor tile.
        self.pipe_map = {}
        self.pipe_req = {}
        self.pipe_wt = {}
        for p in getattr(world, "pipes", []):
            entry = tuple(p["entry"])
            dests = [tuple(d) for d in p["dests"]]
            required = (
                int(p["requiresStar"])
                if p.get("requiresStar") is not None else None
            )
            self.pipe_map[entry] = dests
            self.pipe_req[entry] = required
            w = list(p.get("weights") or [])
            n = len(dests)
            if len(w) != n or sum(w) <= 0:            # default: uniform over the dests
                w = [1.0] * n
            self.pipe_wt[entry] = w
            for dest in dests:
                self.pipe_map.setdefault(dest, []).append(entry)
                self.pipe_req[dest] = required
                self.pipe_wt.setdefault(dest, []).append(1.0)
        self.hazardous = bool(self.spike_cells or self.plant_cells or self.pipe_map)

        # ---- Round-2 STARS: 3 collectibles PER AGENT (mirror pairs), collected on
        # entry. The final goal stays LOCKED until an agent holds all 3, so the state
        # carries a per-agent star bitmask (cell x star_mask) - Markov for Monte-Carlo. --
        self.star_cells = {"red": [tuple(s) for s in getattr(world, "red_stars", [])],
                           "blue": [tuple(s) for s in getattr(world, "blue_stars", [])]}
        self.n_stars = len(self.star_cells["red"])
        self.star_bit = {a: {cell: i for i, cell in enumerate(self.star_cells[a])}
                         for a in ("red", "blue")}
        self.star_full = (1 << self.n_stars) - 1
        self.star_mode = self.hazardous and self.n_stars > 0
        # Keep Gym's declaration aligned with the tuple the tabular agents really
        # receive.  Round 2 observes (cell index, collected-tomato bitmask).
        if self.star_mode:
            self.observation_space = spaces.MultiDiscrete(
                [self.n_cells, max(1, 1 << self.n_stars)]
            )

    # ------------------------------------------------------------------ tiles
    def _static_passable(self, agent, r, c):
        """Passability for a STATIC model (a planner's transition model): in-bounds
        and not a wall. ``agent`` is accepted for interface symmetry with the live
        rule."""
        return 0 <= r < self.H and 0 <= c < self.W and self.world.grid[r][c] != WALL

    def passable(self, agent, r, c):
        # live passability: in-bounds and not a wall. ``agent`` is accepted for
        # interface symmetry with _static_passable.
        return 0 <= r < self.H and 0 <= c < self.W and self.world.grid[r][c] != WALL

    def _ghost_step(self, cell, direction):
        """A GHOSTING move (a "?" power-up): step exactly ONE cell in ``direction`` -
        onto a floor cell OR straight onto an interior maze-wall cell (phasing, one
        square at a time). Only cells inside the playable region (in pos_index) are
        enterable, so the ghost can't drift off the board into the margin/void."""
        if direction not in MOVE_ACTIONS:
            return cell
        dr, dc = ACTIONS[direction]
        nxt = (cell[0] + dr, cell[1] + dc)
        return nxt if nxt in self.pos_index else cell

    # -------------------------------------------------------- tunable dynamics
    def set_dynamics(self, *, slip_prob=None, r2_slip_prob=None,
                     ghost_len=None, freeze_len=None,
                     block_ghost_prob=None, coin_reward=None, block_reward=None):
        """Update the Round-1 mechanic params live from the panel. A None (or negative)
        value KEEPS the current one. Returns True iff a change moved the DP STATE SPACE
        (the ghost / freeze timer range), so the caller knows the planners must
        re-ENUMERATE, not merely rebuild their cached transition model."""
        def pick(cur, new, lo, hi):
            return cur if (new is None or new < 0) else max(lo, min(hi, new))
        old_gl, old_fl = self.ghost_len, self.freeze_len
        self.slip_prob = pick(self.slip_prob, slip_prob, 0.0, 0.9)
        self.r2_slip_prob = pick(self.r2_slip_prob, r2_slip_prob, 0.0, 0.9)
        self.ghost_len = int(pick(self.ghost_len, ghost_len, 1, 8))
        self.freeze_len = int(pick(self.freeze_len, freeze_len, 1, 8))
        self.block_ghost_prob = pick(self.block_ghost_prob, block_ghost_prob, 0.0, 1.0)
        self.coin_reward = pick(self.coin_reward, coin_reward, 0.0, 2.0)
        self.block_reward = pick(self.block_reward, block_reward, 0.0, 2.0)
        return self.ghost_len != old_gl or self.freeze_len != old_fl

    # ------------------------------------------------------------------ reset
    def reset(self, *, seed=None, options=None, regenerate=False):
        if seed is not None:
            self.rng = random.Random(seed)
        if regenerate or self.world is None:
            self._install(worldgen.generate(seed if seed is not None else self._seed,
                                            self.round_id, **self.gen_cfg))
        self.red_pos = self.world.red_spawn
        self.blue_pos = self.world.blue_spawn
        self.steps = 0
        self.done = False
        self.winner = None
        # per-agent Round-1 context: which of its own coins/blocks it has claimed
        # (a bitmask) and its power-up/frozen status (0 normal, +k ghosting, -k frozen).
        # Stays 0 on the skeleton rounds (self.rich False), so the state is just (cell,).
        self.collect = {"red": 0, "blue": 0}
        self.status = {"red": 0, "blue": 0}
        # per-episode reward decomposition (terminal / shaping / other) per agent.
        # "shape" now carries collected-coin reward (0 on the skeleton rounds).
        self.ep_parts = {"red": {"terminal": 0.0, "shape": 0.0, "other": 0.0},
                         "blue": {"terminal": 0.0, "shape": 0.0, "other": 0.0}}
        # Round-2: which hazard (if any) killed each agent on the LAST step, and any
        # pipe destination it warped to - surfaced in snapshot for the death/warp FX.
        self._dead = {"red": None, "blue": None}
        self._warped = {"red": None, "blue": None}
        self._dead_at = {"red": None, "blue": None}
        self._warp_from = {"red": None, "blue": None}
        # Round-2: per-agent bitmask of Power Stars collected this episode (0..star_full)
        self.stars_collected = {"red": 0, "blue": 0}
        obs = (self.observe("red"), self.observe("blue"))
        return obs, {}

    def _accum_parts(self, reward, terminal, shape=None):
        """Fold this step's reward into the per-episode decomposition: terminal
        (win/lose), shape (collected coins), and other (step cost)."""
        shape = shape or {"red": 0.0, "blue": 0.0}
        for a in ("red", "blue"):
            p = self.ep_parts[a]
            t = terminal.get(a, 0.0)
            s = shape.get(a, 0.0)
            p["terminal"] += t
            p["shape"] += s
            p["other"] += reward[a] - t - s

    # ------------------------------------------------------------ observation
    def observe(self, agent):
        # each agent is an independent single-agent navigator. On the skeleton rounds
        # its state is just its cell index; on Round 1 it also carries its collected
        # mask + power-up status (see full_state) so the MDP stays Markov.
        pos = self.red_pos if agent == "red" else self.blue_pos
        return self.full_state(agent, pos)

    def full_state(self, agent, cell):
        """The agent's observation tuple AT ``cell`` in its CURRENT context. Plain
        ``(cell,)`` on the skeleton rounds; on Round 1 also ``(cell, collected_mask,
        status)``. The SAME tuple keys the Q-table, the DP value field, and every
        heatmap projection - visualizations call this with a probe cell to read V/policy
        at that tile given the agent's live coins/power-up."""
        idx = self.pos_index[cell]
        if self.rich:
            return (idx, self.collect[agent], self.status[agent])
        if getattr(self, "star_mode", False):      # Round 2: cell x stars-collected mask
            return (idx, self.stars_collected[agent])
        return (idx,)

    # ------------------------------------------------------------------- step
    def _pos(self, agent):
        return self.red_pos if agent == "red" else self.blue_pos

    def _resolve(self, agent, pos, direction, passable=None):
        """Landing cell for one move DIRECTION (0..3) from pos. ``passable`` defaults
        to the live rule; a planner may pass ``_static_passable``."""
        passable = passable or self.passable
        dr, dc = ACTIONS[direction]
        nr, nc = pos[0] + dr, pos[1] + dc
        return (nr, nc) if passable(agent, nr, nc) else pos

    def move_dist(self, agent, pos, action, passable=None):
        """P(next cell | pos, action) - the (deterministic) transition model. Returns
        a list of (prob, cell); a non-move action stays put. Kept in list form so a
        planner's Bellman backup can consume it unchanged."""
        if action not in MOVE_ACTIONS:
            return [(1.0, pos)]
        return [(1.0, self._resolve(agent, pos, action, passable))]

    def effective_actions(self, agent, pos=None):
        """Boolean mask over the action space: which actions actually DO something
        from ``pos`` (default: the agent's CURRENT cell). A move counts only if it
        lands on a different cell (does not bump a wall). Action selection masks to
        these so a greedy policy can't self-loop on a wall. Never all-False."""
        if pos is None:
            pos = self.red_pos if agent == "red" else self.blue_pos
        status = self.status.get(agent, 0) if (self.rich and hasattr(self, "status")) else 0
        if status < 0:                      # frozen: the move is ignored anyway
            return [True] * self.n_actions
        mask = [False] * self.n_actions
        for a in MOVE_ACTIONS:
            land = self._ghost_step(pos, a) if status > 0 else self._resolve(agent, pos, a)
            # A Round-2 pipe is a real progression gate.  Until this room's
            # tomato is held, treat its entrance like a wall for exploration
            # and greedy action masking as well as for the live transition.
            if land in self.pipe_map and not self._pipe_unlocked(agent, land):
                land = pos
            if land != pos:
                mask[a] = True
        if not any(mask):
            mask = [True] * self.n_actions
        return mask

    def _move(self, agent, pos, action):
        """Deterministic grid move (stays put if blocked)."""
        if action not in MOVE_ACTIONS:
            return pos
        return self._resolve(agent, pos, action)

    def _set_pos(self, agent, pos):
        if agent == "red":
            self.red_pos = pos
        else:
            self.blue_pos = pos

    def _pipe_unlocked(self, agent, entry):
        """Whether ``agent`` has the tomato required by this pipe, if any."""
        required = self.pipe_req.get(entry)
        if required is None:
            return True
        held = getattr(self, "stars_collected", {}).get(agent, 0)
        return bool(held & (1 << required))

    # ------------------------------------------------- the shared KNOWN model
    def state_transition(self, agent, state, action):
        """P(next_state, reward | state, action) for Round 1 - the model shared by the
        live env (sampled in step) and the DP planners (summed as an expectation), so a
        planner's value field is EXACTLY this env's dynamics. Returns a list of
        ``(prob, next_state, reward, done)``; ``done`` marks arrival on a goal cell
        (absorbing). Non-rich rounds degrade to one deterministic move.

        ``reward`` is the step cost plus any coin picked up this step; the win/lose
        RACE outcome is added by ``step`` (it depends on the OTHER agent, so it is not
        part of either agent's own MDP), and the planner credits the goal itself."""
        idx = state[0]
        cell = self.pos_cells[idx]
        if not self.rich:
            nxt = self._resolve(agent, cell, action) if action in MOVE_ACTIONS else cell
            return [(1.0, (self.pos_index[nxt],), -STEP_COST, nxt in self.goal_set)]

        mask, status = state[1], state[2]
        # FROZEN: the agent cannot act; it waits out the timer (still paying the step
        # cost - the lost tempo IS the penalty) as the counter ticks back toward 0.
        if status < 0:
            return [(1.0, (idx, mask, status + 1), -STEP_COST, False)]
        # GHOST: a precise ONE-CELL phase (may step onto an interior wall), no slip.
        if status > 0:
            return self._land(agent, 1.0, self._ghost_step(cell, action), mask, status, True)
        # NORMAL: walls block; on ICE the move slips sideways (expected-value reasoning).
        if action in MOVE_ACTIONS and cell in self.slip_cells:
            p1, p2 = PERP[action]
            sp = self.slip_prob
            moves = [(1.0 - sp, action), (sp / 2, p1), (sp / 2, p2)]
        else:
            moves = [(1.0, action)]

        out = []
        for prob, mv in moves:
            land = self._resolve(agent, cell, mv) if mv in MOVE_ACTIONS else cell
            out.extend(self._land(agent, prob, land, mask, 0, False))
        return out

    def _land(self, agent, prob, land, mask, status, ghost):
        """Successor(s) of landing on ``land``. Goal = terminal. Coins/blocks live on
        FLOOR cells only. A GHOST step decrements its timer ONLY when it lands on a
        FLOOR cell, so the agent can never be stranded inside a wall with the power-up
        already expired (on wall cells the timer holds, so it keeps phasing until out)."""
        lidx = self.pos_index[land]
        if land in self.goal_set:
            return [(prob, (lidx, mask, 0), -STEP_COST, True)]
        is_floor = self.world.grid[land[0]][land[1]] != WALL
        reward = -STEP_COST
        nmask = mask
        if is_floor:
            cbit = self._coin_bit[agent].get(land)
            if cbit is not None and not (mask >> cbit) & 1:
                nmask |= (1 << cbit)
                reward += self.coin_reward
        # a GHOST step spends a tile of its timer ONLY when it lands on FLOOR; on a wall
        # cell the timer HOLDS (see the class doc), so status can never reach 0 mid-wall.
        nstatus = (status - 1 if is_floor else status) if ghost else 0
        if is_floor:
            bbit = self._block_bit[agent].get(land)
            if bbit is not None and not (mask >> bbit) & 1:
                nmask |= (1 << bbit)                  # block consumed (one-time)
                # GHOST = power-up (bonus + ability); FREEZE = pure downside (the risk)
                pg = self.block_ghost_prob
                return [(prob * pg, (lidx, nmask, self.ghost_len),
                         reward + self.block_reward, False),
                        (prob * (1.0 - pg), (lidx, nmask, -self.freeze_len), reward, False)]
        return [(prob, (lidx, nmask, nstatus), reward, False)]

    def _apply_rich(self, agent, action):
        """Sample ONE transition from the shared model and apply it (position /
        collected mask / status). Returns the coin bonus earned this step (step cost +
        win/lose are added by ``step``)."""
        outs = self.state_transition(agent, self.observe(agent), action)
        r, acc, chosen = self.rng.random(), 0.0, outs[-1]
        for cand in outs:
            acc += cand[0]
            # strict '<' (not '<=') so a leading ZERO-probability outcome is never chosen
            # when rng() returns exactly 0.0 (reachable only at block_ghost_prob=0.0, where
            # the ghost branch carries prob 0 - it must resolve to the certain Freeze).
            if r < acc:
                chosen = cand
                break
        _, ns, rew, _done = chosen
        self._set_pos(agent, self.pos_cells[ns[0]])
        self.collect[agent] = ns[1]
        self.status[agent] = ns[2]
        return rew + STEP_COST                        # strip base step cost -> coin bonus

    def _r2_resolve(self, agent, action):
        """Round-2 move: walk one tile (walls block), then apply hazards. Returns
        ``(final_cell, death, warp_dest)`` - ``death`` is "spike"/"plant"/None and
        ``warp_dest`` is the tile a pipe teleported the agent onto (else None).
        Stepping INTO either end of a pipe applies its fixed transfer;
        a spike or any of the eight cells around a plant is lethal."""
        cur = self._pos(agent)
        move = action
        # SLIP: on a puddle a move may skid to a perpendicular tile (like Round-1 ice).
        if action in MOVE_ACTIONS and cur in self.slip_cells:
            r = self.rng.random()
            if r < self.r2_slip_prob:
                p1, p2 = PERP[action]
                move = p1 if r < self.r2_slip_prob * 0.5 else p2
        landed = self._move(agent, cur, move)          # the tile stepped onto (walls block)
        entry, warp = None, None
        if landed != cur and landed in self.pipe_map:  # stepped INTO a pipe -> warp
            if not self._pipe_unlocked(agent, landed):
                # Locked entries behave exactly like a wall.  This is mostly a
                # robustness guard—the generated course also merges through its
                # tomato—but it prevents any future open-plaza variant from
                # skipping a stage collectible.
                nxt = cur
            else:
                entry = landed                          # the pipe ENTRANCE (dive point)
                dests = self.pipe_map[landed]           # sample fixed map weights
                warp = self.rng.choices(
                    dests, weights=self.pipe_wt.get(landed)
                )[0]
                nxt = warp
        else:
            nxt = landed
        death = None
        if nxt in self.spike_cells:
            death = "spike"
        elif nxt in self.plant_lethal:
            death = "plant"
        return nxt, death, warp, entry

    def _status_name(self, agent):
        s = self.status.get(agent, 0)
        return "ghost" if s > 0 else "frozen" if s < 0 else "normal"

    def step(self, a_red, a_blue):
        """One step: both agents move; first onto a goal cell wins, a simultaneous
        arrival is a draw. Round 1 samples ice and Mystery Blocks; Round 2
        samples risky-route puddle skids before applying hazards and pipes."""
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        reward = {"red": -STEP_COST, "blue": -STEP_COST}
        shape = {"red": 0.0, "blue": 0.0}      # coin reward, tracked for the decomposition
        dead = {"red": None, "blue": None}     # Round-2: which hazard killed each agent
        warped = {"red": None, "blue": None}   # the warp DESTINATION
        dead_at = {"red": None, "blue": None}  # the tile where it died (before respawn)
        warp_from = {"red": None, "blue": None}  # the pipe ENTRANCE it dived into

        for agent, act in (("red", a_red), ("blue", a_blue)):
            if self.rich:
                bonus = self._apply_rich(agent, act)   # updates pos / collect / status
                reward[agent] += bonus
                shape[agent] = bonus
            elif self.hazardous:
                nxt, death, warp, entry = self._r2_resolve(agent, act)
                self._set_pos(agent, nxt)
                dead[agent] = death
                warped[agent] = warp
                warp_from[agent] = entry
                if death:
                    dead_at[agent] = nxt               # stays here until the episode resets
                elif self.star_mode and nxt in self.star_bit[agent]:
                    bit = self.star_bit[agent][nxt]    # collect a Power Star on entry
                    if not (self.stars_collected[agent] >> bit) & 1:
                        self.stars_collected[agent] |= (1 << bit)
                        reward[agent] += STAR_REWARD
                        shape[agent] += STAR_REWARD
            else:
                self._set_pos(agent, self._move(agent, self._pos(agent), act))
        self._dead, self._warped = dead, warped
        self._dead_at, self._warp_from = dead_at, warp_from

        terminal = {"red": 0.0, "blue": 0.0}
        finishers = []
        if self.hazardous:
            # Round 2: death ends the whole race immediately.  The dead racer
            # remains on the lethal cell for the final frame and returns to its
            # spawn only when the next episode resets the environment.
            died = [a for a in ("red", "blue") if dead[a]]
            if died:
                self.done = True
                if len(died) == 2:
                    self.winner = None
                    for a in died:
                        terminal[a] += LOSE
                        reward[a] += LOSE
                else:
                    loser = died[0]
                    winner = "blue" if loser == "red" else "red"
                    self.winner = winner
                    terminal[loser] += LOSE
                    reward[loser] += LOSE
                    # The survivor wins the head-to-head result, but did not
                    # complete the course. Only reaching the goal earns WIN.
            else:
                # With tomatoes restored later, the goal will remain locked
                # until its progress mask is complete.
                if self.star_mode:
                    reached = [a for a in ("red", "blue") if self._pos(a) in self.goal_set
                               and self.stars_collected[a] == self.star_full]
                else:
                    reached = [a for a in ("red", "blue") if self._pos(a) in self.goal_set]
                if reached:
                    finishers = list(reached)
                    self.done = True
                    self.winner = None if len(reached) == 2 else reached[0]
                    for a in reached:
                        terminal[a] += WIN
                        reward[a] += WIN
        else:
            # Round 1 / skeleton: first ONTO the goal wins, the other loses, a tie draws
            # (rank goal(2) > alive(1) > dead(0); there are no deaths off Round 2).
            reached = [a for a in ("red", "blue") if self._pos(a) in self.goal_set]
            died = [a for a in ("red", "blue") if dead[a]]
            if reached or died:
                finishers = list(reached)
                self.done = True
                rank = {a: (2 if self._pos(a) in self.goal_set else (0 if dead[a] else 1))
                        for a in ("red", "blue")}
                if rank["red"] == rank["blue"]:
                    self.winner = None
                    term = WIN if rank["red"] == 2 else LOSE
                    terminal["red"] = terminal["blue"] = term
                else:
                    self.winner = "red" if rank["red"] > rank["blue"] else "blue"
                    loser = "blue" if self.winner == "red" else "red"
                    terminal[self.winner] = WIN
                    terminal[loser] = LOSE
                reward["red"] += terminal["red"]
                reward["blue"] += terminal["blue"]

        self._accum_parts(reward, terminal, shape)

        truncated = False
        if not self.done and self.steps >= self.max_steps:
            self.done = True
            truncated = True
            self.winner = None
        obs = (self.observe("red"), self.observe("blue"))
        return obs, reward, self.done, truncated, {
            "winner": self.winner,
            "finishers": finishers,
            "died": died,
        }

    def to_json(self):
        """World descriptor for the viewer (/api/world). Grid rounds delegate to the
        World; the continuous rounds have their own descriptor."""
        return self.world.to_json()

    # --------------------------------------------------------------- snapshot
    def snapshot(self):
        """Live render state for the viewer: the two agents' cells, the step count,
        and the winner (None until someone reaches the goal). The static maze / coin /
        Shine layout rides on /api/world; on Round 1 the per-agent collected bitmasks
        (which coins/blocks to hide) and power-up status ride each frame."""
        snap = {
            "red": list(self.red_pos), "blue": list(self.blue_pos),
            "steps": self.steps, "winner": self.winner,
        }
        if self.rich:
            for agent, ck, bk, sk in (("red", "redCoins", "redBlocks", "redStatus"),
                                      ("blue", "blueCoins", "blueBlocks", "blueStatus")):
                n, m = self._n_coins[agent], self.collect[agent]
                snap[ck] = m & ((1 << n) - 1)      # coin bits: hide collected coins
                snap[bk] = m >> n                   # block bits: empty used "?" blocks
                snap[sk] = self._status_name(agent)  # "normal" | "ghost" | "frozen"
        if getattr(self, "hazardous", False):
            # Round-2 per-frame FX cues: a hazard death ("spike"/"plant") and any pipe
            # warp destination, so the theme can trigger the spike-rise / plant-chomp /
            # warp animations and the board can SNAP (not slide) a teleported agent.
            dead = getattr(self, "_dead", {}) or {}
            warped = getattr(self, "_warped", {}) or {}
            dead_at = getattr(self, "_dead_at", {}) or {}
            warp_from = getattr(self, "_warp_from", {}) or {}
            for agent, pre in (("red", "red"), ("blue", "blue")):
                snap[pre + "Dead"] = dead.get(agent)                 # "spike"|"plant"|None
                w = warped.get(agent)
                snap[pre + "Warp"] = list(w) if w else None          # warp DESTINATION cell
                da = dead_at.get(agent)
                snap[pre + "DeadAt"] = list(da) if da else None      # the tile it died on
                wf = warp_from.get(agent)
                snap[pre + "WarpFrom"] = list(wf) if wf else None    # the pipe ENTRANCE it dived
            if getattr(self, "star_mode", False):
                sc = getattr(self, "stars_collected", {}) or {}
                snap["redStars"] = sc.get("red", 0)      # bitmask of collected stars (hide + progress)
                snap["blueStars"] = sc.get("blue", 0)
                snap["nStars"] = self.n_stars
        return snap


if __name__ == "__main__":
    env = GridWorld(seed=1)
    env.reset()
    print(f"World OK: {env.H}x{env.W}, {env.n_cells} walkable cells.")
    print(f"  obs(red) = {env.observe('red')}")
