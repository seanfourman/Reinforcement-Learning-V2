"""Round 1 - Peach's Castle: the "Race to the Power Moon" maze (Every-visit vs
First-visit MC).

A procedurally-generated, MIRROR-SYMMETRIC marble maze on the castle floor. Both
models spawn in the top corners and RACE through the maze to the Power Moon (Shine)
at the bottom-centre; first one there WINS, a simultaneous arrival is a DRAW. The
maze is regenerated from the world SEED, so every seed is a fresh-but-fair contest.
Coins line the corridors as decoration (they do not score - a memoryless tabular
agent can't track collection, so a free-collection game just loops; the SKILL here
is learning the maze route to the Moon faster/better than the rival).

Hard rules that keep every seed sensible:
  * SYMMETRY  - carve the LEFT half, mirror it to the right, connect across the
                centre column -> both spawns face an identical maze, and the Moon sits
                ON the mirror axis, so it is EQUIDISTANT from both (a fair race).
  * SOLVABLE  - the carve is a connected spanning tree (+ centre links + braids),
                and the Moon is force-connected, so every spawn can reach it
                (asserted by ``validate``).
  * CHOICES   - braiding opens extra walls -> loops, so route optimisation (not a
                single forced path) is what separates a good policy from a weak one.

Coordinates are (row, col); the theme camera flips the view, so spawns read bottom.
"""
import random
from collections import deque

from .grid import World, validate, SIZE, WALL, FLOOR, ESCAPE

THEME = "peach"
ROUND_ID = 1
TITLE = "Peach's Castle"

# The RL grid stays SIZE x SIZE (=20; the camera/heatmap assume that); the PLAYABLE
# area is a central BOARD x BOARD (=15) maze, the frame walled off. Maze cells sit at
# even offsets (rows/cols LO, LO+2, ... , HI) with 1-cell walls between them.
BOARD = 15
LO = (SIZE - BOARD) // 2                # 2   first play row/col
HI = LO + BOARD - 1                     # 16  last play row/col
MID = (LO + HI) // 2                    # 9   mirror axis (column) + the Moon's column
CELLS = (BOARD + 1) // 2                # 8   maze cells per row/col
HALF = CELLS // 2                       # 4   left-half cell columns

COINS_PER_SIDE = 11                     # decorative coins per side
BRAID_P = 0.12                          # chance to open a between-floor wall (loops)


def _mirror(c):
    return LO + HI - c                  # column mirror: 2<->16, ..., 9<->9


def _cell(cr, cc):
    return (LO + 2 * cr, LO + 2 * cc)   # maze cell (cr, cc) -> grid position


def generate(seed=None):
    rng = random.Random(seed)
    g = [[WALL] * SIZE for _ in range(SIZE)]

    # --- carve a maze on the LEFT half (cell cols 0..HALF-1) via DFS backtracker --
    seen = set()

    def carve(cr, cc):
        seen.add((cr, cc))
        r, c = _cell(cr, cc)
        g[r][c] = FLOOR
        dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        rng.shuffle(dirs)
        for dr, dc in dirs:
            nr, nc = cr + dr, cc + dc
            if 0 <= nr < CELLS and 0 <= nc < HALF and (nr, nc) not in seen:
                mr, mc = _cell(nr, nc)
                g[(r + mr) // 2][(c + mc) // 2] = FLOOR    # open the wall between
                carve(nr, nc)

    carve(0, 0)                          # start at the red spawn cell (top-left)

    # --- mirror the left half (cols LO..MID-1) onto the right (cols MID+1..HI) -----
    for r in range(SIZE):
        for c in range(LO, MID):
            if g[r][c] == FLOOR:
                g[r][_mirror(c)] = FLOOR

    # --- connect the two halves across the centre column (rows are self-mirroring) -
    links = [r for r in range(LO, HI + 1)
             if g[r][MID - 1] == FLOOR and g[r][MID + 1] == FLOOR]
    for r in (rng.sample(links, min(3, len(links))) if links else []):
        g[r][MID] = FLOOR

    # --- braid: open some walls sitting between two floor cells -> loops (choices) --
    for r in range(LO, HI + 1):
        for c in range(LO, MID):
            if g[r][c] == WALL and (
                    (g[r][c - 1] == FLOOR and g[r][c + 1] == FLOOR) or
                    (g[r - 1][c] == FLOOR and g[r + 1][c] == FLOOR)):
                if rng.random() < BRAID_P:
                    g[r][c] = FLOOR
                    g[r][_mirror(c)] = FLOOR

    # --- spawns (mirror pair) + the Power Moon goal (centre axis -> equidistant) ---
    red_spawn = (LO, LO)                 # top-left cell
    blue_spawn = (LO, HI)               # top-right cell (mirror)
    moon = (HI, MID)                     # bottom-centre, ON the axis: a fair long race
    # guarantee the Moon exists and connects (its neighbours (HI, MID-+1) are carved
    # cells, so opening the axis cell links it into the maze). Marked ESCAPE so the
    # grid itself carries the goal (walkable; env goal = world.escape either way).
    g[moon[0]][moon[1]] = ESCAPE

    # --- decorative coins: a symmetric spread of maze cells (visual flavour only) --
    dist = {red_spawn: 0}
    q = deque([red_spawn])
    while q:
        r, c = q.popleft()
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if g[nr][nc] != WALL and (nr, nc) not in dist:
                dist[(nr, nc)] = dist[(r, c)] + 1
                q.append((nr, nc))
    left_cells = [(r, c) for (r, c) in dist if c < MID and (r, c) != red_spawn
                  and (r - LO) % 2 == 0 and (c - LO) % 2 == 0]
    rng.shuffle(left_cells)
    coin_l = left_cells[:COINS_PER_SIDE]
    coins = [(r, c) for (r, c) in coin_l] + [(r, _mirror(c)) for (r, c) in coin_l]

    world = World(
        g, theme=THEME, round_id=ROUND_ID, title=TITLE, objective="cross",
        red_spawn=red_spawn, blue_spawn=blue_spawn, escape=[moon],
        coins=coins, shine=[moon],
    )
    validate(world)
    return world


if __name__ == "__main__":
    w = generate(seed=1)
    floor = sum(row.count(FLOOR) for row in w.rows())
    print(f"Peach's Castle race maze: {w.H}x{w.W}, {floor} floor cells, "
          f"Moon {w.escape}, {len(w.coins)} decor coins, spawns {w.red_spawn}/{w.blue_spawn}")
    coinset = {tuple(c) for c in w.coins}
    moonset = {tuple(s) for s in w.shine}
    for r, row in enumerate(w.rows()):
        line = ""
        for c, ch in enumerate(row):
            if (r, c) == w.red_spawn:
                line += "R"
            elif (r, c) == w.blue_spawn:
                line += "B"
            elif (r, c) in moonset:
                line += "$"
            elif (r, c) in coinset:
                line += "o"
            else:
                line += ch
        print(line)
