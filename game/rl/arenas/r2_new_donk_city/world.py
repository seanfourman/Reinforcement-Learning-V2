"""Round 2 - New Donk City foundation.

The arena currently contains:

* a 19x19 open board;
* two seeded, non-straight bush dividers that form three horizontal sections;
* mirrored spawns and the shared top-centre goal.
* a mirrored decision maze in the bottom section;
* one shared centre Pipe into the second section;
* seeded mirrored tomato detours and safe/risky routes in all three sections.

The left half of each divider is generated from the seed and reflected for the
right half, so both racers always receive exactly the same geometry.  Each
divider is sealed from edge to edge: the three sections are intentionally
disconnected except for Pipes.  The bottom room has a required dead-end tomato
spur off the main approach, followed by a short slippery route and a longer
safe route. Both racers' routes merge at one centre Pipe locked by their own
tomato. Its visible exit Pipe is in the second section.

From that shared exit, the second room splits symmetrically. Each racer must
leave its generated main corridor to collect its own second tomato, return,
then choose between a short puddle-and-plant shortcut or a longer safe route
to the Pipe on its side. Those Pipes enter a final mirrored room with a third
tomato, plants, optional puddles, and seeded bush corridors before the goal.
"""

import random

from core.worldgen import World, WALL, FLOOR, ESCAPE

from .course_tools import (CITY_SIZE, GOALS, DIVIDER_ROWS, BOTTOM_TOP,
                           _mirror, _surrounding, _divider,
                           _line, _join, _shortest_path, _decision_barrier,
                           _branch_cells, _procedural_maze_walls)
from .course_checks import _validate_design

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

