"""Round 2 - New Donk City hedge maze (Every-visit MC vs First-visit MC).

A hand-designed, left-right symmetric hedge maze on a grass field. Agent A starts
in the bottom-left corner, agent B in the bottom-right, and they race to the goal
cells at the top centre. The maze gives each side lots of twisting local choices
early on, but the corridors gradually pull both toward the middle, so it's a real
race rather than two mirrored tunnels.

This round is a bare navigate-to-goal SKELETON today: moves are deterministic
(walls block, you stay put), with no coins, hazards, or slip. The old 'S' junction
cells are kept in the layout for shape only and now behave as plain FLOOR (the
skeleton has no slip mechanic). The real New Donk City game is still to be built.

Legend:  # bush/wall   . path   S (legacy junction, now plain floor)   A/B spawns   G goal
Coordinates are (row, col), row 0 = NORTH (goal), row 19 = SOUTH (spawns).
"""

from .grid import (
    World, validate,
    WALL, FLOOR, ESCAPE, RED_SPAWN, BLUE_SPAWN,
)

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

# the maze, drawn by hand (20x20), TRUE mirror-symmetric about the centre column
# (each side crosses the same walls, so neither model is handed an easier route),
# corners open for the spawns. Both spawns solve in 32.
MAZE = [
    "#########GG#########",
    "#...S....SS....S...#",
    "#.###..#....#..###.#",
    "#......S.##.S......#",
    "#...#..#.##.#..#...#",
    "#.#..............#.#",
    "#.#.#.#.####.#.#.#.#",
    "#...S...#..#...S...#",
    "##..##..#SS#..##..##",
    "#.....#......#.....#",
    "#.###.###..###.###.#",
    "#.......S..S.......#",
    "###.#.##.##.##.#.###",
    "#...#..........#...#",
    "#...###..##..###...#",
    "#.....S.####.S.....#",
    "#...##........##...#",
    "#...#...SSSS...#...#",
    "#.#...###..###...#.#",
    "B....###....###....A",
]


def _build():
    grid, goals = [], []
    red = blue = None
    for r, line in enumerate(MAZE):
        row = []
        for c, ch in enumerate(line):
            if ch == "#":
                row.append(WALL)
            elif ch == "S":
                row.append(FLOOR)   # (was a slip junction; the skeleton has no slip)
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
    )


def generate(seed=None):
    world = _build()
    validate(world)
    return world


if __name__ == "__main__":
    w = generate()
    print(f"hedge maze: {w.H}x{w.W}, "
          f"goals {w.escape}, spawns {w.red_spawn}/{w.blue_spawn}")
    for row in w.rows():
        print(row)
