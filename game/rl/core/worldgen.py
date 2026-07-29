"""Shared grid-world primitives: tile alphabet, the ``World`` data container,
and a generic reachability validator.

A ``World`` is a pure data object describing one round's static layout: the tile
grid, the spawns and goal (escape) tiles, the slippery cells, and the per-round
**theme**. The live grid env reads these; the browser reads ``to_json()`` to
build the themed 3D scene.

Each grid round's GENERATOR lives in its arena package
(``arenas/<round>/world.py``) and returns a ``World`` built from these
primitives; ``core/registry.py`` maps round ids to those modules.

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
                 spikes=None, plants=None, pipes=None,
                 red_stars=None, blue_stars=None,
                 hedge_cells=None, goombas=None, bridge=None,
                 red_cage=None, blue_cage=None, plate_puzzles=None):
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
        # Round-2 game layout (New Donk City): shared hazards. ``spikes`` kill
        # on entry; a ``plant`` attacks its eight surrounding cells. ``pipes`` are warps,
        # each ``{"entry": (r,c), "dests": [(r,c), ...]}`` (entering warps to a
        # uniformly-random dest). Empty on every other round.
        self.spikes = [tuple(s) for s in (spikes or [])]
        self.plants = [tuple(p) for p in (plants or [])]
        self.pipes = [{"entry": tuple(p["entry"]),
                       "dests": [tuple(d) for d in p["dests"]],
                       "weights": [float(w) for w in p["weights"]] if p.get("weights") else None,
                       "exit": tuple(p["exit"]) if p.get("exit") else None,
                       # Optional Round-2 progression lock: bit index of the
                       # tomato that must be held before this pipe activates.
                       "requiresStar": int(p["requiresStar"])
                       if p.get("requiresStar") is not None else None}
                      for p in (pipes or [])]
        # Round-2 PER-AGENT tomatoes (mirror pairs); progression Pipes and the
        # eventual goal can require the corresponding collected bits.
        self.red_stars = [tuple(s) for s in (red_stars or [])]
        self.blue_stars = [tuple(s) for s in (blue_stars or [])]
        # Optional theme hints used by New Donk City. They only control which
        # impassable cells receive shrub geometry; collision still comes
        # exclusively from ``grid``.
        self.hedge_cells = [tuple(c) for c in (hedge_cells or [])]
        # Round-3 (Fossil Falls): patrolling Goombas + a single-file bridge. Each
        # goomba is {"cells": [(r,c), ...], "phase0": int} and walks its cell list
        # back and forth deterministically. ``bridge`` cells are the choke where the
        # live rival can block you. Empty on every other round.
        self.goombas = [{"cells": [tuple(c) for c in gb["cells"]],
                         "phase0": int(gb.get("phase0", 0))}
                        for gb in (goombas or [])]
        self.bridge = [tuple(b) for b in (bridge or [])]
        # Round-3 CAGE pickups (per-agent, mirror pair). Stepping on YOUR cage cell
        # drops a cage on the RIVAL, freezing it for a few steps. Off the main path, so
        # taking it is a deliberate detour. Empty on every other round.
        self.red_cage = [tuple(c) for c in (red_cage or [])]
        self.blue_cage = [tuple(c) for c in (blue_cage or [])]
        # Round-3 PRESSURE-PLATE puzzles (mirror pairs). Each is a {door, plate, boulder}:
        # the DOOR is a carved secret-shortcut cell that stays SEALED until the BOULDER is
        # pushed onto the PLATE, which holds it open for the rest of the episode.
        self.plate_puzzles = [{"door": tuple(p["door"]), "plate": tuple(p["plate"]),
                               "boulder": tuple(p["boulder"])}
                              for p in (plate_puzzles or [])]

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
            "redSpawn": list(self.red_spawn),
            "blueSpawn": list(self.blue_spawn),
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
                       "dests": [list(d) for d in p["dests"]],
                       "weights": list(p["weights"]) if p.get("weights") else None,
                       "exit": list(p["exit"]) if p.get("exit") else None,
                       "requiresStar": p.get("requiresStar")}
                      for p in self.pipes],
            # Round-2 PER-AGENT tomatoes (mirror pairs) - collect three, then reach goal.
            "redStars": [list(s) for s in self.red_stars],
            "blueStars": [list(s) for s in self.blue_stars],
            "hedgeCells": [list(c) for c in self.hedge_cells],
            # Round-3 patrolling Goombas (cell lists) + the single-file bridge cells.
            "goombas": [{"cells": [list(c) for c in gb["cells"]], "phase0": gb["phase0"]}
                        for gb in self.goombas],
            "bridge": [list(b) for b in self.bridge],
            # Round-3 cage pickups (per agent), rendered as freeze-coin icons.
            "redCage": [list(c) for c in self.red_cage],
            "blueCage": [list(c) for c in self.blue_cage],
            # Round-3 pressure-plate puzzles: push a boulder onto a plate to open a secret door.
            "platePuzzles": [{"door": list(p["door"]), "plate": list(p["plate"]),
                              "boulder": list(p["boulder"])} for p in self.plate_puzzles],
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
    # A Piranha Plant attacks all eight surrounding cells, not its own cell.
    plant_zone = {
        (r + dr, c + dc)
        for r, c in plants
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if (dr or dc)
        and 0 <= r + dr < H
        and 0 <= c + dc < W
    }
    lethal = set(spikes) | plant_zone
    # Pipe teleport edges work in both directions between each visible pair.
    warp = {}
    for p in world.pipes:
        entry = tuple(p["entry"])
        dests = [tuple(d) for d in p["dests"]]
        warp.setdefault(entry, []).extend(dests)
        for dest in dests:
            warp.setdefault(dest, []).append(entry)

    def passable(r, c):
        return 0 <= r < H and 0 <= c < W and g[r][c] != WALL

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
