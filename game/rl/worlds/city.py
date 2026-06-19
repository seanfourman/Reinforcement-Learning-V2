"""Round 2 — New Donk City hedge maze (SARSA vs Q-Learning).

A hand-designed, left-right symmetric hedge maze on a grass field. Agent A starts
in the bottom-left corner, agent B in the bottom-right, and they race to the goal
cells at the top centre. The maze gives each side lots of twisting local choices
early on, but the corridors gradually pull both toward the middle, so it's a real
race rather than two mirrored tunnels.

Scattered through it are SLIPPERY junction cells ('S'). On one, the agent loses
control: 75% it's shoved the optimal way toward the goal (the env's privileged
knowledge), 10% left, 10% right, 5% backward — and if that hits a bush it stays
put (see ``env._cross_move``). That stochastic junction is the professor's
slippery-cell requirement and the on/off-policy engine.

Legend:  # bush/wall   . path   S slippery junction   A/B spawns   G goal
Coordinates are (row, col), row 0 = NORTH (goal), row 19 = SOUTH (spawns).
"""

from .grid import (
    World, validate,
    WALL, FLOOR, ESCAPE, RED_SPAWN, BLUE_SPAWN,
)

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

# the maze, drawn by hand (20x20). Mirror-symmetric, corners open for the spawns.
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
    "#...#...SS...#...#.#",
    "#.#...###..#...#.#.#",
    "A....###....###....B",
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
        red_spawn=red, blue_spawn=blue,
        # no keys / doors / gold in a cross world — point them at the spawns so the
        # World container stays happy; the env ignores them in "cross" mode.
        red_key=red, blue_key=blue, red_door=red, blue_door=blue,
        gold_home=red, escape=goals,
        furniture=[], room_doors=[], drop_traps=[],
        # cross uses the fixed 75/10/10/5 control-loss model in env._cross_move;
        # slip_prob is unused there but kept non-zero for clarity.
        slip_cells=slip, slip_prob=1.0, seed=2,
    )


def generate(seed=None):
    world = _build()
    validate(world)
    return world


if __name__ == "__main__":
    w = generate()
    print(f"hedge maze: {w.H}x{w.W}, {len(w.slip_cells)} slippery junctions, "
          f"goals {w.escape}, spawns {w.red_spawn}/{w.blue_spawn}")
    for row in w.rows():
        print(row)
