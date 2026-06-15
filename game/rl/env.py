"""Two-agent competitive grid world — the RL environment.

Fixed, hand-authored 20x20 world (see world.txt). No procedural generation,
nothing random in the layout. Standard library only.

Coordinates are (row, col) with row 0 at the NORTH (top of the screen, where
the castle gate / escape sits) and row 19 at the SOUTH. col 0 is WEST.

The task is identical for both agents (that's the point — same task, they
compete):

  1. Pick up YOUR colored key, which sits in YOUR room. The room's exit door
     is locked until you hold it. The two rooms are physically sealed from each
     other, so a colored key can never be stolen (matches the design rule).
  2. Leave your room into the shared ARENA up north.
  3. Get the single GOLD key. It is the only stealable key: step onto whoever
     holds it and you take it. Two teleporter pads can yank it across the arena.
  4. Reach the escape gate (top centre) while holding the gold key. First one
     out WINS; the other LOSES. Only one gold key exists, so only one can win.

Each agent only observes its own cell, its own key flag, where the gold key is
(coarsely), and a COARSE fact about the rival: which of the three regions
(its room / the rival's room / the arena) the rival is currently in.
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
WORLD_PATH = os.path.join(HERE, "world.txt")

# --- tile characters -------------------------------------------------------
WALL = "#"
FLOOR = "."
ESCAPE = "E"
RED_KEY = "r"
BLUE_KEY = "b"
GOLD_HOME = "G"
PAD1 = "1"
PAD2 = "2"
ALT_A = "a"
ALT_C = "c"
RED_DOOR = "D"
BLUE_DOOR = "d"
RED_SPAWN = "R"
BLUE_SPAWN = "B"

# --- actions: N, S, W, E (no "stay"; walking into a wall keeps you put) -----
ACTIONS = [(-1, 0), (1, 0), (0, -1), (0, 1)]
N_ACTIONS = len(ACTIONS)

# --- regions (for the coarse opponent observation) -------------------------
REGION_RED, REGION_BLUE, REGION_ARENA = 0, 1, 2
N_REGIONS = 3

# --- reward shaping ---------------------------------------------------------
STEP_COST = 0.01     # small per-step cost -> finish quickly, don't dither
KEY_BONUS = 0.10     # one-time: picked up your own colored key
GOLD_BONUS = 0.30    # one-time per episode: first time you hold the gold key
WIN = 1.0
LOSE = -1.0
MAX_STEPS = 400  # mazes make the optimal chain longer


def load_grid(path=WORLD_PATH):
    with open(path) as f:
        rows = [line.rstrip("\n") for line in f]
    rows = [r for r in rows if r != ""]
    h = len(rows)
    w = len(rows[0])
    for i, r in enumerate(rows):
        if len(r) != w:
            raise ValueError(f"world.txt row {i} is {len(r)} wide, expected {w}")
    return rows, h, w


class GridWorld:
    def __init__(self, path=WORLD_PATH):
        self.grid, self.H, self.W = load_grid(path)

        # locate every special tile
        self.escape_cells = []
        self.pos = {}  # single-occurrence tiles -> (r, c)
        self.floor_cells = []  # every non-wall cell, in scan order
        for r in range(self.H):
            for c in range(self.W):
                t = self.grid[r][c]
                if t == WALL:
                    continue
                self.floor_cells.append((r, c))
                if t == ESCAPE:
                    self.escape_cells.append((r, c))
                elif t in (RED_KEY, BLUE_KEY, GOLD_HOME, PAD1, PAD2,
                           ALT_A, ALT_C, RED_DOOR, BLUE_DOOR, RED_SPAWN, BLUE_SPAWN):
                    self.pos[t] = (r, c)

        self.cell_index = {cell: i for i, cell in enumerate(self.floor_cells)}
        self.n_cells = len(self.floor_cells)

        # pad -> where it teleports the gold key
        self.pad_target = {self.pos[PAD1]: self.pos[ALT_A],
                           self.pos[PAD2]: self.pos[ALT_C]}

        self.validate()

    # ------------------------------------------------------------------ tiles
    def region_of(self, r, c):
        if r <= 10:
            return REGION_ARENA          # rows 0-9 arena + row 10 door line
        return REGION_RED if c <= 8 else REGION_BLUE

    def is_wall(self, r, c):
        return (not (0 <= r < self.H and 0 <= c < self.W)) or self.grid[r][c] == WALL

    def passable(self, agent, r, c, red_key, blue_key):
        """Can `agent` step onto (r, c) given current key possession?"""
        if not (0 <= r < self.H and 0 <= c < self.W):
            return False
        t = self.grid[r][c]
        if t == WALL:
            return False
        if t == RED_DOOR:
            return agent == "red" and red_key
        if t == BLUE_DOOR:
            return agent == "blue" and blue_key
        return True

    # ------------------------------------------------------------------ reset
    def reset(self):
        self.red_pos = self.pos[RED_SPAWN]
        self.blue_pos = self.pos[BLUE_SPAWN]
        self.red_key = False
        self.blue_key = False
        self.gold_holder = None              # None | "red" | "blue"
        self.gold_pos = self.pos[GOLD_HOME]   # valid only while gold_holder is None
        self.red_got_gold = False
        self.blue_got_gold = False
        self.steps = 0
        self.done = False
        self.winner = None
        return self.observe("red"), self.observe("blue")

    # ------------------------------------------------------------ observation
    def observe(self, agent):
        if agent == "red":
            r, c = self.red_pos
            has_key = self.red_key
            other = self.blue_pos
        else:
            r, c = self.blue_pos
            has_key = self.blue_key
            other = self.red_pos

        if self.gold_holder == agent:
            gold_loc = 4                       # I hold it
        elif self.gold_holder is not None:
            gold_loc = 3                       # rival holds it
        elif self.gold_pos == self.pos[ALT_A]:
            gold_loc = 1
        elif self.gold_pos == self.pos[ALT_C]:
            gold_loc = 2
        else:
            gold_loc = 0                       # at home (or unspecified ground)

        opp_region = self.region_of(*other)
        return (self.cell_index[(r, c)], int(has_key), gold_loc, opp_region)

    # ------------------------------------------------------------------- step
    def _move(self, agent, pos, action):
        dr, dc = ACTIONS[action]
        nr, nc = pos[0] + dr, pos[1] + dc
        if self.passable(agent, nr, nc, self.red_key, self.blue_key):
            return (nr, nc)
        return pos

    def step(self, a_red, a_blue):
        if self.done:
            raise RuntimeError("step() called on a finished episode")
        self.steps += 1
        reward = {"red": -STEP_COST, "blue": -STEP_COST}

        # 1) both move simultaneously (co-occupancy allowed)
        self.red_pos = self._move("red", self.red_pos, a_red)
        self.blue_pos = self._move("blue", self.blue_pos, a_blue)

        # 2) teleporter pads yank the gold key (denial tool). Resolved before
        #    pickups so an agent can't pad-and-grab in the same tick.
        for pos in (self.red_pos, self.blue_pos):
            if pos in self.pad_target:
                self.gold_holder = None
                self.gold_pos = self.pad_target[pos]

        # 3) colored keys (one-time, never contested)
        if not self.red_key and self.red_pos == self.pos[RED_KEY]:
            self.red_key = True
            reward["red"] += KEY_BONUS
        if not self.blue_key and self.blue_pos == self.pos[BLUE_KEY]:
            self.blue_key = True
            reward["blue"] += KEY_BONUS

        # 4) gold key pickup / steal
        if self.gold_holder is None:
            on_red = self.red_pos == self.gold_pos
            on_blue = self.blue_pos == self.gold_pos
            if on_red or on_blue:
                # tie on the same cell -> red picks up (deterministic)
                self.gold_holder = "red" if on_red else "blue"
                self.gold_pos = None
        else:
            holder = self.gold_holder
            thief = "blue" if holder == "red" else "red"
            if self._pos(thief) == self._pos(holder):
                self.gold_holder = thief       # contact steal

        # one-time gold bonus
        if self.gold_holder == "red" and not self.red_got_gold:
            self.red_got_gold = True
            reward["red"] += GOLD_BONUS
        elif self.gold_holder == "blue" and not self.blue_got_gold:
            self.blue_got_gold = True
            reward["blue"] += GOLD_BONUS

        # 5) escape: holding gold AND standing on the gate -> win
        for agent in ("red", "blue"):
            if self.gold_holder == agent and self._pos(agent) in self.escape_cells:
                self.done = True
                self.winner = agent
                loser = "blue" if agent == "red" else "red"
                reward[agent] += WIN
                reward[loser] += LOSE
                break

        if not self.done and self.steps >= MAX_STEPS:
            self.done = True
            self.winner = None  # draw / timeout

        return ((self.observe("red"), self.observe("blue")),
                reward, self.done, self.winner)

    def _pos(self, agent):
        return self.red_pos if agent == "red" else self.blue_pos

    # --------------------------------------------------------------- validate
    def _reach(self, start, agent, red_key, blue_key):
        seen = {start}
        stack = [start]
        while stack:
            r, c = stack.pop()
            for dr, dc in ACTIONS:
                nr, nc = r + dr, c + dc
                if (nr, nc) in seen:
                    continue
                if self.passable(agent, nr, nc, red_key, blue_key):
                    seen.add((nr, nc))
                    stack.append((nr, nc))
        return seen

    def validate(self):
        """Assert the hand-drawn map is actually playable for both agents."""
        problems = []
        for agent, spawn, key, door in (
            ("red", self.pos[RED_SPAWN], self.pos[RED_KEY], RED_DOOR),
            ("blue", self.pos[BLUE_SPAWN], self.pos[BLUE_KEY], BLUE_DOOR),
        ):
            # before the key: must be able to reach the colored key (doors shut)
            shut = self._reach(spawn, agent, False, False)
            if key not in shut:
                problems.append(f"{agent}: cannot reach its colored key from spawn")
            # with the key: must reach the arena's contested tiles + escape
            rk = agent == "red"
            bk = agent == "blue"
            opened = self._reach(spawn, agent, rk, bk)
            need = {
                "gold home": self.pos[GOLD_HOME],
                "pad1": self.pos[PAD1], "pad2": self.pos[PAD2],
                "alt A": self.pos[ALT_A], "alt C": self.pos[ALT_C],
            }
            for name, cell in need.items():
                if cell not in opened:
                    problems.append(f"{agent}: cannot reach {name}")
            if not any(e in opened for e in self.escape_cells):
                problems.append(f"{agent}: cannot reach the escape gate")
            # the rooms must stay sealed from each other
            other_key = self.pos[BLUE_KEY] if agent == "red" else self.pos[RED_KEY]
            if other_key in opened:
                problems.append(f"{agent}: can reach the RIVAL's colored key (rooms not sealed)")
        if problems:
            raise ValueError("world.txt is not playable:\n  " + "\n  ".join(problems))


if __name__ == "__main__":
    env = GridWorld()
    print(f"World OK: {env.H}x{env.W}, {env.n_cells} walkable cells.")
    print(f"  red spawn {env.pos[RED_SPAWN]}  red key {env.pos[RED_KEY]}  red door {env.pos[RED_DOOR]}")
    print(f"  blue spawn {env.pos[BLUE_SPAWN]}  blue key {env.pos[BLUE_KEY]}  blue door {env.pos[BLUE_DOOR]}")
    print(f"  gold home {env.pos[GOLD_HOME]}  pads {env.pos[PAD1]},{env.pos[PAD2]}  alts {env.pos[ALT_A]},{env.pos[ALT_C]}")
    print(f"  escape {env.escape_cells}")
    # rough state-space size per agent
    size = env.n_cells * 2 * 5 * N_REGIONS
    print(f"  state space per agent: {env.n_cells} cells x 2 x 5 x {N_REGIONS} = {size} states x {N_ACTIONS} actions")