def _build(rng):
    grid = [[FLOOR] * CITY_SIZE for _ in range(CITY_SIZE)]
    dividers = []
    for rows in DIVIDER_ROWS:
        cells = _divider(rng, rows)
        dividers.append(cells)
        for r, c in cells:
            grid[r][c] = WALL

    for r, c in GOALS:
        grid[r][c] = ESCAPE

    blue_spawn = (18, 0)
    red_spawn = _mirror(blue_spawn)

    pipe_entry = (15, 9)
    pipe_dest = (9, 9)
    tomato = (rng.choice((14, 15)), 0)
    spur_base = (17, 0)
    junction = (17, rng.randint(2, 3))
    water_col = rng.choice(tuple(range(junction[1] + 3, 8)))
    puddle = (16, water_col)
    plant = (18, water_col)
    plants = [plant, _mirror(plant)]
    slip = [puddle, _mirror(puddle)]
    plant_zone = {
        (r + dr, c + dc)
        for r, c in plants
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if (dr or dc)
        and 0 <= r + dr < CITY_SIZE
        and 0 <= c + dc < CITY_SIZE
    }

    pipes = [{
        "entry": pipe_entry,
        "dests": [pipe_dest],
        "weights": [1.0],
        "exit": pipe_dest,
        "requiresStar": 0,
    }]

    initial_path = _join(
        _line(blue_spawn, (17, 0)),
        _line((17, 0), junction),
    )
    tomato_spur = _join(
        _line(spur_base, tomato),
        _line(tomato, spur_base),
    )
    barrier_rows, barrier = _decision_barrier(
        rng, junction[1], water_col
    )
    safe_cells = _branch_cells(junction, pipe_entry, barrier_rows, "safe")
    risky_cells = _branch_cells(junction, pipe_entry, barrier_rows, "risky")
    safe_path = _shortest_path(junction, pipe_entry, safe_cells)
    risky_before = _shortest_path(
        junction, puddle, risky_cells - plant_zone
    )
    risky_after = _shortest_path(
        puddle, pipe_entry, risky_cells - plant_zone
    )
    risky_path = _join(risky_before, risky_after)

    protected_blue = set(initial_path + tomato_spur + safe_path + risky_path)
    protected = protected_blue | {_mirror(cell) for cell in protected_blue}
    # When the lower divider occupies its upper row, keep the first complete
    # bottom-room row open beneath that stair-step;
    # otherwise a random bush could seal a useless one-cell pocket beneath a
    # stair-step corner.
    protected.update(
        (13, c)
        for c in range(CITY_SIZE)
        if (DIVIDER_ROWS[-1][0], c) in dividers[-1]
    )
    # Two bushes beside each spawn force the first meaningful move north. The
    # tomato cap makes its branch a true dead end rather than another main lane.
    forced_walls = {
        (18, 1), (18, 2), (tomato[0], 1),
        *barrier,
    }
    if tomato[0] == 15:
        forced_walls.add((14, 0))
    maze_walls = _procedural_maze_walls(
        rng, protected, forced_walls, plants, plant_zone,
        set().union(*dividers), BOTTOM_TOP, CITY_SIZE
    )
    for r, c in maze_walls | set(plants):
        grid[r][c] = WALL

    # ------------------------------ middle room / second tomato
    middle_entry = pipe_dest
    middle_gate_col = rng.randint(3, 4)
    middle_tomato_col = rng.randint(middle_gate_col + 3, 7)
    middle_junction = (9, middle_tomato_col)
    middle_tomato = (7, middle_tomato_col)
    middle_spur_base = middle_junction
    middle_pipe_entry = (8, 1)
    middle_pipe_dest = (2, 1)
    middle_puddle = (10, middle_gate_col)
    middle_plant = (8, middle_gate_col)
    middle_plants = [middle_plant, _mirror(middle_plant)]
    middle_slip = [middle_puddle, _mirror(middle_puddle)]
    middle_plant_zone = {
        (r + dr, c + dc)
        for r, c in middle_plants
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if (dr or dc)
        and 0 <= r + dr < CITY_SIZE
        and 0 <= c + dc < CITY_SIZE
    }

    middle_initial = _join(
        _line(middle_entry, middle_junction),
    )
    middle_safe_col = middle_gate_col + 2
    middle_safe = _join(
        _line(middle_junction, (9, middle_safe_col)),
        _line((9, middle_safe_col), (6, middle_safe_col)),
        _line((6, middle_safe_col), (6, 1)),
        _line((6, 1), middle_pipe_entry),
    )
    middle_risky = _join(
        _line(middle_junction, (10, middle_junction[1])),
        _line((10, middle_junction[1]), (10, 1)),
        _line((10, 1), middle_pipe_entry),
    )
    middle_tomato_spur = _join(
        _line(middle_spur_base, middle_tomato),
        _line(middle_tomato, middle_spur_base),
    )
    middle_tomato_safe_approach = _join(
        _line(middle_spur_base, (9, middle_tomato_col + 1)),
        _line((9, middle_tomato_col + 1), (7, middle_tomato_col + 1)),
        _line((7, middle_tomato_col + 1), middle_tomato),
    )
    middle_tomato_safe = _join(
        middle_tomato_safe_approach,
        list(reversed(middle_tomato_safe_approach)),
    )
    middle_blue_paths = set(
        middle_initial + middle_safe + middle_risky
        + middle_tomato_spur + middle_tomato_safe
    )
    middle_protected = (
        middle_blue_paths | {_mirror(cell) for cell in middle_blue_paths}
    )
    # A warp must never drop a racer into a bush pocket. Keep the shared
    # landing Pipe and its complete eight-neighbour plaza clear on every seed.
    middle_protected.update(
        {middle_entry} | _surrounding(middle_entry)
    )
    # Preserve the floor immediately below every upper-divider stair step.
    middle_protected.update(
        (6, c)
        for c in range(CITY_SIZE)
        if (DIVIDER_ROWS[0][0], c) in dividers[0]
    )
    # Also keep the middle-side continuation above the lower divider open.
    middle_protected.update(
        (10, c)
        for c in range(CITY_SIZE)
        if (DIVIDER_ROWS[-1][1], c) in dividers[-1]
    )
    middle_forced = {
        (7, middle_tomato_col - 1),
        (6, middle_tomato_col),
        (6, middle_tomato_col + 1),
    } - middle_protected - middle_plant_zone
    extra_middle_puddle = (8, middle_tomato_col)
    extra_middle_slip = [
        extra_middle_puddle, _mirror(extra_middle_puddle)
    ]
    middle_protected.update(extra_middle_slip)
    middle_walls = _procedural_maze_walls(
        rng,
        middle_protected,
        middle_forced,
        plants + middle_plants,
        middle_plant_zone,
        set().union(*dividers) | maze_walls,
        6,
        11,
    )
    for r, c in middle_walls | set(middle_plants):
        grid[r][c] = WALL

    for reflect in (lambda cell: cell, _mirror):
        pipes.append({
            "entry": reflect(middle_pipe_entry),
            "dests": [reflect(middle_pipe_dest)],
            "weights": [1.0],
            "exit": reflect(middle_pipe_dest),
            "requiresStar": 1,
        })

    # ------------------------------ top room / final tomato and goal
    top_entry = middle_pipe_dest
    top_junction = (2, 3)
    top_gate_col = rng.randint(5, 6)
    top_merge = (2, top_gate_col + 2)
    top_tomato = (0, 1)
    top_plant = (1, top_gate_col)
    top_puddle = (1, 1)
    top_plants = [top_plant, _mirror(top_plant)]
    top_slip = [top_puddle, _mirror(top_puddle)]
    top_plant_zone = {
        cell
        for plant_cell in top_plants
        for cell in _surrounding(plant_cell)
    }
    top_initial = _line(top_entry, top_junction)
    top_tomato_spur = _join(
        _line(top_entry, top_tomato),
        _line(top_tomato, top_entry),
    )
    top_tomato_safe_approach = _join(
        _line(top_entry, (2, 2)),
        _line((2, 2), (0, 2)),
        _line((0, 2), top_tomato),
    )
    top_tomato_safe = _join(
        top_tomato_safe_approach,
        list(reversed(top_tomato_safe_approach)),
    )
    top_safe = _join(
        _line(top_junction, (3, top_junction[1])),
        _line((3, top_junction[1]), (3, top_merge[1])),
        _line((3, top_merge[1]), top_merge),
    )
    top_finish = _join(
        _line(top_merge, (2, 9)),
        _line((2, 9), GOALS[0]),
    )
    top_blue_paths = set(
        top_initial + top_tomato_spur + top_tomato_safe
        + top_safe + top_finish
    )
    top_protected = top_blue_paths | {
        _mirror(cell) for cell in top_blue_paths
    }
    for landing in (top_entry, _mirror(top_entry)):
        top_protected.update({landing} | _surrounding(landing))
    top_forced = {
        (0, 0),
    } - top_protected - top_plant_zone
    top_walls = _procedural_maze_walls(
        rng,
        top_protected,
        top_forced,
        plants + middle_plants + top_plants,
        top_plant_zone,
        set().union(*dividers) | maze_walls | middle_walls,
        0,
        4,
    )
    for r, c in top_walls | set(top_plants):
        grid[r][c] = WALL

    all_plants = plants + middle_plants + top_plants
    all_slip = slip + middle_slip + extra_middle_slip + top_slip
    hedges = (
        set().union(*dividers) | maze_walls | middle_walls | top_walls
    )
    hedges -= set(all_plants)
    world = World(
        grid,
        theme=THEME,
        round_id=ROUND_ID,
        title=TITLE,
        objective="cross",
        red_spawn=red_spawn,
        blue_spawn=blue_spawn,
        escape=GOALS,
        shine=GOALS,
        spikes=[],
        plants=all_plants,
        pipes=pipes,
        slip=all_slip,
        red_stars=[
            _mirror(tomato), _mirror(middle_tomato), _mirror(top_tomato)
        ],
        blue_stars=[tomato, middle_tomato, top_tomato],
        hedge_cells=sorted(hedges),
    )
    return world, {
        "dividers": dividers,
        "blue_maze": {
            cell for cell in maze_walls if cell[1] < CITY_SIZE // 2
        },
        "pipe_entry": pipe_entry,
        "pipe_dest": pipe_dest,
        "tomato": tomato,
        "spur_base": spur_base,
        "tomato_spur": tomato_spur,
        "junction": junction,
        "puddle": puddle,
        "plant": plant,
        "plant_zone": plant_zone,
        "barrier": barrier,
        "safe_cells": safe_cells,
        "risky_cells": risky_cells,
        "initial_path": initial_path,
        "safe_path": safe_path,
        "risky_path": risky_path,
        "middle_entry": middle_entry,
        "middle_junction": middle_junction,
        "middle_tomato": middle_tomato,
        "middle_spur_base": middle_spur_base,
        "middle_initial": middle_initial,
        "middle_safe": middle_safe,
        "middle_risky": middle_risky,
        "middle_tomato_spur": middle_tomato_spur,
        "middle_tomato_safe": middle_tomato_safe,
        "middle_pipe_entry": middle_pipe_entry,
        "middle_pipe_dest": middle_pipe_dest,
        "middle_puddle": middle_puddle,
        "extra_middle_puddle": extra_middle_puddle,
        "middle_plant": middle_plant,
        "middle_plant_zone": middle_plant_zone,
        "middle_walls": middle_walls,
        "top_entry": top_entry,
        "top_junction": top_junction,
        "top_merge": top_merge,
        "top_tomato": top_tomato,
        "top_tomato_spur": top_tomato_spur,
        "top_tomato_safe": top_tomato_safe,
        "top_initial": top_initial,
        "top_safe": top_safe,
        "top_finish": top_finish,
        "top_puddle": top_puddle,
        "top_plant": top_plant,
        "top_plant_zone": top_plant_zone,
        "top_walls": top_walls,
    }

