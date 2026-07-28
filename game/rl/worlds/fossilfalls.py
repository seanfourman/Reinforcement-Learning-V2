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
N_GOOMBA_PAIRS = 3                # mirror pairs of Goombas (3 per side -> 6 total) on the paths
PATROL_LEN = 3                    # cells per Goomba patrol - UNIFORM 3 (every guard the same
                                  # length -> one period -> a CONSTANT phase factor). Only
                                  # NATURAL 2-deep branches qualify (a carved pocket can't go
                                  # 2 deep without looping), so some sparse mazes get < 6.
N_WET_PAIRS = 2                   # mirror pairs of WET (skid) cells on the route (variance so
                                  # one racer can fall behind); a skid can slide you sideways


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
    used, goombas = set(avoid), []

    def branch_patrol(P):
        """A UNIFORM length-``max_len`` patrol [P, B, B2] whose guard cell P sits on the
        route and whose tail pokes into an existing OFF-path branch (straight or bent). All
        guards share one length -> one period, so the state's phase factor is CONSTANT. Only
        NATURAL branches: a 1-thick maze can't hold a CARVED 2-deep pocket without a loop the
        agent would use to slip around the guard. None if P has no free 2-deep branch."""
        for dr, dc in rng.sample(ORTHO, len(ORTHO)):
            B = (P[0] + dr, P[1] + dc)
            if not _open(grid, B) or B in pathset or B[1] >= MID or B in used:
                continue
            patrol = [P, B]
            while len(patrol) < max_len:                    # grow the tail into free off-path cells
                tip = patrol[-1]
                nxt = next(((tip[0] + a, tip[1] + b) for a, b in rng.sample(ORTHO, len(ORTHO))
                            if _open(grid, (tip[0] + a, tip[1] + b))
                            and (tip[0] + a, tip[1] + b) not in pathset
                            and (tip[0] + a, tip[1] + b)[1] < MID
                            and (tip[0] + a, tip[1] + b) not in used
                            and (tip[0] + a, tip[1] + b) not in patrol), None)
                if nxt is None:
                    break
                patrol.append(nxt)
            if len(patrol) == max_len:                      # only accept the FULL length
                return patrol
        return None

    def try_place(P):
        if P in used or P[1] >= MID:
            return
        patrol = branch_patrol(P)
        if patrol is None:
            return
        mirror = [(r, W - 1 - c) for (r, c) in patrol]
        if any(cell in used for cell in patrol + mirror):
            return
        phase = rng.randrange(2 * (len(patrol) - 1))
        goombas.append({"cells": patrol, "phase0": phase})
        goombas.append({"cells": mirror, "phase0": phase})
        used.update(patrol)
        used.update(mirror)

    # Goombas ONLY guard real JUNCTIONS on the racer's route (a path cell with an off-path
    # branch to duck into) - never off-route corridors the agent never visits, which would
    # just be pointless hazards. Place up to n_pairs per side on whatever junctions the
    # route offers; only fall short of 3 when the maze genuinely has fewer junctions.
    on_path = path[3:-3]                                  # skip cells hugging the spawn / exit
    rng.shuffle(on_path)
    for P in on_path:
        if len(goombas) >= 2 * n_pairs:
            break
        try_place(P)
    return goombas


