"""Round 3 - Fossil Falls / Cascade Kingdom (SARSA vs Q-Learning).

A hand-designed, left-right symmetric rock maze in a prehistoric canyon. Agent A
starts in the bottom-left, agent B in the bottom-right, and they climb a winding
rock basin to the goal cells at the top centre, where a Power Moon floats over the
falls. A central rock spine splits the two sides early and the corridors funnel
both back toward the middle, so it stays a real race up the canyon.

This round is a bare navigate-to-goal SKELETON today: moves are deterministic
(walls block, you stay put), with no coins, hazards, or slip. The old 'S' wet-rock
cells are kept for shape only and now behave as plain FLOOR (the skeleton has no
slip mechanic). The TD contrast (on-policy SARSA vs off-policy Q-Learning) rides on
the bare maze; the real Fossil Falls game is still to be built.

Legend:  # rock/wall   . path   S (legacy wet rock, now plain floor)   A/B spawns   G goal (moon)
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
    grid, goals = [], []
    red = blue = None
    for r, line in enumerate(MAZE):
        row = []
        for c, ch in enumerate(line):
            if ch == "#":
                row.append(WALL)
            elif ch == "S":
                row.append(FLOOR)   # (was a slip cell; the skeleton has no slip)
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


def generate(seed=None, **_):
    world = _build()
    validate(world)
    return world


if __name__ == "__main__":
    w = generate()
    print(f"fossil falls: {w.H}x{w.W}, "
          f"goals {w.escape}, spawns {w.red_spawn}/{w.blue_spawn}")
    for row in w.rows():
        print(row)
