"""Round 1's environment mechanics: the REAL stochastic MDP on the castle maze.

On top of the shared grid engine, Peach's Castle layers everything that makes
Round 1 a planning problem instead of a shortest path:

  * PER-AGENT scoring COINS (+coin_reward, mirror-symmetric so the race stays
    fair), tracked in the state's collected-mask;
  * shared slippery ICE cells: a move slips sideways with ``slip_prob``;
  * "?" MYSTERY BLOCKS, a one-time gamble per agent: GHOST (phase through walls
    for ``ghost_len`` floor tiles, plus a bonus) or FREEZE (stuck for
    ``freeze_len`` turns).

The state is ``(cell, collected_mask, status)``: status is 0 normal, +k while
ghosting (k floor-tiles left), -k while frozen (k turns left). Crucially, the
whole transition model is EXPOSED via ``state_transition`` - the SAME model
the live env samples in ``step`` is what the DP planners (``dp_base.py``) sum
over, so a planner's value field is EXACTLY this env's stochastic dynamics.
"""

from core.grid_env import (GridWorld, ACTIONS, MOVE_ACTIONS, PERP, STEP_COST)
from core.worldgen import WALL

from . import world

# --- Round-1 game mechanics (defaults; live-tunable from the panel) ----------
COIN_REWARD = 0.2      # value of an optional coin (a detour trade-off vs step cost)
GHOST_LEN = 4          # steps of wall-phasing granted by a "?" ghost roll
FREEZE_LEN = 3         # steps stuck in place from a "?" freeze roll
SLIP_PROB = 0.30       # total chance an ice-cell move slips sideways (0.15 each way)
BLOCK_REWARD = 0.15    # bonus on a GHOST roll (keeps the Mystery Block gamble worth taking so the
                       # power-up actually shows; a FREEZE roll gets nothing - the risk)


