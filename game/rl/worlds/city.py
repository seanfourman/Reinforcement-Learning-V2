"""Round 2 — the NEON CITY rooftop (model-FREE + slippery).

A 20x20 city block: buildings ('#') laid on a regular lattice leave a connected
2-wide street grid. A wall at row 12 splits the map with two key-locked doors;
each agent grabs its colored key down in the streets, opens its door, then races
up through downtown to the gold and out the north escape.

The plaza around the gold is SLIPPERY (wet rooftop) and a drop-trap on the escape
run can knock the gold loose. Those unmodeled hazards are why this is the
model-FREE learning round — the default matchup is SARSA vs Q-Learning, the
classic on-policy / off-policy contrast (Q-Learning walks the cliff edge, SARSA
plays it safe). Layout is fixed; pressing R just resets the two learners.
"""

from .grid import (
    World, validate, SIZE,
    WALL, FLOOR, ESCAPE, RED_KEY, BLUE_KEY, RED_DOOR, BLUE_DOOR,
    GOLD_HOME, RED_SPAWN, BLUE_SPAWN, GOLD_TRAP,
)

THEME = "city"
ROUND_ID = 2
TITLE = "Neon City"

DIVIDER_ROW = 12
RED_DOOR_POS, BLUE_DOOR_POS = (12, 8), (12, 11)
RED_SPAWN_POS, BLUE_SPAWN_POS = (19, 6), (19, 13)
RED_KEY_POS, BLUE_KEY_POS = (16, 3), (16, 16)
GOLD_CELL = (5, 9)
ESCAPE_POS = [(0, 9), (0, 10)]
DROP_TRAPS = [(3, 10)]
SLIP_PROB = 0.2


def _build():
    g = [[FLOOR] * SIZE for _ in range(SIZE)]

    # city blocks: 1x1 buildings on a 3-grid, so 2-wide streets stay connected
    for r in range(1, SIZE - 1):
        for c in range(1, SIZE - 1):
            if r % 3 == 1 and c % 3 == 1:
                g[r][c] = WALL

    # downtown divider with two key-locked doors + their open throats
    for c in range(SIZE):
        g[DIVIDER_ROW][c] = WALL
    g[RED_DOOR_POS[0]][RED_DOOR_POS[1]] = RED_DOOR
    g[BLUE_DOOR_POS[0]][BLUE_DOOR_POS[1]] = BLUE_DOOR
    for (r, c) in [(11, 8), (13, 8), (11, 11), (13, 11)]:
        g[r][c] = FLOOR

    # gameplay tiles (overwrite any block underneath them)
    for (r, c) in ESCAPE_POS:
        g[r][c] = ESCAPE
    g[GOLD_CELL[0]][GOLD_CELL[1]] = GOLD_HOME
    g[RED_KEY_POS[0]][RED_KEY_POS[1]] = RED_KEY
    g[BLUE_KEY_POS[0]][BLUE_KEY_POS[1]] = BLUE_KEY
    g[RED_SPAWN_POS[0]][RED_SPAWN_POS[1]] = RED_SPAWN
    g[BLUE_SPAWN_POS[0]][BLUE_SPAWN_POS[1]] = BLUE_SPAWN
    for (r, c) in DROP_TRAPS:
        g[r][c] = GOLD_TRAP

    # slippery wet plaza around the gold (only the actual floor tiles)
    slip = [(r, c) for r in range(4, 7) for c in range(8, 12) if g[r][c] == FLOOR]

    return World(
        g, theme=THEME, round_id=ROUND_ID, title=TITLE,
        red_spawn=RED_SPAWN_POS, blue_spawn=BLUE_SPAWN_POS,
        red_key=RED_KEY_POS, blue_key=BLUE_KEY_POS,
        red_door=RED_DOOR_POS, blue_door=BLUE_DOOR_POS,
        gold_home=GOLD_CELL, escape=ESCAPE_POS,
        furniture=[], room_doors=[], drop_traps=DROP_TRAPS,
        slip_cells=slip, slip_prob=SLIP_PROB, seed=2,
    )


def generate(seed=None):
    world = _build()
    validate(world)
    return world


if __name__ == "__main__":
    w = generate()
    print(f"neon city: {w.H}x{w.W}, {len(w.slip_cells)} slip cells, {len(w.drop_traps)} traps")
    for row in w.rows():
        print(row)
