"""Shared grid-world core: tile alphabet, the ``World`` data container, and a
generic reachability validator.

A ``World`` is a pure data object describing one round's static layout: the tile
grid, the spawns and goal (escape) tiles, the slippery cells, and the per-round
**theme**. The live env (`env.py`) reads these; the browser reads ``to_json()`` to
build the themed 3D scene.

Each themed round lives in its own module under ``worlds/`` and returns a
``World``. ``worldgen.py`` re-exports this module so the historical
``import worldgen`` / ``from worldgen import WALL, ...`` imports keep working.

Coordinates are (row, col), row 0 = NORTH (escape), row H-1 = SOUTH (spawns).
"""

SIZE = 20

# --- tile alphabet (shared by every grid round) -----------------------------
WALL, FLOOR, ESCAPE = "#", ".", "E"
RED_SPAWN, BLUE_SPAWN = "R", "B"

ORTHO = [(-1, 0), (1, 0), (0, -1), (0, 1)]


class World:
    """One round's static layout. Positions are (row, col) tuples.

    ``slip_cells`` are the icy/windy tiles where a move may slip perpendicularly
    (the slip PROBABILITY is the env-level ``slip_ctrl``, panel-driven, not
    per-world).
    """

    def __init__(self, grid, *, theme="peach", round_id=1, title="",
                 red_spawn, blue_spawn, escape,
                 slip_cells=None, objective="cross", shape_w=None):
        self.grid = grid
        self.H, self.W = len(grid), len(grid[0])
        self.theme = theme
        self.round_id = round_id
        self.title = title
        self.objective = objective
        self.red_spawn, self.blue_spawn = tuple(red_spawn), tuple(blue_spawn)
        self.escape = [tuple(e) for e in escape]
        self.slip_cells = [tuple(c) for c in (slip_cells or [])]
        # per-round reward-shaping weight. None -> the env default (SHAPE_W). Set to
        # 0 for a SPARSE round (reward only at the goal) - e.g. the Dyna round, where
        # sparse rewards are what make model-based PLANNING visibly outrun plain
        # learning (dense shaping would already do the value-propagation for free).
        self.shape_w = shape_w

    def rows(self):
        return ["".join(r) for r in self.grid]

    def to_json(self):
        # only the fields the browser's themed scenes actually read
        return {
            "theme": self.theme, "roundId": self.round_id, "title": self.title,
            "objective": self.objective,
            "rows": self.rows(),
            "escape": [list(e) for e in self.escape],
            "slipCells": [list(c) for c in self.slip_cells],
        }


def validate(world):
    """Reachability check: each spawn must have a path to a goal tile. Raises on an
    unsolvable map."""
    g, H, W = world.grid, world.H, world.W
    goals = {tuple(e) for e in world.escape}

    def reach(start):
        seen, stack = {tuple(start)}, [tuple(start)]
        while stack:
            r, c = stack.pop()
            for dr, dc in ORTHO:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < H and 0 <= nc < W) or (nr, nc) in seen:
                    continue
                if g[nr][nc] == WALL:
                    continue
                seen.add((nr, nc))
                stack.append((nr, nc))
        return seen

    problems = []
    for name, spawn in (("red", world.red_spawn), ("blue", world.blue_spawn)):
        if not (reach(spawn) & goals):
            problems.append(f"{name}: cannot reach the goal")
    if problems:
        raise ValueError("world invalid:\n  " + "\n  ".join(problems))
