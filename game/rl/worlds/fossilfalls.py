"""Round 3 — Fossil Falls / Cascade Kingdom (Q-Learning vs Monte-Carlo).

A hand-designed, left-right symmetric rock maze in a prehistoric canyon. Agent A
starts in the bottom-left, agent B in the bottom-right, and they climb a winding
rock basin to the goal cells at the top centre, where a Power Moon floats over the
falls. A central rock spine splits the two sides early and the corridors funnel
both back toward the middle, so it stays a real race up the canyon.

Scattered through it are SLIPPERY wet-rock cells ('S') by the water: on one the
agent's chosen move slips to a perpendicular direction with the env's slip
probability (slip_ctrl, 0.25 by default), split evenly left/right; a slip into rock
stays put (see ``env._cross_move`` / ``env.move_dist`` - one shared model). That
stochastic junction is the professor's slippery-cell requirement, and the contrast
it draws here is TD bootstrapping (Q-Learning) vs full-episode returns (Monte-Carlo).

Legend:  # rock/wall   . path   S slippery wet rock   A/B spawns   G goal (moon)
Coordinates are (row, col), row 0 = NORTH (goal), row 19 = SOUTH (spawns).
"""

from .grid import (
    World, validate,
    WALL, FLOOR, ESCAPE, RED_SPAWN, BLUE_SPAWN,
)

THEME = "fossilfalls"
ROUND_ID = 3
TITLE = "Fossil Falls"

# the maze, drawn by hand (20x20), mirror-symmetric for a fair climb.
MAZE = [
    "#########GG#########",
    "#.....S......S.....#",
    "#.######.##.######.#",
    "#......#....#......#",
    "#.####.##..##.####.#",
    "#.#..S...##...S..#.#",
    "#.#.####.##.####.#.#",
    "#...#....##....#...#",
    "###.#.##.##.##.#.###",
    "#.....#......#.....#",
    "#.###.#.####.#.###.#",
    "#...S.#..##..#.S...#",
    "#.#.###..##..###.#.#",
    "#.#....#.##.#....#.#",
    "#.#.##.#.##.#.##.#.#",
    "#...#..#....#..#...#",
    "##.##.##.##.##.##.##",
    "#....S...##...S....#",
    "#.######.##.######.#",
    "B..................A",
]


def _build():
    grid, slip, goals = [], [], []
    red = blue = None
    for r, line in enumerate(MAZE):
        row = []
        for c, ch in enumerate(line):
            if ch == "#":
                row.append(WALL)
            elif ch == "S":
                row.append(FLOOR)
                slip.append((r, c))
            elif ch == "A":
                row.append(RED_SPAWN)
                red = (r, c)
            elif ch == "B":
                row.append(BLUE_SPAWN)
                blue = (r, c)
            elif ch == "G":
                row.append(ESCAPE)
                goals.append((r, c))
            else:
                row.append(FLOOR)
        grid.append(row)

    return World(
        grid, theme=THEME, round_id=ROUND_ID, title=TITLE, objective="cross",
        red_spawn=red, blue_spawn=blue, escape=goals,
        # WHICH cells slip; the per-slip PROBABILITY is the env's slip_ctrl (panel-
        # driven), shared by env.move_dist + _cross_move.
        slip_cells=slip,
        # SPARSE rewards on the Dyna round: no shaping, so the reward exists only at
        # the goal. That is what makes model-based planning (Dyna) visibly outrun
        # plain Q-learning - dense shaping would hand the value gradient over for free.
        shape_w=0.0,
    )


def generate(seed=None):
    world = _build()
    validate(world)
    return world


if __name__ == "__main__":
    w = generate()
    print(f"fossil falls: {w.H}x{w.W}, {len(w.slip_cells)} slippery wet rocks, "
          f"goals {w.escape}, spawns {w.red_spawn}/{w.blue_spawn}")
    for row in w.rows():
        print(row)
