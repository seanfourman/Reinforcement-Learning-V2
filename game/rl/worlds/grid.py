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

    ``objective`` is ``"cross"`` for every grid round (reach the goal tile). Round 1
    additionally carries per-agent ``coins`` / ``*_blocks`` and ``slip`` cells + the
    ``shine`` (Power Moon) marker on top of the ``escape`` goal (see env.py).

    Round 1's real game carries a richer static layout: PER-AGENT scoring coins and
    "?" power-up blocks (Red's + Blue's, mirror-symmetric so the race stays fair),
    and a shared set of ``slip`` (icy, stochastic) cells. These stay empty on every
    other round, so the env's rich dynamics are gated on their presence."""

    def __init__(self, grid, *, theme="peach", round_id=1, title="",
                 red_spawn, blue_spawn, escape, objective="cross",
                 coins=None, shine=None,
                 red_coins=None, blue_coins=None,
                 red_blocks=None, blue_blocks=None, slip=None,
                 spikes=None, plants=None, pipes=None):
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
        # Round-2 game layout (New Donk City): shared hazards. ``spikes`` are floor
        # cells that KILL on entry; ``plants`` are impassable piranha cells whose
        # orthogonal floor neighbours kill on entry; ``pipes`` are stochastic warps,
        # each ``{"entry": (r,c), "dests": [(r,c), ...]}`` (entering warps to a
        # uniformly-random dest). Empty on every other round.
        self.spikes = [tuple(s) for s in (spikes or [])]
        self.plants = [tuple(p) for p in (plants or [])]
        self.pipes = [{"entry": tuple(p["entry"]),
                       "dests": [tuple(d) for d in p["dests"]]}
                      for p in (pipes or [])]

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
            # Round-2 hazards (empty elsewhere): spike traps, piranha plants, warp pipes.
            "spikes": [list(s) for s in self.spikes],
            "plants": [list(p) for p in self.plants],
            "pipes": [{"entry": list(p["entry"]),
                       "dests": [list(d) for d in p["dests"]]}
                      for p in self.pipes],
        }


def validate(world):
    """Reachability check: each spawn must have a path to a goal tile, staying ALIVE.
    Hazard-aware (Round 2): spike cells and piranha-adjacent cells are lethal, so a
    safe path may not cross them; a warp pipe adds teleport edges from its entry to
    every destination. Raises on an unsolvable map."""
    g, H, W = world.grid, world.H, world.W
    goals = {tuple(e) for e in world.escape}
    spikes = set(world.spikes)
    plants = set(world.plants)
    # cells that kill on entry: spike tiles + every floor tile orthogonally next to a plant
    lethal = set(spikes)
    for (pr, pc) in plants:
        for dr, dc in ORTHO:
            nr, nc = pr + dr, pc + dc
            if 0 <= nr < H and 0 <= nc < W and g[nr][nc] != WALL:
                lethal.add((nr, nc))
    # pipe teleport edges: entry -> each destination (entering a pipe is always safe)
    warp = {}
    for p in world.pipes:
        warp.setdefault(tuple(p["entry"]), []).extend(tuple(d) for d in p["dests"])

    def passable(r, c):
        return 0 <= r < H and 0 <= c < W and g[r][c] != WALL and (r, c) not in plants

    def reach(start):
        seen, stack = {tuple(start)}, [tuple(start)]
        while stack:
            cell = stack.pop()
            nbrs = [(cell[0] + dr, cell[1] + dc) for dr, dc in ORTHO]
            nbrs += warp.get(cell, [])                     # a pipe warps onward
            for (nr, nc) in nbrs:
                if (nr, nc) in seen or not passable(nr, nc):
                    continue
                if (nr, nc) in lethal and (nr, nc) not in goals:
                    continue                                # a safe path avoids death
                seen.add((nr, nc))
                stack.append((nr, nc))
        return seen

    problems = []
    for name, spawn in (("red", world.red_spawn), ("blue", world.blue_spawn)):
        if not (reach(spawn) & goals):
            problems.append(f"{name}: cannot reach the goal alive")
    if problems:
        raise ValueError("world invalid:\n  " + "\n  ".join(problems))
