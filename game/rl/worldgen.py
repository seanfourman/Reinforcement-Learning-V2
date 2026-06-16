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

# left-side furniture (mirrored to the right). Logical: bed + bedside chest,
# wardrobe against the wall (inner room); desk + chair together, bookshelf (outer).
FURN_LEFT = [
    ((13, 0), "bed"), ((13, 1), "chest"), ((13, 4), "wardrobe"),      # inner room B
    ((18, 1), "table"), ((19, 1), "chair"), ((19, 4), "bookshelf"),   # outer room A
]
# a dining table with chairs in the living-room centre (off the agents' lanes)
FURN_LIVING = [((17, 9), "table"), ((17, 10), "table"), ((16, 9), "chair"), ((16, 10), "chair")]

GOLD_POS = (5, 9)
ESCAPE_POS = [(0, 9), (0, 10)]
PILLARS = [(8, 5), (8, 14)]
MIRROR_PAIR = ((3, 2), (3, 17))
LEVER_POS = (9, 9)
TRAP_POS = (6, 10)
LADDER_PAIR = ((8, 4), (8, 6))


class World:
    def __init__(self, grid, furniture, room_doors, seed=1):
        self.grid = grid
        self.furniture = furniture
        self.room_doors = room_doors
        self.seed = seed
        self.H, self.W = len(grid), len(grid[0])
        self.red_spawn, self.blue_spawn = RED_SPAWN_POS, BLUE_SPAWN_POS
        self.red_door, self.blue_door = RED_DOOR_POS, BLUE_DOOR_POS
        self.gold_home = GOLD_POS
        self.escape = list(ESCAPE_POS)
        self.red_key, self.blue_key = RED_KEY_POS, BLUE_KEY_POS
        self.mirrors = [(list(MIRROR_PAIR[0]), list(MIRROR_PAIR[1]))]
        self.levers = [list(LEVER_POS)]
        self.traps = [list(TRAP_POS)]
        self.ladders = [(list(LADDER_PAIR[0]), list(LADDER_PAIR[1]))]

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
            "escape": [list(e) for e in self.escape],
            "furniture": self.furniture,
            "mirrors": [[list(a), list(b)] for a, b in self.mirrors],
            "levers": [list(c) for c in self.levers],
            "traps": [list(c) for c in self.traps],
            "ladders": [[list(a), list(b)] for a, b in self.ladders],
        }


def _facing(cell, grid):
    r, c = cell
    for i, (dr, dc) in enumerate([(1, 0), (-1, 0), (0, 1), (0, -1)]):
        nr, nc = r + dr, c + dc
        if 0 <= nr < SIZE and 0 <= nc < SIZE and grid[nr][nc] == FLOOR:
            return i
    return 0


def _build():
    g = [[FLOOR] * SIZE for _ in range(SIZE)]
    furniture = []

    # top wall + key-locked exit doors
    for c in range(SIZE):
        g[DIVIDER_ROW][c] = WALL
    g[RED_DOOR_POS[0]][RED_DOOR_POS[1]] = RED_DOOR
    g[BLUE_DOOR_POS[0]][BLUE_DOOR_POS[1]] = BLUE_DOOR

    # side walls of the two room-columns (col5 left, col14 right), full height
    for r in range(13, 20):
        g[r][5] = WALL
        g[r][14] = WALL
    # wall between the inner & outer rooms (row 16), each side
    for c in range(0, 6):
        g[16][c] = WALL
    for c in range(14, 20):
        g[16][c] = WALL
    # punch the contact doors back open
    for (r, c) in ROOM_DOORS:
        g[r][c] = FLOOR

    # furniture (left hand-placed, mirrored to the right)
    def block(r, c):
        g[r][c] = WALL
    for (cell, t) in FURN_LEFT:
        block(*cell)
        block(cell[0], 19 - cell[1])
    for (cell, t) in FURN_LIVING:
        block(*cell)

    # fixtures
    g[RED_KEY_POS[0]][RED_KEY_POS[1]] = RED_KEY
    g[BLUE_KEY_POS[0]][BLUE_KEY_POS[1]] = BLUE_KEY
    g[RED_SPAWN_POS[0]][RED_SPAWN_POS[1]] = RED_SPAWN
    g[BLUE_SPAWN_POS[0]][BLUE_SPAWN_POS[1]] = BLUE_SPAWN
    for (r, c) in ESCAPE_POS:
        g[r][c] = ESCAPE
    g[GOLD_POS[0]][GOLD_POS[1]] = GOLD_HOME

    # hall structure + open cells under the exit doors / escape throat
    for (r, c) in PILLARS:
        g[r][c] = WALL
    for cell in [(1, 9), (1, 10), (11, 8), (11, 11), (13, 8), (13, 11)]:
        g[cell[0]][cell[1]] = FLOOR

    # furniture render-list (facings computed against the final grid)
    for (cell, t) in FURN_LEFT:
        for cc in (cell, (cell[0], 19 - cell[1])):
            furniture.append({"cell": [cc[0], cc[1]], "type": t, "rot": _facing(cc, g)})
    for (cell, t) in FURN_LIVING:
        furniture.append({"cell": [cell[0], cell[1]], "type": t, "rot": _facing(cell, g)})

    return World(g, furniture, [list(c) for c in ROOM_DOORS])


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