def generate(seed=None):
    """Return the same arena for the same seed and a new shape for a new seed."""
    base_seed = 0 if seed is None else seed
    rng = random.Random(f"new-donk-foundation:{base_seed}")
    world, design = _build(rng)
    # Validate the generated course-specific decisions after all three seeded
    # rooms and their Pipe transfers have been assembled.
    _validate_design(world, design)
    return world


def _ascii(world):
    goals = set(world.escape)
    plants = set(world.plants)
    slips = set(world.slip)
    stars = set(world.blue_stars) | set(world.red_stars)
    entries = {pipe["entry"] for pipe in world.pipes}
    dests = {dest for pipe in world.pipes for dest in pipe["dests"]}
    lines = []
    for r, row in enumerate(world.rows()):
        line = ""
        for c, char in enumerate(row):
            cell = (r, c)
            line += (
                "G" if cell in goals
                else "B" if cell == world.blue_spawn
                else "R" if cell == world.red_spawn
                else "P" if cell in plants
                else "~" if cell in slips
                else "*" if cell in stars
                else "O" if cell in entries
                else "=" if cell in dests
                else char
            )
        lines.append(line)
    return "\n".join(lines)


if __name__ == "__main__":
    for demo_seed in (0, 1, 2):
        demo = generate(seed=demo_seed)
        print(f"\nseed={demo_seed} hedges={len(demo.hedge_cells)}")
        print(_ascii(demo))
