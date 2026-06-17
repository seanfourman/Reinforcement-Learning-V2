"""Round 1 — the FIXED, hand-designed medieval castle (model KNOWN + slippery).

One curated 20x20 layout (NOT regenerated — pressing R only resets the models).

  rows  0-11 : shared UPPER HALL — escape gate top-centre, gold pedestal, and a
               mirror-symmetric maze. The central treasure chamber is ICY: those
               tiles are SLIPPERY (a move may slide orthogonally), which is what
               makes this the "model known" Dynamic-Programming room.
  row   12   : the wall between hall and the bottom, with TWO key-locked exit doors.
  rows 13-19 : the BOTTOM — a shared LIVING ROOM in the centre where both agents
               start, and on EACH side a little MAZE OF TWO CONNECTED ROOMS: step
               from the living room into the OUTER room, cross into the INNER room,
               grab your colored key. Furniture BLOCKS like wall.

Flow per agent: living room -> outer room -> inner room -> your colored key -> back
-> your key-locked exit door -> hall -> gold key -> escape. First out wins.
"""

import random

from .grid import (
    World, validate, SIZE, ORTHO,
    WALL, FLOOR, ESCAPE, RED_KEY, BLUE_KEY, RED_DOOR, BLUE_DOOR,
    GOLD_HOME, RED_SPAWN, BLUE_SPAWN, GOLD_TRAP,
)

THEME = "medieval"
ROUND_ID = 1
TITLE = "The Castle"

DIVIDER_ROW = 12
RED_SPAWN_POS, BLUE_SPAWN_POS = (19, 7), (19, 12)
RED_KEY_POS, BLUE_KEY_POS = (14, 3), (14, 16)
RED_DOOR_POS, BLUE_DOOR_POS = (12, 8), (12, 11)        # key-locked exits to the hall

# left side: inner room B (rows 13-15) above outer room A (rows 17-19), cols 0-4,
# inner wall col 5; door A<->living at (18,5); door B<->A at (16,2). Mirrored right.
ROOM_DOORS = [(18, 5), (16, 2), (18, 14), (16, 17)]    # contact-open

# left-side furniture (mirrored to the right), as (cell, type, rot). rot is a
# quarter-turn the renderer applies: 0=faces SOUTH(+row), 1=EAST, 2=NORTH, 3=WEST.
FURN_LEFT = [
    ((13, 0), "bed", 0), ((13, 1), "chest", 0), ((13, 4), "wardrobe", 0),   # inner room B
    ((18, 1), "table", 0), ((19, 1), "chair", 2), ((19, 4), "bookshelf", 2),  # outer room A
]
# The shared central hall, furnished symmetrically about col 9.5.
FURN_LIVING = [
    ((14, 9), "piano", 0), ((14, 10), "block", 0),          # grand piano (spans 9-10)
    ((13, 6), "bookshelf", 0), ((13, 7), "bookshelf", 0),   # library shelves (left)
    ((13, 12), "bookshelf", 0), ((13, 13), "bookshelf", 0), # library shelves (right)
    ((17, 9), "sofa", 2), ((17, 10), "sofa", 2),            # two-seat sofa facing the piano
    ((16, 6), "armchair", 1), ((16, 13), "armchair", 3),    # armchairs by the shelves
    ((14, 6), "lamp", 0), ((14, 13), "lamp", 0),            # solid standing lamps (corners)
    ((19, 6), "lamp", 0), ((19, 13), "lamp", 0),
]

ESCAPE_POS = [(0, 9), (0, 10)]
MAZE_SEED = 5                # fixed, so the maze is identical on every load
GOLD_CELL = (6, 9)          # gold hides in the central chamber (rendered dead-centre)
SLIP_PROB = 0.2             # icy chamber: 20% chance a move slides orthogonally