class PeachCastleEnv(GridWorld):
    """The castle maze: coins + ice + Mystery Blocks over the shared grid engine."""

    # live-tunable mechanic values; the module constants are the defaults. Kept as
    # attributes (updated by set_dynamics) - not read from the constants - so the
    # shared model (state_transition / _land) always uses the CURRENT values and
    # the DP planners re-enumerate when a timer length changes.
    slip_prob = SLIP_PROB         # ice slip chance (half toward each side)
    ghost_len = GHOST_LEN         # floor tiles reachable while wall-phasing
    freeze_len = FREEZE_LEN       # turns stuck after a freeze roll
    block_ghost_prob = 0.5        # P(Ghost) on a Mystery Block; P(Freeze) = 1 - this
    coin_reward = COIN_REWARD     # value of an optional coin
    block_reward = BLOCK_REWARD   # bonus on a Ghost roll

    def _generate(self, seed):
        return world.generate(seed, **self.gen_cfg)

    # ---------------------------------------------------------------- install
    def _install_features(self, w):
        """Parse the castle's rich layout: PER-AGENT scoring coins + "?" power-up
        blocks (Red's and Blue's, mirror pairs). When all are empty, self.rich
        stays False and the env is a plain deterministic navigate-to-goal."""
        g = w.grid
        self.coin_cells = {"red": list(getattr(w, "red_coins", [])),
                           "blue": list(getattr(w, "blue_coins", []))}
        self.block_cells = {"red": list(getattr(w, "red_blocks", [])),
                            "blue": list(getattr(w, "blue_blocks", []))}
        # "rich" = the coin/Mystery-Block game (state = cell x mask x status).
        # Gated on coins/blocks ONLY, NOT slip: other rounds also use slippery
        # cells but play a DIFFERENT game, so slip alone must not turn this on.
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
        # PLUS the interior maze-WALL cells the ghost power-up can phase onto ONE
        # CELL AT A TIME. Ghost stays inside the playable bbox (it can step onto
        # an interior wall but not out into the margin / off the board).
        if self.rich and self.floor_cells:
            rs = [r for r, _ in self.floor_cells]
            cs = [c for _, c in self.floor_cells]
            r0, r1, c0, c1 = min(rs), max(rs), min(cs), max(cs)
            inner_walls = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)
                           if g[r][c] == WALL]
            self.pos_cells = list(self.floor_cells) + inner_walls

    # ------------------------------------------------------------------ reset
    def _reset_round_state(self):
        # per-agent context: which of its own coins/blocks it has claimed (a
        # bitmask) and its power-up/frozen status (0 normal, +k ghosting, -k frozen).
        self.collect = {"red": 0, "blue": 0}
        self.status = {"red": 0, "blue": 0}

    # -------------------------------------------------------- tunable dynamics
    def _set_round_dynamics(self, *, ghost_len=None, freeze_len=None,
                            block_ghost_prob=None, coin_reward=None,
                            block_reward=None, **_unused):
        """Round-1 mechanic knobs. Returns True iff a change moved the DP STATE
        SPACE (the ghost / freeze timer range), so the caller knows the planners
        must re-ENUMERATE, not merely rebuild their cached transition model."""
        old_gl, old_fl = self.ghost_len, self.freeze_len
        self.ghost_len = int(self._pick(self.ghost_len, ghost_len, 1, 8))
        self.freeze_len = int(self._pick(self.freeze_len, freeze_len, 1, 8))
        self.block_ghost_prob = self._pick(self.block_ghost_prob, block_ghost_prob, 0.0, 1.0)
        self.coin_reward = self._pick(self.coin_reward, coin_reward, 0.0, 2.0)
        self.block_reward = self._pick(self.block_reward, block_reward, 0.0, 2.0)
        return self.ghost_len != old_gl or self.freeze_len != old_fl

    # ------------------------------------------------------------ observation
    def full_state(self, agent, cell):
        # (cell, collected mask, status): the mask + power-up timer keep the
        # stochastic collectible game Markov (see the module docstring).
        if not self.rich:
            return super().full_state(agent, cell)
        return (self.pos_index[cell], self.collect[agent], self.status[agent])

    # ------------------------------------------------------------------ moves
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

    # ------------------------------------------------- the shared KNOWN model
    def state_transition(self, agent, state, action):
        """P(next_state, reward | state, action) - the model shared by the live env
        (sampled in step) and the DP planners (summed as an expectation), so a
        planner's value field is EXACTLY this env's dynamics. Returns a list of
        ``(prob, next_state, reward, done)``; ``done`` marks arrival on a goal cell
        (absorbing). Non-rich worlds degrade to one deterministic move.

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

    # ------------------------------------------------------------------- step
    def _advance_agent(self, agent, act, reward, shape, dead, warped, dead_at,
                       warp_from):
        if not self.rich:
            return super()._advance_agent(agent, act, reward, shape, dead,
                                          warped, dead_at, warp_from)
        bonus = self._apply_rich(agent, act)   # updates pos / collect / status
        reward[agent] += bonus
        shape[agent] = bonus

    # --------------------------------------------------------------- snapshot
    def _status_name(self, agent):
        s = self.status.get(agent, 0)
        return "ghost" if s > 0 else "frozen" if s < 0 else "normal"

    def snapshot(self):
        """Base frame + Round 1's per-agent collected bitmasks (which coins/blocks
        to hide) and power-up status."""
        snap = super().snapshot()
        if self.rich:
            for agent, ck, bk, sk in (("red", "redCoins", "redBlocks", "redStatus"),
                                      ("blue", "blueCoins", "blueBlocks", "blueStatus")):
                n, m = self._n_coins[agent], self.collect[agent]
                snap[ck] = m & ((1 << n) - 1)      # coin bits: hide collected coins
                snap[bk] = m >> n                   # block bits: empty used "?" blocks
                snap[sk] = self._status_name(agent)  # "normal" | "ghost" | "frozen"
        return snap
