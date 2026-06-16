"""The FIXED, hand-designed castle world for the RL arena.

One curated 20x20 layout (NOT regenerated — pressing R only resets the models).

  rows  0-11 : shared UPPER HALL — escape gate top-centre, gold pedestal, and the
               mechanics (mirrors / lever / trap / ladder). (Redesigned next.)
  row   12   : the wall between hall and the bottom, with TWO key-locked exit doors.
  rows 13-19 : the BOTTOM — a shared LIVING ROOM in the centre where both agents
               start, and on EACH side a little MAZE OF TWO CONNECTED ROOMS: you
               step from the living room into the OUTER room, cross it into the
               INNER room, and grab your colored key there. Furniture (bed + bedside
               chest, wardrobe, desk + chair, bookshelf) is arranged logically and
               BLOCKS like wall.

Flow per agent: living room -> outer room -> inner room -> your colored key -> back
-> your key-locked exit door -> hall -> gold key -> escape. First out wins.

Every blocked cell is '#': the env's wall logic is unchanged. Furniture cells are
listed (with type + facing) in ``World.furniture``; contact-open room doors in
``World.room_doors``; the key-locked exit doors are the 'D'/'d' tiles.

Coordinates are (row, col), row 0 = NORTH (escape), row 19 = SOUTH.
"""

import random

SIZE = 20

WALL, FLOOR, ESCAPE = "#", ".", "E"
RED_KEY, BLUE_KEY = "r", "b"
RED_DOOR, BLUE_DOOR = "D", "d"
GOLD_HOME = "G"
RED_SPAWN, BLUE_SPAWN = "R", "B"
ORTHO = [(-1, 0), (1, 0), (0, -1), (0, 1)]

DIVIDER_ROW = 12
RED_SPAWN_POS, BLUE_SPAWN_POS = (19, 7), (19, 12)
RED_KEY_POS, BLUE_KEY_POS = (14, 3), (14, 16)
RED_DOOR_POS, BLUE_DOOR_POS = (12, 8), (12, 11)        # key-locked exits to the hall

# left side: inner room B (rows 13-15) above outer room A (rows 17-19), cols 0-4,
# inner wall col 5; door A<->living at (18,5); door B<->A at (16,2). Mirrored right.
ROOM_DOORS = [(18, 5), (16, 2), (18, 14), (16, 17)]    # contact-open

# left-side furniture (mirrored to the right), as (cell, type, rot). rot is a
# quarter-turn the renderer applies: 0=faces SOUTH(+row), 1=EAST, 2=NORTH, 3=WEST.
# Placed logically: bed + bedside chest + wardrobe against the back wall (inner
# room, facing into it); a desk with its CHAIR facing it, and a bookshelf (outer).
FURN_LEFT = [
    ((13, 0), "bed", 0), ((13, 1), "chest", 0), ((13, 4), "wardrobe", 0),   # inner room B
    ((18, 1), "table", 0), ((19, 1), "chair", 2), ((19, 4), "bookshelf", 2),  # outer room A
]
# The shared central hall is furnished as a SYMMETRIC obstacle room the agents
# weave through to leave: a grand piano centrepiece, library shelves, a sofa and
# armchairs. "block" cells are invisible space-fillers under the wide piano.
# Everything is mirrored about col 9.5 so both sides start identically.
FURN_LIVING = [
    ((14, 9), "piano", 0), ((14, 10), "block", 0),          # grand piano (spans 9-10)
    ((13, 6), "bookshelf", 0), ((13, 7), "bookshelf", 0),   # library shelves (left)
    ((13, 12), "bookshelf", 0), ((13, 13), "bookshelf", 0), # library shelves (right)
    ((17, 9), "sofa", 2), ((17, 10), "sofa", 2),            # two-seat sofa facing the piano
    ((16, 6), "armchair", 1), ((16, 13), "armchair", 3),    # armchairs by the shelves
]

ESCAPE_POS = [(0, 9), (0, 10)]
MAZE_SEED = 5                # fixed, so the maze is identical on every load
GOLD_TRAP = "X"             # step here holding the gold and it drops back home
GOLD_CELL = (6, 9)          # gold hides in the central chamber (rendered dead-centre)


class World:
    def __init__(self, grid, furniture, room_doors, gold_home, drop_traps, seed=1):
        self.grid = grid
        self.furniture = furniture
        self.room_doors = room_doors
        self.seed = seed
        self.H, self.W = len(grid), len(grid[0])
        self.red_spawn, self.blue_spawn = RED_SPAWN_POS, BLUE_SPAWN_POS
        self.red_door, self.blue_door = RED_DOOR_POS, BLUE_DOOR_POS
        self.gold_home = gold_home
        self.drop_traps = drop_traps
        self.escape = list(ESCAPE_POS)
        self.red_key, self.blue_key = RED_KEY_POS, BLUE_KEY_POS
        self.mirrors = []
        self.levers = []
        self.traps = []
        self.ladders = []

    def rows(self):
        return ["".join(r) for r in self.grid]

    def to_json(self):
        return {
            "rows": self.rows(), "seed": self.seed,
            "redSpawn": list(self.red_spawn), "blueSpawn": list(self.blue_spawn),
            "redKey": list(self.red_key), "blueKey": list(self.blue_key),
            "redDoor": list(self.red_door), "blueDoor": list(self.blue_door),
            "roomDoors": [list(c) for c in self.room_doors],
            "goldHome": list(self.gold_home),
            "dropTraps": [list(c) for c in self.drop_traps],
            "escape": [list(e) for e in self.escape],
            "furniture": self.furniture,
            "mirrors": [[list(a), list(b)] for a, b in self.mirrors],
            "levers": [list(c) for c in self.levers],
            "traps": [list(c) for c in self.traps],
            "ladders": [[list(a), list(b)] for a, b in self.ladders],
        }


