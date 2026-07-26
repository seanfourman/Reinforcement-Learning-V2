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

    ``objective`` picks the game: ``"cross"`` (reach the goal tile, skeleton) or
    ``"coinrush"`` (collect the most value in a time limit). Coin-rush rounds carry
    ``coins`` and ``shine`` (the Power Moon) cells instead of an ``escape`` goal.

    Round 1's real game carries a richer static layout: PER-AGENT scoring coins and
    "?" power-up blocks (Red's + Blue's, mirror-symmetric so the race stays fair),
    and a shared set of ``slip`` (icy, stochastic) cells. These stay empty on every
    other round, so the env's rich dynamics are gated on their presence."""

    def __init__(self, grid, *, theme="peach", round_id=1, title="",
                 red_spawn, blue_spawn, escape, objective="cross",
                 coins=None, shine=None,
                 red_coins=None, blue_coins=None,
                 red_blocks=None, blue_blocks=None, slip=None):
        self.grid = grid
        self.H, self.W = len(grid), len(grid[0])
        self.theme = theme
        self.round_id = round_id
        self.title = title
        self.objective = objective
        self.red_spawn, self.blue_spawn = tuple(red_spawn), tuple(blue_spawn)
        self.escape = [tuple(e) for e in escape]
        self.coins = [tuple(c) for c in (coins or [])]
        self.shine = [tuple(s) for s in (shine or [])]
        # Round-1 game layout: per-agent collectibles (mirror pairs) + shared ice.
        self.red_coins = [tuple(c) for c in (red_coins or [])]
        self.blue_coins = [tuple(c) for c in (blue_coins or [])]
        self.red_blocks = [tuple(b) for b in (red_blocks or [])]
        self.blue_blocks = [tuple(b) for b in (blue_blocks or [])]
        self.slip = [tuple(s) for s in (slip or [])]

    def rows(self):
        return ["".join(r) for r in self.grid]

    def to_json(self):
        # only the fields the browser's themed scenes actually read. ``slipCells``
        # carries the Round-1 icy cells (empty elsewhere); the per-agent coin/block
        # sets ride alongside so the peach theme can render + tint them per side.
        return {
            "theme": self.theme, "roundId": self.round_id, "title": self.title,
            "objective": self.objective,
            "rows": self.rows(),
            "escape": [list(e) for e in self.escape],
            "coins": [list(c) for c in self.coins],
            "shine": [list(s) for s in self.shine],
            "slipCells": [list(s) for s in self.slip],
            "redCoins": [list(c) for c in self.red_coins],
            "blueCoins": [list(c) for c in self.blue_coins],
            "redBlocks": [list(b) for b in self.red_blocks],
            "blueBlocks": [list(b) for b in self.blue_blocks],
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
