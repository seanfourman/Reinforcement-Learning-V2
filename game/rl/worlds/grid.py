"""Shared grid-world core: tile alphabet, the ``World`` data container, and a
generic reachability validator.

A ``World`` is a pure data object describing one round's static layout: the tile
grid, the spawns/keys/doors/gold/escape positions, furniture render-list, the
optional mechanics (mirrors/levers/traps/ladders), and the per-round **theme** +
**slippery cells**. The live env (`env.py`) reads these; the browser reads
``to_json()`` to build the themed 3D scene.

Each themed round lives in its own module under ``worlds/`` and returns a
``World``. ``worldgen.py`` re-exports this module so the historical
``import worldgen`` / ``from worldgen import WALL, ...`` imports keep working.

Coordinates are (row, col), row 0 = NORTH (escape), row H-1 = SOUTH (spawns).
"""

from collections import deque

SIZE = 20

# --- tile alphabet (shared by every grid round) -----------------------------
WALL, FLOOR, ESCAPE = "#", ".", "E"
RED_KEY, BLUE_KEY = "r", "b"
RED_DOOR, BLUE_DOOR = "D", "d"
GOLD_HOME = "G"
RED_SPAWN, BLUE_SPAWN = "R", "B"
GOLD_TRAP = "X"            # step here holding the gold and it drops back home

ORTHO = [(-1, 0), (1, 0), (0, -1), (0, 1)]


class World:
    """One round's static layout. Positions are (row, col) tuples.

    The mechanics lists (``mirrors``/``levers``/``traps``/``ladders``) default to
    empty and are filled in by the per-round builder if that round uses them.
    ``slip_cells`` are the icy/windy tiles where a move may slip orthogonally;
    ``slip_prob`` is the per-slip-cell slip chance the env applies.
    """

    def __init__(self, grid, *, theme="medieval", round_id=1, title="",
                 red_spawn, blue_spawn, red_key, blue_key, red_door, blue_door,
                 gold_home, escape, furniture=None, room_doors=None,
                 drop_traps=None, slip_cells=None, slip_prob=0.0, seed=1,
                 objective="race"):
        self.grid = grid
        self.H, self.W = len(grid), len(grid[0])
        self.theme = theme
        self.round_id = round_id
        self.title = title
        self.seed = seed
        # "race" = the key->gold->escape contest; "cross" = a Cliff-Walking
        # traverse (start -> goal across a manhole cliff), used by Round 2.
        self.objective = objective
        self.red_spawn, self.blue_spawn = tuple(red_spawn), tuple(blue_spawn)
        self.red_key, self.blue_key = tuple(red_key), tuple(blue_key)
        self.red_door, self.blue_door = tuple(red_door), tuple(blue_door)
        self.gold_home = tuple(gold_home)
        self.escape = [tuple(e) for e in escape]
        self.furniture = furniture or []
        self.room_doors = [list(c) for c in (room_doors or [])]
        self.drop_traps = [tuple(c) for c in (drop_traps or [])]
        self.slip_cells = [tuple(c) for c in (slip_cells or [])]
        self.slip_prob = slip_prob
        # optional mechanics, populated by the builder
        self.mirrors = []
        self.levers = []
        self.traps = []
        self.ladders = []

    def rows(self):
        return ["".join(r) for r in self.grid]

    def to_json(self):
        return {
            "theme": self.theme, "roundId": self.round_id, "title": self.title,
            "objective": self.objective,
            "rows": self.rows(), "seed": self.seed,
            "redSpawn": list(self.red_spawn), "blueSpawn": list(self.blue_spawn),
            "redKey": list(self.red_key), "blueKey": list(self.blue_key),
            "redDoor": list(self.red_door), "blueDoor": list(self.blue_door),
            "roomDoors": [list(c) for c in self.room_doors],
            "goldHome": list(self.gold_home),
            "dropTraps": [list(c) for c in self.drop_traps],
            "escape": [list(e) for e in self.escape],
            "slipCells": [list(c) for c in self.slip_cells],
            "slipProb": self.slip_prob,
            "furniture": self.furniture,
            "mirrors": [[list(a), list(b)] for a, b in self.mirrors],
            "levers": [list(c) for c in self.levers],
            "traps": [list(c) for c in self.traps],
            "ladders": [[list(a), list(b)] for a, b in self.ladders],
        }


def validate(world):
    """Generic reachability check: each agent can reach its colored key, then
    (door now open) the gold, then an escape tile. Raises on an unsolvable map.

    For a "cross" world (Cliff Walking) the check is simpler: each spawn must
    have a SAFE path to a goal cell — one that never steps on a manhole — so the
    cautious policy always has somewhere to go."""
    g, H, W = world.grid, world.H, world.W

    if getattr(world, "objective", "race") == "cross":
        cliffs = {tuple(c) for c in world.drop_traps}
        goals = {tuple(e) for e in world.escape}

        def reach_safe(start):
            seen, stack = {tuple(start)}, [tuple(start)]
            while stack:
                r, c = stack.pop()
                for dr, dc in ORTHO:
                    nr, nc = r + dr, c + dc
                    if not (0 <= nr < H and 0 <= nc < W) or (nr, nc) in seen:
                        continue
                    if g[nr][nc] == WALL or (nr, nc) in cliffs:
                        continue
                    seen.add((nr, nc))
                    stack.append((nr, nc))
            return seen

        problems = []
        for name, spawn in (("red", world.red_spawn), ("blue", world.blue_spawn)):
            if not (reach_safe(spawn) & goals):
                problems.append(f"{name}: no safe (manhole-free) path to the goal")
        if problems:
            raise ValueError("world invalid:\n  " + "\n  ".join(problems))
        return

    def reach(start, agent, red_key, blue_key):
        seen, stack = {tuple(start)}, [tuple(start)]
        while stack:
            r, c = stack.pop()
            for dr, dc in ORTHO:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < H and 0 <= nc < W) or (nr, nc) in seen:
                    continue
                t = g[nr][nc]
                if t == WALL:
                    continue
                if t == RED_DOOR and not (agent == "red" and red_key):
                    continue
                if t == BLUE_DOOR and not (agent == "blue" and blue_key):
                    continue
                seen.add((nr, nc))
                stack.append((nr, nc))
        return seen

    problems = []
    for agent, spawn, key in (("red", world.red_spawn, world.red_key),
                              ("blue", world.blue_spawn, world.blue_key)):
        if tuple(key) not in reach(spawn, agent, False, False):
            problems.append(f"{agent}: cannot reach its colored key")
        opened = reach(spawn, agent, agent == "red", agent == "blue")
        if tuple(world.gold_home) not in opened:
            problems.append(f"{agent}: cannot reach the gold")
        if not any(tuple(e) in opened for e in world.escape):
            problems.append(f"{agent}: cannot reach the escape")
    if problems:
        raise ValueError("world invalid:\n  " + "\n  ".join(problems))
