"""The shared two-agent GRID engine (Gymnasium API) behind Rounds 1-3.

Each agent heads from its spawn to the goal tile; first one there WINS, a
simultaneous arrival is a DRAW. This module owns everything the three grid
rounds have in COMMON: the action alphabet, movement resolution (walls block),
the effective-action masking the greedy policies rely on, the shared
independent-racer outcome machinery (a dead or finished racer freezes while
the rival plays on - used by Rounds 2 and 3), the step/timeout loop, and the
snapshot plumbing the viewer polls.

Everything a round ADDS on top lives in that arena's ``env.py`` subclass,
wired through a small set of hooks:

    _install_features(world)   parse the round's static layout, set its flags
    _reset_round_state()       per-episode round state (masks, timers, ...)
    _advance_agent(...)        how ONE agent's action resolves this tick
    _resolve_order(...)        who moves first (Round 3 overrides for fairness)
    _goal_reached(agent)       when standing on the goal actually wins (R2 locks
                               it behind the collected tomatoes)
    _set_round_dynamics(...)   the round's live-tunable mechanic knobs
    full_state / snapshot      the round's state tuple / extra frame fields

It subclasses ``gymnasium.Env`` to "capture" the Gymnasium concept, but it is a
two-agent env (PettingZoo-style): ``step`` takes a pair of actions and returns
per-agent obs/reward. The world is built by the arena's ``world.py`` and a
fresh one is installed on ``reset(regenerate=True)`` (the New World control).

Coordinates are (row, col); the theme camera flips the view, so the goal reads
top-centre and the spawns bottom-left/right on screen.
"""

import random

import gymnasium as gym
from gymnasium import spaces

from core.worldgen import WALL

# --- actions: Up, Down, Left, Right (screen-relative names; 0=row-1, 1=row+1,
# 2=col-1, 3=col+1) --------------------------------------------------------
ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
N_ACTIONS = len(ACTIONS)
MOVE_ACTIONS = (0, 1, 2, 3)
# Round 3 (the Goomba timing round) adds a 5th action: STAY. It is NOT in
# MOVE_ACTIONS, so every resolver already treats it as "hold position" - it just
# lets an agent wait a tick for a patrol to clear. Only exposed when goomba_mode is on.
STAY = N_ACTIONS                 # action index 4
# the two PERPENDICULAR actions an intended move can slip to on ice (Up/Down slip
# sideways to Left/Right, and vice versa) - builds the stochastic slip transitions.
PERP = {0: (2, 3), 1: (2, 3), 2: (0, 1), 3: (0, 1)}

# --- rewards ("cross": step cost + win/lose terminal) -------------------------
STEP_COST = 0.01
WIN = 1.0
LOSE = -1.0
MAX_STEPS = 400