def _place_cage(grid, rng, path, occupied):
    """Blue's cage pickup + Red's mirror. It must be a real DETOUR well past the spawn (not
    a spawn-side freebie) yet still learnable by tabular TD - which means a ONE-cell step-off
    the route (2+ cells off is never explored). To get one at a chosen spot we CARVE a tiny
    dead-end NOOK off a MID-route path cell (and its mirror): a single cell walled on its
    other three sides, so it adds only the pickup pocket - the unique route and the 1-thick
    walls are untouched. A carved dead-end is a strong exploration target, so the agents learn
    the detour even DEEP in the maze (verified 200/200 at spawn-dist 14-22). Mutates ``grid``."""
    from collections import deque
    pathset = set(path)

    def bfs(seeds):
        dist = {c: 0 for c in seeds}
        q = deque(seeds)
        while q:
            cur = q.popleft()
            for dr, dc in ORTHO:
                nb = (cur[0] + dr, cur[1] + dc)
                if 0 <= nb[0] < H and 0 <= nb[1] < MID and grid[nb[0]][nb[1]] != WALL and nb not in dist:
                    dist[nb] = dist[cur] + 1
                    q.append(nb)
        return dist

    d_spawn = bfs([BLUE_SPAWN_POS])
    plen = len(path) or 1

    def is_wall(c):
        return 0 <= c[0] < H and 0 <= c[1] < W and grid[c[0]][c[1]] == WALL

    def nook_off(P):
        # a wall neighbour B of P (interior, left half) whose OTHER three neighbours are all
        # walls: carving it opens a pure dead-end alcove - no loop, route + walls unchanged.
        for dr, dc in rng.sample(ORTHO, len(ORTHO)):
            B = (P[0] + dr, P[1] + dc)
            if not is_wall(B) or not (0 < B[1] < MID) or B in occupied:
                continue
            if all(is_wall((B[0] + a, B[1] + b)) for a, b in ORTHO if (B[0] + a, B[1] + b) != P):
                return B
        return None

    # Prefer a nook in the MIDDLE stretch of the route - physically away from the spawn
    # corner, a true mid-race detour (not just a few steps in). Widen only if none there.
    half = plen // 2
    for lo_hi in ((plen // 4, 3 * plen // 4), (4, plen - 3)):
        mids = [P for P in path if lo_hi[0] <= d_spawn.get(P, 10 ** 9) <= lo_hi[1] and 0 < P[1] < MID]
        rng.shuffle(mids)
        mids.sort(key=lambda P: abs(d_spawn.get(P, 0) - half))    # closest to the route's MIDDLE
        for P in mids:
            B = nook_off(P)
            if B:
                grid[B[0]][B[1]] = FLOOR                         # carve the nook + its mirror
                grid[B[0]][W - 1 - B[1]] = FLOOR
                return B, (B[0], W - 1 - B[1])
    # fallback (rare, no nook anywhere): an existing 1-off cell nearest the route's middle.
    d_path = bfs([Q for Q in path if Q[1] < MID])
    off = [(c, d_spawn.get(c, 10 ** 9)) for c, dp in d_path.items()
           if dp == 1 and c not in pathset and c not in occupied and 3 <= d_spawn.get(c, 10 ** 9) <= plen - 3]
    if not off:
        return None, None
    rng.shuffle(off)
    off.sort(key=lambda x: abs(x[1] - half))                     # nearest to the route's middle
    blue = off[0][0]
    return blue, (blue[0], W - 1 - blue[1])


def _place_wet(grid, rng, path, avoid, n_pairs, before_idx):
    """Wet cells on the route, strictly BEFORE the cage (path index < before_idx). Order
    matters: you must slip on a puddle and fall behind FIRST, and THEN reach the cage and
    grab it - if the puddle came after the cage the two mechanics wouldn't connect. A skid
    sends you sideways = the variance that makes one racer fall behind. Left half, spread
    out, clear of ``avoid`` (goombas + neighbours so a skid can't shove you onto one, plus
    the cage / exit / spawn). Mirrored."""
    lo, hi = 3, max(4, before_idx - 1)
    cands = [P for P in path[lo:hi] if 0 < P[1] < MID and P not in avoid]
    rng.shuffle(cands)
    wet, left = [], []
    for P in cands:
        if len(left) >= n_pairs:
            break
        if any(abs(P[0] - q[0]) + abs(P[1] - q[1]) < 3 for q in left):
            continue                                 # keep the puddles spread along the route
        left.append(P)
        wet.append(P)
        wet.append((P[0], W - 1 - P[1]))             # mirror
    return wet


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

    # Cage pickups: OFF-path detours (per-agent, mirror-symmetric). Grabbing YOUR cage
    # drops it on the RIVAL. Placed clear of goomba patrols + the funnel.
    gcells = {c for gb in goombas for c in gb["cells"]}
    blue_path = _path(grid, BLUE_SPAWN_POS, EXIT)
    blue_cage, red_cage = _place_cage(grid, rng, blue_path, avoid | gcells)

    # WET cells on the route BEFORE the cage (skid -> fall behind -> THEN reach the cage).
    # Keep them off the goombas AND their neighbours (a skid must not shove you onto a
    # Goomba) and off the cage / exit / spawn.
    gzone = gcells | {(c[0] + dr, c[1] + dc) for c in gcells for dr, dc in ORTHO}
    wet_avoid = avoid | gzone | {c for c in (blue_cage, red_cage) if c}
    blue_path = _path(grid, BLUE_SPAWN_POS, EXIT)     # recompute (cage carved nooks)
    pathset = set(blue_path)
    cage_adj = next((n for n in _open_neighbors(grid, blue_cage) if n in pathset), None) if blue_cage else None
    cage_idx = blue_path.index(cage_adj) if cage_adj in pathset else len(blue_path) // 2
    wet = _place_wet(grid, rng, blue_path, wet_avoid, N_WET_PAIRS, cage_idx)

    world = World(
        grid, theme=THEME, round_id=ROUND_ID, title=TITLE, objective="cross",
        red_spawn=RED_SPAWN_POS, blue_spawn=BLUE_SPAWN_POS, escape=[EXIT],
        goombas=goombas, bridge=bridge, slip=wet,
        blue_cage=[blue_cage] if blue_cage else None,
        red_cage=[red_cage] if red_cage else None,
    )
    validate(world)                              # the maze is connected: both spawns reach the exit
    return world


if __name__ == "__main__":
    w = generate(0)
    print(f"fossil falls: {w.H}x{w.W}, goal {w.escape}, spawns R{w.red_spawn}/B{w.blue_spawn}, "
          f"{len(w.goombas)} goombas, bridge {w.bridge}")
    for row in w.rows():
        print(row)
