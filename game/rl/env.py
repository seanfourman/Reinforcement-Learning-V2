"""Two-agent grid world - the live RL environment (Gymnasium API).

Each agent heads from its spawn to the goal tile; first one there WINS, a
simultaneous arrival is a DRAW. Round 1 (Peach's Castle) layers a REAL stochastic
MDP on top - scoring coins, slippery ICE, and "?" ghost/freeze blocks, all gated on
``self.rich`` (see state_transition / step). The other grid rounds stay bare
deterministic navigate-to-goal shells until their real game is built.

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
BLOCK_REWARD = 0.15    # bonus on a GHOST roll (keeps the Mystery Block gamble worth taking so the
                       # power-up actually shows; a FREEZE roll gets nothing - the risk)


class GridWorld(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, seed=None, round_id=1):
        super().__init__()
        self._seed = seed
        self.round_id = round_id
        self.max_steps = MAX_STEPS      # per-episode step cap (tunable from the panel)
        # Round-1 game mechanics, tunable LIVE from the panel (match.py pushes these onto
        # the env via set_dynamics after any (re)build). Kept as INSTANCE attrs - not module
        # constants - so the shared model (state_transition / _land) reads the CURRENT values
        # and the DP planners re-enumerate when a length changes. Defaults = module constants.
        self.slip_prob = SLIP_PROB         # total chance an ice move slips (half each side)
        self.ghost_len = GHOST_LEN         # floor tiles reachable while wall-phasing
        self.freeze_len = FREEZE_LEN       # turns stuck after a freeze roll
        self.block_ghost_prob = 0.5        # P(Ghost) on a Mystery Block; P(Freeze) = 1 - this
        self.coin_reward = COIN_REWARD     # value of an optional coin
        self.block_reward = BLOCK_REWARD   # bonus on a Ghost roll
        self.world = None
        self.rng = random.Random(seed)   # kept for interface parity (moves are deterministic)
        self.action_space = spaces.Discrete(N_ACTIONS)
        self.n_actions = N_ACTIONS        # match.py reads this off the env
        self._install(worldgen.generate(seed, round_id))

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
        self.rich = bool(self.coin_cells["red"] or self.coin_cells["blue"]
                         or self.block_cells["red"] or self.block_cells["blue"]
                         or self.slip_cells)
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
    def set_dynamics(self, *, slip_prob=None, ghost_len=None, freeze_len=None,
                     block_ghost_prob=None, coin_reward=None, block_reward=None):
        """Update the Round-1 mechanic params live from the panel. A None (or negative)
        value KEEPS the current one. Returns True iff a change moved the DP STATE SPACE
        (the ghost / freeze timer range), so the caller knows the planners must
        re-ENUMERATE, not merely rebuild their cached transition model."""
        def pick(cur, new, lo, hi):
            return cur if (new is None or new < 0) else max(lo, min(hi, new))
        old_gl, old_fl = self.ghost_len, self.freeze_len
        self.slip_prob = pick(self.slip_prob, slip_prob, 0.0, 0.9)
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
                                            self.round_id))
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
        if not self.rich:
            return (idx,)
        return (idx, self.collect[agent], self.status[agent])

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

    def _status_name(self, agent):
        s = self.status.get(agent, 0)
        return "ghost" if s > 0 else "frozen" if s < 0 else "normal"

    def step(self, a_red, a_blue):
        """One step: both agents move; first onto a goal cell wins, a simultaneous
        arrival is a draw. On Round 1 each move is sampled from the shared model
        (ice slip, coin pickup, "?" block), so movement is stochastic."""
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        reward = {"red": -STEP_COST, "blue": -STEP_COST}
        shape = {"red": 0.0, "blue": 0.0}      # coin reward, tracked for the decomposition

        for agent, act in (("red", a_red), ("blue", a_blue)):
            if self.rich:
                bonus = self._apply_rich(agent, act)   # updates pos / collect / status
                reward[agent] += bonus
                shape[agent] = bonus
            else:
                self._set_pos(agent, self._move(agent, self._pos(agent), act))

        # reach the goal -> win; both crossing on the SAME step is a genuine DRAW.
        terminal = {"red": 0.0, "blue": 0.0}
        reached = [a for a in ("red", "blue") if self._pos(a) in self.goal_set]
        if reached:
            self.done = True
            if len(reached) == 2:
                self.winner = None
                terminal["red"] = terminal["blue"] = WIN
            else:
                self.winner = reached[0]
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
        return obs, reward, self.done, truncated, {"winner": self.winner}

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
        return snap


if __name__ == "__main__":
    env = GridWorld(seed=1)
    env.reset()
    print(f"World OK: {env.H}x{env.W}, {env.n_cells} walkable cells.")
    print(f"  obs(red) = {env.observe('red')}")