class GridWorld(gym.Env):
    """The shared grid engine; each grid arena subclasses this with its mechanics."""

    metadata = {"render_modes": []}

    # ---- feature flags: the arena subclasses flip these in _install_features.
    # They gate every round-specific path, so a bare engine is a plain
    # deterministic navigate-to-goal race.
    rich = False           # Round 1: coins + "?" blocks + ice (state = cell x mask x status)
    hazardous = False      # Rounds 2/3: independent racer death/finish resolution
    star_mode = False      # Round 2: the collect-3-tomatoes progression
    goomba_mode = False    # Round 3: patrolling Goombas + the STAY action

    # ---- live-tunable slip probabilities (the shared mask machinery reads
    # these). Each arena's env module owns the default CONSTANT and installs it;
    # the tournament pushes its current values onto the env after every (re)build.
    slip_prob = 0.0        # Round-1 ice (half chance to each perpendicular)
    r2_slip_prob = 0.0     # Round-2 puddle skid (also read by the generic mask path)
    r3_slip_prob = 0.0     # Round-3 wet-cell skid

    # ---- neutral defaults for feature DATA the shared engine touches, so the
    # generic paths (masking, snapshot) work without round-specific parsing.
    # Subclass _install_features replaces these with real instance attributes.
    plant_cells = frozenset()

    def __init__(self, seed=None, round_id=1, gen_cfg=None):
        super().__init__()
        self._seed = seed
        self.round_id = round_id
        self.gen_cfg = dict(gen_cfg or {})   # extra world-gen params (reserved)
        self.max_steps = MAX_STEPS      # per-episode step cap (tunable from the panel)
        self._resolved_action = {"red": None, "blue": None}
        self._slipped = {"red": False, "blue": False}
        self.world = None
        self.rng = random.Random(seed)   # samples slips, blocks and pipe outcomes
        self.action_space = spaces.Discrete(N_ACTIONS)
        self.n_actions = N_ACTIONS        # the tournament reads this off the env
        self._install(self._generate(seed))

    # --------------------------------------------------------------- worldgen
    def _generate(self, seed):
        """Build this round's ``World``. Each arena env binds its own generator."""
        raise NotImplementedError("arena env classes bind their world generator")

    # ---------------------------------------------------------------- install
    def _install(self, world):
        """Adopt a (new) static world: index the walkable cells, then let the
        arena hook parse its round-specific layout before spaces are finalized."""
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
        # the observation is simply the agent's cell index (a single-agent
        # navigator); arenas with a richer state override in _install_features
        self.observation_space = spaces.MultiDiscrete([self.n_cells])
        # the SHARED slippery cells (Round-1 ice / Round-2 puddles / Round-3 wet)
        self.slip_cells = {tuple(s) for s in getattr(world, "slip", [])}
        # POSITION index default: the floor cells (Round 1 appends the interior
        # wall cells its ghost power-up can phase onto)
        self.pos_cells = list(self.floor_cells)
        self.n_actions = N_ACTIONS
        self._phase_period = 1
        self._install_features(world)
        # finalize AFTER the hook: the hook may extend pos_cells or resize actions
        self.pos_index = {cell: i for i, cell in enumerate(self.pos_cells)}
        self.action_space = spaces.Discrete(self.n_actions)

    def _install_features(self, world):
        """Arena hook: parse the round's static layout + set its feature flags."""

    # ------------------------------------------------------------------ tiles
    def passable(self, agent, r, c):
        """In-bounds and not a wall. ``agent`` is accepted so a subclass could
        make passability side-dependent without changing the callers."""
        return 0 <= r < self.H and 0 <= c < self.W and self.world.grid[r][c] != WALL

    def _ghost_step(self, cell, direction):
        """Round-1 wall-phasing move; the base engine has no ghosting, so this is
        only reachable there (the masking path calls it when a positive status is
        set, which only Round 1's env ever does)."""
        return cell

    def _pipe_unlocked(self, agent, entry, held=None):
        """Round-2 progression gate; no pipes exist in the base engine."""
        return True

    # -------------------------------------------------------- tunable dynamics
    @staticmethod
    def _pick(cur, new, lo, hi):
        """A panel knob update: None (or negative) KEEPS the current value."""
        return cur if (new is None or new < 0) else max(lo, min(hi, new))

    def set_dynamics(self, *, slip_prob=None, r2_slip_prob=None, r3_slip_prob=None,
                     **round_knobs):
        """Update the live-tunable mechanic params from the panel. A None (or
        negative) value KEEPS the current one. The slip trio is shared engine
        state; everything else is forwarded to the arena's own hook. Returns
        True iff a change moved a planner's STATE SPACE (only Round 1's
        ghost/freeze lengths can), so the caller knows to re-enumerate."""
        self.slip_prob = self._pick(self.slip_prob, slip_prob, 0.0, 0.9)
        self.r2_slip_prob = self._pick(self.r2_slip_prob, r2_slip_prob, 0.0, 0.9)
        self.r3_slip_prob = self._pick(self.r3_slip_prob, r3_slip_prob, 0.0, 0.9)
        return self._set_round_dynamics(**round_knobs)

    def _set_round_dynamics(self, **_unused):
        """Arena hook for the round's own mechanic knobs (see set_dynamics)."""
        return False

    # ------------------------------------------------------------------ reset
    def reset(self, *, seed=None, options=None, regenerate=False):
        if seed is not None:
            self.rng = random.Random(seed)
        if regenerate or self.world is None:
            self._install(self._generate(seed if seed is not None else self._seed))
        self.red_pos = self.world.red_spawn
        self.blue_pos = self.world.blue_spawn
        self.steps = 0
        self.done = False
        self.winner = None
        # per-episode reward decomposition (terminal / shaping / other) per agent.
        # "shape" carries collectible reward (0 on rounds without collectibles).
        self.ep_parts = {"red": {"terminal": 0.0, "shape": 0.0, "other": 0.0},
                         "blue": {"terminal": 0.0, "shape": 0.0, "other": 0.0}}
        # which hazard (if any) killed each agent on the LAST step, and any
        # pipe destination it warped to - surfaced in snapshot for the death/warp FX.
        self._dead = {"red": None, "blue": None}
        self._warped = {"red": None, "blue": None}
        self._dead_at = {"red": None, "blue": None}
        self._warp_from = {"red": None, "blue": None}
        self._resolved_action = {"red": None, "blue": None}
        self._slipped = {"red": False, "blue": False}
        # Hazardous rounds resolve each racer independently. A dead/finished racer
        # stays frozen for the rest of the episode; the other keeps navigating until
        # it also resolves or the shared time limit expires. This preserves complete
        # Monte-Carlo returns and matches "no respawn until the next episode."
        self._agent_done = {"red": False, "blue": False}
        self._agent_outcome = {"red": None, "blue": None}
        self._race_winner = None
        self._race_decided = False
        self._episode_finishers = []
        self._episode_died = []
        self._finish_steps = {}
        self._reset_round_state()
        obs = (self.observe("red"), self.observe("blue"))
        return obs, {}

    def _reset_round_state(self):
        """Arena hook: reset the round's per-episode state (masks, timers, ...)."""

    def _accum_parts(self, reward, terminal, shape=None):
        """Fold this step's reward into the per-episode decomposition: terminal
        (win/lose), shape (collected bonuses), and other (step cost)."""
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
        # each agent is an independent single-agent navigator. Its state is its
        # cell index, plus whatever context factors its round adds (full_state).
        pos = self.red_pos if agent == "red" else self.blue_pos
        return self.full_state(agent, pos)

    def full_state(self, agent, cell):
        """The agent's observation tuple AT ``cell`` in its CURRENT context. Plain
        ``(cell,)`` on the base engine; each arena overrides with its own factors
        (Round 1 adds the collected-mask + status, Round 2 the tomato mask, Round
        3 the patrol phase + rival flag + door bit). The SAME tuple keys the
        Q-table, the DP value field, and every heatmap projection -
        visualizations call this with a probe cell to read V/policy at that tile
        given the agent's live context."""
        return (self.pos_index[cell],)

    # ------------------------------------------------------------------- step
    def _pos(self, agent):
        return self.red_pos if agent == "red" else self.blue_pos

    def _resolve(self, agent, pos, direction, passable=None):
        """Landing cell for one move DIRECTION (0..3) from pos. ``passable``
        defaults to the live rule. A non-move (STAY) holds position."""
        if direction not in MOVE_ACTIONS:
            return pos
        passable = passable or self.passable
        dr, dc = ACTIONS[direction]
        nr, nc = pos[0] + dr, pos[1] + dc
        return (nr, nc) if passable(agent, nr, nc) else pos

    def effective_actions(self, agent, pos=None, star_mask=None):
        """Boolean mask over actions that can change state with positive probability.

        On a dry tile this excludes a wall bump. On slippery cells it also considers
        the two possible perpendicular skid outcomes, so an intended wall bump is
        not incorrectly hidden when a stochastic skid can still move. Never all-False.
        """
        if pos is None:
            pos = self.red_pos if agent == "red" else self.blue_pos
        status = self.status.get(agent, 0) if (self.rich and hasattr(self, "status")) else 0
        if status < 0:                      # frozen: the move is ignored anyway
            return [True] * self.n_actions
        mask = [False] * self.n_actions
        for a in MOVE_ACTIONS:
            if status > 0:
                moves = [a]
            elif pos in self.slip_cells:
                slip = self.slip_prob if self.rich else self.r2_slip_prob
                moves = []
                if slip < 1.0:
                    moves.append(a)
                if slip > 0.0:
                    moves.extend(PERP[a])
            else:
                moves = [a]
            for move in moves:
                land = (
                    self._ghost_step(pos, move)
                    if status > 0 else self._resolve(agent, pos, move)
                )
                # A Round-2 pipe is a real progression gate. Until this room's
                # tomato is held, treat its entrance like a wall for exploration
                # and greedy action masking as well as for the live transition.
                if land in getattr(self, "pipe_map", {}) and not self._pipe_unlocked(
                        agent, land, held=star_mask):
                    land = pos
                if land != pos:
                    mask[a] = True
                    break
        if getattr(self, "goomba_mode", False):
            mask[STAY] = True          # waiting is always a real choice on the timing round
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

    # ------------------------------------------------------------ step hooks
    def _resolve_order(self, a_red, a_blue):
        """The order the two racers resolve this tick (Round 3 overrides to give
        the racer nearer the goal the bridge on a tie)."""
        return (("red", a_red), ("blue", a_blue))

    def _advance_agent(self, agent, act, reward, shape, dead, warped, dead_at,
                       warp_from):
        """Resolve ONE agent's action this tick. The base engine is the plain
        deterministic move; each arena overrides with its round's mechanics and
        writes any hazard outcome into the passed-in per-tick dicts."""
        self._set_pos(agent, self._move(agent, self._pos(agent), act))

    def _goal_reached(self, agent):
        """Is this agent's current tile a WINNING goal? (Round 2 also requires the
        full tomato set.)"""
        return self._pos(agent) in self.goal_set

    def step(self, a_red, a_blue):
        """Advance both active racers by one shared clock tick.

        The per-agent resolution is the arena's ``_advance_agent``. The outcome
        logic then depends on the round family: hazardous rounds (2/3) resolve
        each racer independently (dead or finished racers freeze while the other
        continues); Round 1 / the bare engine end the episode on the first
        arrival (or death), first-there-wins.
        """
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        # These describe THIS tick only. In particular, an inactive racer must
        # not appear to keep repeating the action/skid from its terminal tick.
        self._resolved_action = {"red": None, "blue": None}
        self._slipped = {"red": False, "blue": False}
        active_before = {
            a: not (self.hazardous and self._agent_done.get(a, False))
            for a in ("red", "blue")
        }
        reward = {
            a: (-STEP_COST if active_before[a] else 0.0)
            for a in ("red", "blue")
        }
        shape = {"red": 0.0, "blue": 0.0}      # collectible reward, for the decomposition
        dead = {"red": None, "blue": None}     # which hazard killed each agent
        warped = {"red": None, "blue": None}   # the warp DESTINATION
        dead_at = {"red": None, "blue": None}  # the tile where it died (before respawn)
        warp_from = {"red": None, "blue": None}  # the pipe ENTRANCE it dived into

        order = self._resolve_order(a_red, a_blue)
        for agent, act in order:
            if not active_before[agent]:
                continue
            self._advance_agent(agent, act, reward, shape, dead, warped,
                                dead_at, warp_from)
        self._dead, self._warped = dead, warped
        self._dead_at, self._warp_from = dead_at, warp_from

        terminal = {"red": 0.0, "blue": 0.0}
        finishers = []
        agent_terminated = {"red": False, "blue": False}
        if self.hazardous:
            # Each racer resolves independently. A terminal racer stays frozen
            # while the other finishes its own trajectory; nobody respawns
            # until reset() begins the next episode.
            new_died = [
                a for a in ("red", "blue")
                if active_before[a] and dead[a]
            ]
            new_reached = [
                a for a in ("red", "blue")
                if active_before[a] and not dead[a] and self._goal_reached(a)
            ]
            for a in new_died:
                self._agent_done[a] = True
                self._agent_outcome[a] = "dead"
                self._episode_died.append(a)
                agent_terminated[a] = True
                terminal[a] += LOSE
                reward[a] += LOSE
            for a in new_reached:
                self._agent_done[a] = True
                self._agent_outcome[a] = "finished"
                self._episode_finishers.append(a)
                self._finish_steps[a] = self.steps
                agent_terminated[a] = True
                terminal[a] += WIN
                reward[a] += WIN

            # The head-to-head WINNER is whoever REACHES the goal first. A death never
            # wins the race for the survivor - it must still reach the goal itself; if
            # nobody reaches (both die / time out), the round is a DRAW. So the result is
            # fixed on the first REACH tick, not on a death. Both reaching at once = draw.
            if not self._race_decided and new_reached:
                self._race_winner = None if len(new_reached) == 2 else new_reached[0]
                self._race_decided = True

            self.done = all(self._agent_done.values())
            if self.done:
                self.winner = self._race_winner
            finishers = list(self._episode_finishers)
            died = list(self._episode_died)
        else:
            # Round 1 / bare engine: first ONTO the goal wins, the other loses, a tie
            # draws (rank goal(2) > alive(1) > dead(0); deaths only exist on 2/3).
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
            self.winner = self._race_winner if self.hazardous else None
        obs = (self.observe("red"), self.observe("blue"))
        return obs, reward, self.done, truncated, {
            "winner": self.winner,
            "finishers": finishers,
            "died": died,
            "agentActiveBefore": active_before,
            "agentTerminated": agent_terminated,
            "agentDone": dict(self._agent_done),
            "finishSteps": dict(self._finish_steps),
        }

    def to_json(self):
        """World descriptor for the viewer (/api/world). Grid rounds delegate to the
        World; the continuous rounds have their own descriptor."""
        return self.world.to_json()

    # --------------------------------------------------------------- snapshot
    def snapshot(self):
        """Live render state for the viewer: the two agents' cells, the step count,
        and the winner (None until someone reaches the goal). The static layout
        rides on /api/world; each arena's override appends its per-frame extras."""
        snap = {
            "red": list(self.red_pos), "blue": list(self.blue_pos),
            "steps": self.steps, "winner": self.winner,
        }
        if self.hazardous:
            self._hazard_snapshot(snap)
        return snap

    def _hazard_snapshot(self, snap):
        """The per-frame FX cues shared by the hazardous rounds (2/3): hazard
        deaths, pipe warps, skids, and each racer's resolved/inactive state, so
        the theme can trigger the death / warp animations and the board can SNAP
        (not slide) a teleported agent."""
        dead = getattr(self, "_dead", {}) or {}
        warped = getattr(self, "_warped", {}) or {}
        dead_at = getattr(self, "_dead_at", {}) or {}
        warp_from = getattr(self, "_warp_from", {}) or {}
        resolved = getattr(self, "_resolved_action", {}) or {}
        slipped = getattr(self, "_slipped", {}) or {}
        for agent, pre in (("red", "red"), ("blue", "blue")):
            snap[pre + "Dead"] = dead.get(agent)                 # "spike"|"plant"|"goomba"|None
            w = warped.get(agent)
            snap[pre + "Warp"] = list(w) if w else None          # warp DESTINATION cell
            da = dead_at.get(agent)
            snap[pre + "DeadAt"] = list(da) if da else None      # the tile it died on
            # the PLANT that ate it (the one whose 8-cell zone the death tile is in), so the
            # theme + char animator can stage the grab / throw / swallow toward that plant.
            if dead.get(agent) == "plant" and da:
                killer = next((list(p) for p in self.plant_cells
                               if max(abs(p[0] - da[0]), abs(p[1] - da[1])) <= 1), None)
                snap[pre + "DeadPlant"] = killer
            else:
                snap[pre + "DeadPlant"] = None
            wf = warp_from.get(agent)
            snap[pre + "WarpFrom"] = list(wf) if wf else None    # the pipe ENTRANCE it dived
            snap[pre + "ResolvedAction"] = resolved.get(agent)
            snap[pre + "Slipped"] = bool(slipped.get(agent, False))
            outcome = getattr(self, "_agent_outcome", {}).get(agent)
            snap[pre + "Inactive"] = outcome == "dead"
            snap[pre + "Done"] = bool(
                getattr(self, "_agent_done", {}).get(agent, False)
            )
            snap[pre + "Resolved"] = outcome
