"""Round 3 - Fossil Falls / Cascade Kingdom (SARSA vs Q-Learning).

A RANDOM PERFECT MAZE filling the whole 19x19 arena, EDGE TO EDGE. There is NO rock
border ring - the corridors run right up to the arena boundary and the board edge
(off the board = impassable) IS the outer wall. Passage cells sit on the EVEN
(row, col) - including 0 and 18, so every edge is playable - and the odd rows/cols
are 1-thick wall spines opened only where the carve stepped across. A recursive-
backtracker links every cell by a single winding path: no open plazas, never two
rock rows side by side.

Both racers start at the BOTTOM corners (bottom-left / bottom-right) and hunt for
the one EXIT on the top edge, dead centre. A few Goombas patrol straight corridors
as moving hazards (stepping onto one is death). The maze is FIXED for a round and
reshuffles only on "New World", so tabular SARSA / Q-Learning learn the fixed layout.

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
EXIT = (0, W // 2)                # top-EDGE goal, centre column (0, 9)
BLUE_SPAWN_POS = (H - 1, 0)       # bottom-LEFT corner  (18, 0)
RED_SPAWN_POS = (H - 1, W - 1)    # bottom-RIGHT corner (18, 18)
N_GOOMBA_PAIRS = 2                # mirror pairs of Goombas (up to 2*this total) on the paths
PATROL_LEN = 3                    # cells per Goomba patrol (a passage-wall-passage run)


MID = W // 2                     # 9: the left-right mirror axis (a wall column)


def _carve_maze(rng):
    """MIRROR-SYMMETRIC recursive-backtracker maze. We carve a perfect maze over the
    LEFT half only (even cells in cols 0..MID-1, reaching every left/top/bottom edge)
    then reflect it onto the right (col -> W-1-col). The centre column MID stays wall
    except where ``generate`` opens the shared top-edge exit, so the two halves are
    exact mirror images and the two corner racers face identical path lengths."""
    grid = [[WALL] * W for _ in range(H)]
    grid[0][0] = FLOOR
    stack = [(0, 0)]
    while stack:
        r, c = stack[-1]
        nbrs = [(r + dr, c + dc, dr, dc)
                for dr, dc in ((-2, 0), (2, 0), (0, -2), (0, 2))
                if 0 <= r + dr < H and 0 <= c + dc < MID   # stay strictly LEFT of the axis
                and grid[r + dr][c + dc] == WALL]
        if not nbrs:
            stack.pop()
            continue
        nr, nc, dr, dc = rng.choice(nbrs)
        grid[r + dr // 2][c + dc // 2] = FLOOR   # knock out the wall between the two cells
        grid[nr][nc] = FLOOR
        stack.append((nr, nc))
    for r in range(H):                           # reflect the left half onto the right
        for c in range(MID):
            grid[r][W - 1 - c] = grid[r][c]
    return grid


def _path(grid, start, goal):
    """Shortest passable path start->goal (BFS). In a perfect maze it's THE unique route."""
    from collections import deque
    prev = {tuple(start): None}
    q = deque([tuple(start)])
    while q:
        cur = q.popleft()
        if cur == tuple(goal):
            break
        for dr, dc in ORTHO:
            nb = (cur[0] + dr, cur[1] + dc)
            if (0 <= nb[0] < H and 0 <= nb[1] < W
                    and grid[nb[0]][nb[1]] != WALL and nb not in prev):
                prev[nb] = cur
                q.append(nb)
    if tuple(goal) not in prev:
        return []
    out, cur = [], tuple(goal)
    while cur is not None:
        out.append(cur)
        cur = prev[cur]
    return out[::-1]


def _open(grid, cell):
    r, c = cell
    return 0 <= r < H and 0 <= c < W and grid[r][c] != WALL


def _open_neighbors(grid, cell):
    return [n for n in ((cell[0] + dr, cell[1] + dc) for dr, dc in ORTHO) if _open(grid, n)]


def _place_goombas(grid, rng, avoid, n_pairs, max_len):
    """Place each Goomba as a SENTRY that guards ONE cell of the racer's route from an
    off-route SIDE BRANCH: its patrol is [P, B, (B2)] where P is on the path and B/B2
    poke into a dead branch. The Goomba oscillates in and out, so P (the cell the agent
    MUST pass) is clear part of every cycle - with a STAY action the agent waits for the
    gap and steps through in one tick, never a swap (P's path-neighbours aren't patrolled).

    A patrol placed straight ALONG the corridor instead would sweep the whole run and be
    an uncrossable death-trap, so we deliberately branch OFF the path. Each left-half
    sentry is MIRRORED onto the right so both racers face an identical, fair puzzle."""
    path = _path(grid, BLUE_SPAWN_POS, EXIT)
    pathset = set(path)
    cands = []
    for P in path[3:-3]:                             # skip cells hugging the spawn / exit
        if P[1] >= MID or P in avoid:
            continue
        for dr, dc in ORTHO:
            B = (P[0] + dr, P[1] + dc)               # a branch cell OFF the path
            if not _open(grid, B) or B in pathset or B[1] >= MID:
                continue
            patrol = [P, B]
            B2 = (B[0] + dr, B[1] + dc)              # extend the branch one more (gentler timing)
            if len(patrol) < max_len and _open(grid, B2) and B2 not in pathset and B2[1] < MID:
                patrol.append(B2)
            cands.append(patrol)
    rng.shuffle(cands)
    used, goombas = set(avoid), []
    for patrol in cands:
        if len(goombas) >= 2 * n_pairs:
            break
        mirror = [(r, W - 1 - c) for (r, c) in patrol]
        if any(cell in used for cell in patrol + mirror):
            continue
        phase = rng.randrange(2 * (len(patrol) - 1))
        goombas.append({"cells": patrol, "phase0": phase})
        goombas.append({"cells": mirror, "phase0": phase})
        used.update(patrol)
        used.update(mirror)
    return goombas


def generate(seed=None, **_):
    rng = random.Random(seed)
    grid = _carve_maze(rng)

    # EXIT sits on an ODD (wall-spine) column of the top edge; stamping it ESCAPE opens
    # it, joining its two even neighbours so it's a centred, fair goal for both corners.
    grid[EXIT[0]][EXIT[1]] = ESCAPE
    grid[BLUE_SPAWN_POS[0]][BLUE_SPAWN_POS[1]] = BLUE_SPAWN
    grid[RED_SPAWN_POS[0]][RED_SPAWN_POS[1]] = RED_SPAWN

    # the open cells feeding the goal are the single-file funnel the live rival can block
    bridge = _open_neighbors(grid, EXIT)
    avoid = {EXIT, BLUE_SPAWN_POS, RED_SPAWN_POS, *bridge}
    goombas = _place_goombas(grid, rng, avoid, N_GOOMBA_PAIRS, PATROL_LEN)

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
