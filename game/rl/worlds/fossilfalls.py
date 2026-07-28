"""Round 3 - Fossil Falls / Cascade Kingdom (SARSA vs Q-Learning).

A RANDOM PERFECT MAZE filling the whole 19x19 arena. Walls are exactly ONE cell
thick: the classic odd-coordinate maze - passage cells sit on the odd (row, col),
the even rows/cols are 1-thick wall spines opened only where the carver stepped
across. A recursive-backtracker carve links every cell by a single winding path,
so there are no open plazas and never two rock rows side by side.

Both racers start at the BOTTOM corners (bottom-left / bottom-right) and hunt for
the one EXIT at the top centre. A few Goombas patrol straight corridors as moving
hazards (stepping onto one is death). The maze is FIXED for a round and reshuffles
only on "New World", so tabular SARSA / Q-Learning learn the fixed layout.

Coordinates are (row, col), row 0 = NORTH (exit), row H-1 = SOUTH (spawns).
"""

import random

from .grid import (
    World, validate, ORTHO,
    WALL, FLOOR, ESCAPE, RED_SPAWN, BLUE_SPAWN,
)

THEME = "fossilfalls"
ROUND_ID = 3
TITLE = "Fossil Falls"

H = W = 19
EXIT = (1, W // 2)                # top-centre goal (row 1, col 9)
BLUE_SPAWN_POS = (H - 2, 1)       # bottom-LEFT corner cell  (17, 1)
RED_SPAWN_POS = (H - 2, W - 2)    # bottom-RIGHT corner cell (17, 17)
N_GOOMBAS = 3                     # moving hazards on straight corridors
PATROL_LEN = 3                    # cells per Goomba patrol (a passage-wall-passage run)


def _carve_maze(rng):
    """Recursive-backtracker perfect maze. Passage cells sit on odd (r, c); the
    even rows/cols are 1-thick wall spines, opened only where the carve stepped
    across. The outer border stays solid. Returns the grid of tiles."""
    grid = [[WALL] * W for _ in range(H)]
    grid[1][1] = FLOOR
    stack = [(1, 1)]
    while stack:
        r, c = stack[-1]
        nbrs = [(r + dr, c + dc, dr, dc)
                for dr, dc in ((-2, 0), (2, 0), (0, -2), (0, 2))
                if 1 <= r + dr < H - 1 and 1 <= c + dc < W - 1
                and grid[r + dr][c + dc] == WALL]
        if not nbrs:
            stack.pop()
            continue
        nr, nc, dr, dc = rng.choice(nbrs)
        grid[r + dr // 2][c + dc // 2] = FLOOR   # knock out the wall between the two cells
        grid[nr][nc] = FLOOR
        stack.append((nr, nc))
    return grid


def _open_neighbors(grid, cell):
    r, c = cell
    return [(r + dr, c + dc) for dr, dc in ORTHO
            if 0 <= r + dr < H and 0 <= c + dc < W and grid[r + dr][c + dc] != WALL]


def _straight_segments(grid, length):
    """Every maximal horizontal/vertical run of open cells, sliced into windows of
    exactly ``length`` consecutive cells (candidate Goomba patrols)."""
    windows = []

    def scan(cells):
        run = []
        for cell in cells + [None]:
            if cell is not None and grid[cell[0]][cell[1]] != WALL:
                run.append(cell)
            else:
                for i in range(len(run) - length + 1):
                    windows.append(run[i:i + length])
                run = []

    for r in range(H):
        scan([(r, c) for c in range(W)])
    for c in range(W):
        scan([(r, c) for r in range(H)])
    return windows


def _place_goombas(grid, rng, avoid, n, length):
    """Drop ``n`` Goombas on distinct, non-overlapping straight corridors, keeping
    clear of the spawns / exit / goal funnel (``avoid``)."""
    windows = _straight_segments(grid, length)
    rng.shuffle(windows)
    used, goombas = set(avoid), []
    for win in windows:
        if len(goombas) >= n:
            break
        if any(cell in used for cell in win):
            continue
        period = 2 * (length - 1)
        goombas.append({"cells": win, "phase0": rng.randrange(period)})
        used.update(win)
    return goombas


def generate(seed=None, **_):
    rng = random.Random(seed)
    grid = _carve_maze(rng)

    grid[EXIT[0]][EXIT[1]] = ESCAPE
    grid[BLUE_SPAWN_POS[0]][BLUE_SPAWN_POS[1]] = BLUE_SPAWN
    grid[RED_SPAWN_POS[0]][RED_SPAWN_POS[1]] = RED_SPAWN

    # the open cells feeding the goal are the single-file funnel the live rival can block
    bridge = _open_neighbors(grid, EXIT)
    avoid = {EXIT, BLUE_SPAWN_POS, RED_SPAWN_POS, *bridge}
    goombas = _place_goombas(grid, rng, avoid, N_GOOMBAS, PATROL_LEN)

    world = World(
        grid, theme=THEME, round_id=ROUND_ID, title=TITLE, objective="cross",
        red_spawn=RED_SPAWN_POS, blue_spawn=BLUE_SPAWN_POS, escape=[EXIT],
        goombas=goombas, bridge=bridge,
    )
    validate(world)                              # the maze is connected: both spawns reach the exit
    return world


if __name__ == "__main__":
    w = generate(0)
    print(f"fossil falls: {w.H}x{w.W}, goal {w.escape}, spawns R{w.red_spawn}/B{w.blue_spawn}, "
          f"{len(w.goombas)} goombas, bridge {w.bridge}")
    for row in w.rows():
        print(row)
