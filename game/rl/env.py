"""Two-agent grid world - the live RL environment (Gymnasium API).

SKELETON round (no real game yet): each agent heads from its spawn to the goal
tile; first one there WINS, a simultaneous arrival is a DRAW. Deterministic moves,
no hazards, no reward shaping - a bare navigate-to-goal shell that each round's real
game will be built on top of.

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

# --- rewards (skeleton: step cost + terminal only, no shaping) ---------------
STEP_COST = 0.01
WIN = 1.0
LOSE = -1.0
MAX_STEPS = 400


class GridWorld(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, seed=None, round_id=1):
        super().__init__()
        self._seed = seed
        self.round_id = round_id
        self.max_steps = MAX_STEPS      # per-episode step cap (tunable from the panel)
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
        # per-episode reward decomposition (terminal / shaping / other) per agent.
        # shaping is 0 on the skeleton, kept so the diagnostic breakdown still renders.
        self.ep_parts = {"red": {"terminal": 0.0, "shape": 0.0, "other": 0.0},
                         "blue": {"terminal": 0.0, "shape": 0.0, "other": 0.0}}
        obs = (self.observe("red"), self.observe("blue"))
        return obs, {}

    def _accum_parts(self, reward, terminal):
        """Fold this step's reward into the per-episode decomposition: terminal
        (win/lose) and other (step cost). No shaping on the skeleton."""
        for a in ("red", "blue"):
            p = self.ep_parts[a]
            t = terminal.get(a, 0.0)
            p["terminal"] += t
            p["other"] += reward[a] - t

    # ------------------------------------------------------------ observation
    def observe(self, agent):
        # each agent is an independent single-agent navigator; its state is simply
        # its cell index (a 1-tuple, so it stays a stable Q-table key).
        pos = self.red_pos if agent == "red" else self.blue_pos
        return (self.cell_index[pos],)

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
        mask = [False] * self.n_actions
        for a in MOVE_ACTIONS:
            if self._resolve(agent, pos, a) != pos:
                mask[a] = True
        if not any(mask):
            mask = [True] * self.n_actions
        return mask

    def _move(self, agent, pos, action):
        """Deterministic grid move (stays put if blocked)."""
        if action not in MOVE_ACTIONS:
            return pos
        return self._resolve(agent, pos, action)

    def step(self, a_red, a_blue):
        """One step: both agents move; first onto a goal cell wins, a simultaneous
        arrival is a draw."""
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        reward = {"red": -STEP_COST, "blue": -STEP_COST}

        self.red_pos = self._move("red", self.red_pos, a_red)
        self.blue_pos = self._move("blue", self.blue_pos, a_blue)

        # reach the goal -> win; both crossing on the SAME step is a genuine DRAW
        # (equidistant spawns make a symmetric deterministic race tie every time).
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

        self._accum_parts(reward, terminal)

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
        and the winner (None until someone reaches the goal)."""
        return {
            "red": list(self.red_pos), "blue": list(self.blue_pos),
            "steps": self.steps, "winner": self.winner,
        }


if __name__ == "__main__":
    env = GridWorld(seed=1)
    env.reset()
    print(f"World OK: {env.H}x{env.W}, {env.n_cells} walkable cells.")
    print(f"  obs(red) = {env.observe('red')}")