def _carve_top_maze(g, rng):
    """A single-thickness maze filling the upper arena (rows 1-11), MIRROR-
    symmetric about the centre so the two agents face an identical maze. The
    outer edge is left OPEN (a thin perimeter aisle) so the castle's own wall is
    the boundary — no redundant inner wall ring, no thick border."""
    # seal the top solid, then carve corridors back out of the LEFT half only
    for r in range(0, DIVIDER_ROW):
        for c in range(SIZE):
            g[r][c] = WALL
    R0, R1, C0, C1 = 1, 11, 1, 9              # left-half cells sit on the odd coords
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
    # necks carved BEFORE mirroring, so the mirror makes the matching opposite one
    g[1][9] = FLOOR      # escape throat -> mirrors to (1, 10)
    g[11][8] = FLOOR     # red-door neck -> mirrors to (11, 11) for the blue door
    # mirror the left half (cols 0-9) onto the right half (cols 10-19)
    for r in range(0, DIVIDER_ROW):
        for c in range(10):
            g[r][19 - c] = g[r][c]
    # open the whole perimeter: the CASTLE wall now bounds the maze (no extra wall)
    for c in range(SIZE):
        g[0][c] = FLOOR
    for r in range(DIVIDER_ROW):
        g[r][0] = FLOOR
        g[r][SIZE - 1] = FLOOR
    # a small symmetric chamber at the dead centre that hides the gold
    for r in range(5, 8):
        for c in range(8, 12):
            g[r][c] = FLOOR
    for (r, c) in ESCAPE_POS:
        g[r][c] = ESCAPE


def _maze_dist(g, start):
    """BFS step-distances from `start` over the maze (rows 0-11, walls block)."""
    from collections import deque
    seen = {start: 0}
    q = deque([start])
    while q:
        r, c = q.popleft()
        for dr, dc in ORTHO:
            nr, nc = r + dr, c + dc
            if 0 <= nr < DIVIDER_ROW and 0 <= nc < SIZE and (nr, nc) not in seen and g[nr][nc] != WALL:
                seen[(nr, nc)] = seen[(r, c)] + 1
                q.append((nr, nc))
    return seen


def _maze_path(g, start, goal):
    """Shortest cell path start..goal over the maze (inclusive), or [] if none."""
    from collections import deque
    prev = {start: None}
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


def _place_gold_and_traps(g):
    """The gold hides in the central chamber — the maze is mirror-symmetric, so
    that spot is equally far for both agents (rendered dead-centre between the
    gates). A drop-trap sits mid-way on the shared gold->escape corridor, so it
    threatens whoever is carrying the gold equally — step on it and it fumbles
    straight back to the pedestal."""
    gold = GOLD_CELL
    g[gold[0]][gold[1]] = GOLD_HOME
    p = [c for c in _maze_path(g, gold, ESCAPE_POS[0])[1:-1] if g[c[0]][c[1]] == FLOOR]
    traps = [p[len(p) // 2]] if p else []
    for (tr, tc) in traps:
        g[tr][tc] = GOLD_TRAP
    return gold, traps


def _build():
    g = [[FLOOR] * SIZE for _ in range(SIZE)]
    furniture = []

    # divider wall + the two key-locked exit doors (palace -> maze)
    for c in range(SIZE):
        g[DIVIDER_ROW][c] = WALL
    g[RED_DOOR_POS[0]][RED_DOOR_POS[1]] = RED_DOOR
    g[BLUE_DOOR_POS[0]][BLUE_DOOR_POS[1]] = BLUE_DOOR

    # --- the PALACE (bottom rows 13-19): a sealed bedroom maze each side + the
    #     shared central hall where both agents start and are furnished as rooms
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

    # --- the MAZE (upper arena) hiding the gold + the drop-trap ---
    _carve_top_maze(g, random.Random(MAZE_SEED))
    gold_home, drop_traps = _place_gold_and_traps(g)

    # furniture render-list (explicit facings; mirror keeps N/S-facing pieces)
    for (cell, t, rot) in FURN_LEFT:
        furniture.append({"cell": [cell[0], cell[1]], "type": t, "rot": rot})
        furniture.append({"cell": [cell[0], 19 - cell[1]], "type": t, "rot": rot})
    for (cell, t, rot) in FURN_LIVING:
        furniture.append({"cell": [cell[0], cell[1]], "type": t, "rot": rot})

    return World(g, furniture, [list(c) for c in ROOM_DOORS], gold_home, drop_traps)


def _validate(world):
    g = world.grid

    def reach(start, agent, red_key, blue_key):
        seen, stack = {start}, [start]
        while stack:
            r, c = stack.pop()
            for dr, dc in ORTHO:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < SIZE and 0 <= nc < SIZE) or (nr, nc) in seen:
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
        if key not in reach(spawn, agent, False, False):
            problems.append(f"{agent}: cannot reach its colored key")
        opened = reach(spawn, agent, agent == "red", agent == "blue")
        if world.gold_home not in opened:
            problems.append(f"{agent}: cannot reach the gold")
        if not any(e in opened for e in world.escape):
            problems.append(f"{agent}: cannot reach the escape")
    if problems:
        raise ValueError("world invalid:\n  " + "\n  ".join(problems))


def generate(seed=None, with_mechanics=True):
    world = _build()
    _validate(world)
    return world


def add_mechanics(world, rng):
    return world


if __name__ == "__main__":
    w = generate()
    print(f"fixed castle: {len(w.furniture)} furniture, room doors {w.room_doors}")
    for row in w.rows():
        print(row)
