"""Round 1 - Peach's Castle: a plain navigate-to-goal gridworld (VI vs PI).

The assignment's "level 1" feel: a simple deterministic gridworld on the castle
floor. Both agents start at the bottom and head to the GOAL (the throne) at the
top, around a few pillar obstacles. NO keys, gold, doors or slippery tiles - just
reach the goal. With a known deterministic model, Value Iteration and Policy
Iteration both plan the shortest path; the contrast Benny teaches is HOW each
converges.

Coordinates are (row, col), row 0 = NORTH (throne), row 19 = SOUTH (spawns).
"""

from .grid import (
    World, validate, SIZE,
    WALL, FLOOR, ESCAPE, RED_SPAWN, BLUE_SPAWN,
)

THEME = "peach"
ROUND_ID = 1
TITLE = "Peach's Castle"

# The RL grid stays SIZE x SIZE (=20; the viewer's heatmap/camera assume that),
# but the PLAYABLE area is a central BOARD x BOARD: the frame around it is walled
# off. Those frame cells render as plain foyer floor (peach.js draws no wall
# geometry), so there's no visible ring - the board just reads as BOARD x BOARD.
BOARD = 15
LO = (SIZE - BOARD) // 2                # first play row/col (top/left margin)
HI = LO + BOARD - 1                     # last play row/col
MID = (LO + HI) // 2                    # centre column of the play area

ESCAPE_POS = [(LO, MID)]                        # ONE terminal, top-centre
RED_SPAWN_POS, BLUE_SPAWN_POS = (HI, LO), (HI, HI)   # bottom-left / bottom-right corners (symmetric)
# open hall - no interior obstacles (the castle model is the whole scene)
PILLARS = []


def _build():
    g = [[FLOOR] * SIZE for _ in range(SIZE)]

    # wall off everything outside the central 16x16 so the play area is 16x16
    for r in range(SIZE):
        for c in range(SIZE):
            if r < LO or r > HI or c < LO or c > HI:
                g[r][c] = WALL

    for (r, c) in PILLARS:
        g[r][c] = WALL

    for (r, c) in ESCAPE_POS:
        g[r][c] = ESCAPE
    g[RED_SPAWN_POS[0]][RED_SPAWN_POS[1]] = RED_SPAWN
    g[BLUE_SPAWN_POS[0]][BLUE_SPAWN_POS[1]] = BLUE_SPAWN

    return World(
        g, theme=THEME, round_id=ROUND_ID, title=TITLE, objective="cross",
        red_spawn=RED_SPAWN_POS, blue_spawn=BLUE_SPAWN_POS,
        # cross world: no keys / doors / gold - point them at the spawns so the
        # World container stays happy; the env + DP planner ignore them.
        red_key=RED_SPAWN_POS, blue_key=BLUE_SPAWN_POS,
        red_door=RED_SPAWN_POS, blue_door=BLUE_SPAWN_POS,
        gold_home=RED_SPAWN_POS, escape=ESCAPE_POS,
        furniture=[], room_doors=[], drop_traps=[],
        slip_cells=[], slip_prob=0.0, seed=1,
    )


def generate(seed=None):
    world = _build()
    validate(world)
    return world


if __name__ == "__main__":
    w = generate()
    print(f"Peach's Castle gridworld: {w.H}x{w.W}, objective={w.objective}, "
          f"goal {w.escape}, spawns {w.red_spawn}/{w.blue_spawn}")
    for row in w.rows():
        print(row)