def _carve_top_maze(g, rng):
    """A single-thickness maze filling the upper arena (rows 1-11), MIRROR-
    symmetric about the centre so the two agents face an identical maze."""
    for r in range(0, DIVIDER_ROW):
        for c in range(SIZE):
            g[r][c] = WALL
    R0, R1, C0, C1 = 1, 11, 1, 9
    for r in range(R0, R1 + 1, 2):
        for c in range(C0, C1 + 1, 2):
            g[r][c] = FLOOR
    start = (R1, C0)
    seen, stack = {start}, [start]
    while stack:
        r, c = stack[-1]
        nbrs = [(r + dr, c + dc, dr, dc)
                for dr, dc in ((-2, 0), (2, 0), (0, -2), (0, 2))
                if R0 <= r + dr <= R1 and C0 <= c + dc <= C1 and (r + dr, c + dc) not in seen]
        if not nbrs:
            stack.pop()
            continue
        nr, nc, dr, dc = rng.choice(nbrs)
        g[r + dr // 2][c + dc // 2] = FLOOR
        seen.add((nr, nc))
        stack.append((nr, nc))
    g[1][9] = FLOOR      # escape throat -> mirrors to (1, 10)
    g[11][8] = FLOOR     # red-door neck -> mirrors to (11, 11) for the blue door
    for r in range(0, DIVIDER_ROW):
        for c in range(10):
            g[r][19 - c] = g[r][c]
    for c in range(SIZE):
        g[0][c] = FLOOR
    for r in range(DIVIDER_ROW):
        g[r][0] = FLOOR
        g[r][SIZE - 1] = FLOOR
    for r in range(5, 8):
        for c in range(8, 12):
            g[r][c] = FLOOR
    for (r, c) in ESCAPE_POS:
        g[r][c] = ESCAPE


def _maze_path(g, start, goal):
    """Shortest cell path start..goal over the maze (rows 0-11), or [] if none."""
    prev = {start: None}
    from collections import deque
    q = deque([start])
    while q:
        cur = q.popleft()
        if cur == goal:
            break
        for dr, dc in ORTHO:
            nxt = (cur[0] + dr, cur[1] + dc)
            if 0 <= nxt[0] < DIVIDER_ROW and 0 <= nxt[1] < SIZE and nxt not in prev and g[nxt[0]][nxt[1]] != WALL:
                prev[nxt] = cur
                q.append(nxt)
    if goal not in prev:
        return []
    path, cur = [], goal
    while cur is not None:
        path.append(cur)
        cur = prev[cur]
    return path[::-1]


def _place_gold(g):
    """Set the gold pedestal. R1 is the MODEL-KNOWN Dynamic-Programming room, so it
    carries NO unmodeled hazards (the gold drop-trap would sit on the only
    gold->escape corridor and trap a DP carrier in an infinite re-fetch loop —
    DP can only solve what its known model contains). Hazards return in the
    learning rounds (R2+)."""
    gold = GOLD_CELL
    g[gold[0]][gold[1]] = GOLD_HOME
    return gold


def _icy_chamber_cells(g):
    """The treasure-chamber floor (rows 5-7, cols 8-11) minus the gold/trap tiles
    is slippery — guaranteed-FLOOR, central, and visible. This is the room's
    'known-but-stochastic' transition model that Dynamic Programming exploits."""
    slip = []
    for r in range(5, 8):
        for c in range(8, 12):
            if g[r][c] == FLOOR:
                slip.append((r, c))
    return slip


def _build():
    g = [[FLOOR] * SIZE for _ in range(SIZE)]
    furniture = []

    for c in range(SIZE):
        g[DIVIDER_ROW][c] = WALL
    g[RED_DOOR_POS[0]][RED_DOOR_POS[1]] = RED_DOOR
    g[BLUE_DOOR_POS[0]][BLUE_DOOR_POS[1]] = BLUE_DOOR

    for r in range(13, 20):
        g[r][5] = WALL
        g[r][14] = WALL
    for c in range(0, 6):
        g[16][c] = WALL
    for c in range(14, 20):
        g[16][c] = WALL
    for (r, c) in ROOM_DOORS:
        g[r][c] = FLOOR

    def block(r, c):
        g[r][c] = WALL
    for (cell, t, rot) in FURN_LEFT:
        block(*cell)
        block(cell[0], 19 - cell[1])
    for (cell, t, rot) in FURN_LIVING:
        block(*cell)

    g[RED_KEY_POS[0]][RED_KEY_POS[1]] = RED_KEY
    g[BLUE_KEY_POS[0]][BLUE_KEY_POS[1]] = BLUE_KEY
    g[RED_SPAWN_POS[0]][RED_SPAWN_POS[1]] = RED_SPAWN
    g[BLUE_SPAWN_POS[0]][BLUE_SPAWN_POS[1]] = BLUE_SPAWN
    for (r, c) in [(13, 8), (13, 11)]:           # step up to each exit door
        g[r][c] = FLOOR

    _carve_top_maze(g, random.Random(MAZE_SEED))
    gold_home = _place_gold(g)
    slip_cells = _icy_chamber_cells(g)

    for (cell, t, rot) in FURN_LEFT:
        furniture.append({"cell": [cell[0], cell[1]], "type": t, "rot": rot})
        furniture.append({"cell": [cell[0], 19 - cell[1]], "type": t, "rot": rot})
    for (cell, t, rot) in FURN_LIVING:
        furniture.append({"cell": [cell[0], cell[1]], "type": t, "rot": rot})

    return World(
        g, theme=THEME, round_id=ROUND_ID, title=TITLE,
        red_spawn=RED_SPAWN_POS, blue_spawn=BLUE_SPAWN_POS,
        red_key=RED_KEY_POS, blue_key=BLUE_KEY_POS,
        red_door=RED_DOOR_POS, blue_door=BLUE_DOOR_POS,
        gold_home=gold_home, escape=ESCAPE_POS,
        furniture=furniture, room_doors=ROOM_DOORS, drop_traps=[],
        slip_cells=slip_cells, slip_prob=SLIP_PROB, seed=MAZE_SEED,
    )


def generate(seed=None):
    world = _build()
    validate(world)
    return world


if __name__ == "__main__":
    w = generate()
    print(f"medieval castle: {len(w.furniture)} furniture, {len(w.slip_cells)} icy cells")
    for row in w.rows():
        print(row)
