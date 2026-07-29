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
from collections import deque

from core.worldgen import World, WALL, FLOOR, ESCAPE

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

CITY_SIZE = 19
GOALS = ((0, 9),)
DIVIDER_ROWS = ((4, 5), (11, 12))
BOTTOM_TOP = 13

def _mirror(cell):
    r, c = cell
    return r, CITY_SIZE - 1 - c


def _surrounding(cell):
    """All in-bounds cells in the eight-neighbour ring around ``cell``."""
    r, c = cell
    return {
        (r + dr, c + dc)
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if (dr or dc)
        and 0 <= r + dr < CITY_SIZE
        and 0 <= c + dc < CITY_SIZE
    }


def _left_steps(rng, first=None):
    """Nine left-half steps with horizontal runs no longer than two cells."""
    steps = [rng.randint(0, 1) if first is None else first]
    run_length = 1
    for _ in range(1, CITY_SIZE // 2):
        if run_length == 2 or rng.random() < 0.58:
            steps.append(1 - steps[-1])
            run_length = 1
        else:
            steps.append(steps[-1])
            run_length += 1
    return steps


def _divider(rng, rows):
    """A sealed mirrored stair-step: one bush per column across two rows."""
    # The lower divider begins on its lower row directly above the tomato
    # pocket cap, avoiding a trapped one-cell patch at either board edge.
    first = 1 if rows == DIVIDER_ROWS[-1] else None
    left = _left_steps(rng, first=first)
    centre_step = 1 - left[-1]
    steps = left + [centre_step] + list(reversed(left))
    cells = {(rows[steps[c]], c) for c in range(CITY_SIZE)}
    return cells


def _line(a, b):
    ar, ac = a
    br, bc = b
    if ar == br:
        step = 1 if bc >= ac else -1
        return [(ar, c) for c in range(ac, bc + step, step)]
    if ac == bc:
        step = 1 if br >= ar else -1
        return [(r, ac) for r in range(ar, br + step, step)]
    raise ValueError(f"non-orthogonal route segment: {a} -> {b}")


def _join(*segments):
    path = []
    for segment in segments:
        for cell in segment:
            if not path or path[-1] != cell:
                path.append(cell)
    return path


def _shortest_path(start, goal, allowed):
    """Return one shortest orthogonal path inside ``allowed``."""
    allowed = set(allowed) | {start, goal}
    todo = deque([start])
    parent = {start: None}
    while todo:
        cell = todo.popleft()
        if cell == goal:
            path = []
            while cell is not None:
                path.append(cell)
                cell = parent[cell]
            return list(reversed(path))
        r, c = cell
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nxt = (r + dr, c + dc)
            if nxt in allowed and nxt not in parent:
                parent[nxt] = cell
                todo.append(nxt)
    raise ValueError(f"generated corridor has no route: {start} -> {goal}")


def _decision_barrier(rng, junction_col, water_col):
    """Seed a sealed stair barrier between the safe and risky branches."""
    rows = {}
    run_row = None
    run_len = 0
    # The three cells over the hazard stay on row 15. That closes the upper
    # bypass, while dropping below row 16 enters the plant's attack zone.
    hazard_gate = set(range(water_col - 1, water_col + 2))
    for c in range(junction_col + 1, 9):
        if c in hazard_gate:
            row = 15
        else:
            choices = [14, 15]
            if run_len >= 2 and run_row in choices:
                choices.remove(run_row)
            row = rng.choice(choices)
        if row == run_row:
            run_len += 1
        else:
            run_row, run_len = row, 1
        rows[c] = row
    return rows, {(row, c) for c, row in rows.items()}


def _branch_cells(junction, pipe_entry, barrier_rows, side):
    """Cells available above (safe) or below (risky) the sealed barrier."""
    cells = set()
    jc = junction[1]
    for c in range(jc + 1):
        row_range = range(BOTTOM_TOP, 18) if side == "safe" else range(16, 18)
        cells.update((r, c) for r in row_range)
    for c, wall_row in barrier_rows.items():
        if side == "safe":
            cells.update((r, c) for r in range(BOTTOM_TOP, wall_row))
        else:
            cells.update((r, c) for r in range(wall_row + 1, 18))
    # Column 9 is the shared merge into the centre Pipe.
    if side == "safe":
        cells.update((r, 9) for r in (13, 14, 15))
    else:
        cells.update((r, 9) for r in (15, 16, 17))
    cells.update((r, jc) for r in range(BOTTOM_TOP, 18))
    cells.add(junction)
    cells.add(pipe_entry)
    return cells


def _max_horizontal_run(cells):
    for r in range(BOTTOM_TOP, CITY_SIZE):
        run = 0
        for c in range(CITY_SIZE):
            run = run + 1 if (r, c) in cells else 0
            if run > 2:
                return run
    return 2


def _run_at(cells, cell):
    r, c = cell
    left = c
    while (r, left - 1) in cells:
        left -= 1
    right = c
    while (r, right + 1) in cells:
        right += 1
    return right - left + 1


def _component_count(blocked):
    """Count walkable components across the complete board."""
    blocked = set(blocked)
    open_cells = {
        (r, c)
        for r in range(CITY_SIZE)
        for c in range(CITY_SIZE)
        if (r, c) not in blocked
    }
    components = 0
    while open_cells:
        components += 1
        start = next(iter(open_cells))
        seen = {start}
        todo = [start]
        while todo:
            r, c = todo.pop()
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nxt = (r + dr, c + dc)
                if nxt in open_cells and nxt not in seen:
                    seen.add(nxt)
                    todo.append(nxt)
        open_cells -= seen
    return components


def _procedural_maze_walls(
    rng, protected, forced, plants, excluded, base_walls,
    row_start, row_end
):
    """Scatter mirrored bush segments around carved routes.

    Candidate cells are shuffled by the seed and accepted one at a time only
    when they preserve the two-bush horizontal limit. Disconnected results are
    rejected and regenerated, so random seeds cannot create useless pockets.
    """
    forced = set(forced) | {_mirror(cell) for cell in forced}
    protected = set(protected)
    plant_set = set(plants)
    candidates = [
        (r, c)
        for r in range(row_start, row_end)
        for c in range(CITY_SIZE // 2)
        if (r, c) not in protected
        and _mirror((r, c)) not in protected
        and (r, c) not in forced
        and _mirror((r, c)) not in forced
        and (r, c) not in plant_set
        and _mirror((r, c)) not in plant_set
        and (r, c) not in excluded
        and _mirror((r, c)) not in excluded
    ]

    for _ in range(80):
        walls = set(forced)
        rng.shuffle(candidates)
        density = rng.uniform(0.42, 0.66)
        for cell in candidates:
            if rng.random() > density:
                continue
            pair = {cell, _mirror(cell)}
            trial = walls | pair
            # Do not create or extend a three-bush cosmetic run. The required
            # sealed decision barrier is already in ``forced`` and is exempt.
            if all(_run_at(trial, added) <= 2 for added in pair):
                walls = trial
        blocked = set(base_walls) | walls | plant_set
        if _component_count(blocked) == 3:
            return walls

    # The forced guide bushes are themselves valid and connected. This fallback
    # is deterministic but should only be reached for an extremely unlucky RNG.
    return forced


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


def _validate_design(world, design):
    grid = world.grid
    hedges = set(world.hedge_cells)

    if world.red_spawn != _mirror(world.blue_spawn):
        raise ValueError("Arena-2 spawns are not mirrored")
    for r in range(CITY_SIZE):
        for c in range(CITY_SIZE):
            if grid[r][c] != grid[r][CITY_SIZE - 1 - c]:
                raise ValueError("Arena-2 board is not mirror-symmetric")

    divider_cells = set().union(*design["dividers"])
    blocked = {
        (r, c)
        for r in range(CITY_SIZE)
        for c in range(CITY_SIZE)
        if grid[r][c] == WALL
    }
    if _component_count(blocked) != 3:
        raise ValueError("the two dividers and generated maze must form exactly three sections")
    if any(r in (0, CITY_SIZE - 1) for r, _ in divider_cells):
        raise ValueError("a divider touched the north or south board edge")
    if world.red_stars != [_mirror(cell) for cell in world.blue_stars]:
        raise ValueError("the racers' tomatoes are not mirrored")
    if len(world.blue_stars) != 3:
        raise ValueError("the three rooms need exactly three tomatoes per racer")

    if len(design["dividers"]) != 2:
        raise ValueError("Arena 2 must have exactly two bush dividers")
    if design["dividers"][0] & design["dividers"][1]:
        raise ValueError("the two bush dividers overlap")

    for allowed_rows, cells in zip(DIVIDER_ROWS, design["dividers"]):
        rows = {r for r, _ in cells}
        if rows != set(allowed_rows):
            raise ValueError("a bush divider generated as a straight line")
        if len(cells) != CITY_SIZE:
            raise ValueError("a sealed divider must contain one bush in every column")
        if any(sum((r, c) in cells for r in allowed_rows) != 1
               for c in range(CITY_SIZE)):
            raise ValueError("a divider has a gap or exceeds one-cell thickness")

        for row in allowed_rows:
            run = 0
            for c in range(CITY_SIZE):
                run = run + 1 if (row, c) in cells else 0
                if run > 2:
                    raise ValueError("a divider has three bushes in the same row")

    if len(world.plants) != 6 or len(world.slip) != 8:
        raise ValueError("all three rooms need their generated mirrored hazards")
    if len(world.pipes) != 3:
        raise ValueError("the first two rooms need one shared and two side Pipes")
    bottom_hazards = {
        design["plant"], _mirror(design["plant"]),
        design["puddle"], _mirror(design["puddle"]),
    }
    if any(r < BOTTOM_TOP for r, _ in bottom_hazards):
        raise ValueError("a bottom-room hazard escaped into another section")
    if any(grid[r][c] != WALL for r, c in world.plants):
        raise ValueError("Piranha Plant cells must be impassable")
    if set(world.plants) & hedges:
        raise ValueError("a Piranha Plant was rendered as a bush")
    if hedges & design["plant_zone"]:
        raise ValueError("a bush generated inside a Piranha Plant attack zone")
    if hedges & design["middle_plant_zone"]:
        raise ValueError("a middle-room bush generated inside a plant attack zone")
    if hedges & design["top_plant_zone"]:
        raise ValueError("a top-room bush generated inside a plant attack zone")
    for pipe in world.pipes:
        landing = pipe["exit"]
        landing_plaza = _surrounding(landing)
        if landing in hedges or landing_plaza & hedges:
            raise ValueError("a bush generated beside a Pipe exit")
        if any(grid[r][c] == WALL for r, c in landing_plaza):
            raise ValueError("a Pipe exit landing plaza is blocked")
        r, c = landing
        open_egress = sum(
            0 <= r + dr < CITY_SIZE
            and 0 <= c + dc < CITY_SIZE
            and grid[r + dr][c + dc] != WALL
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))
        )
        if open_egress < 2:
            raise ValueError("a Pipe exit does not have enough ways out")

    plant = design["plant"]
    attack_zone = {
        (plant[0] + dr, plant[1] + dc)
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if dr or dc
    }
    safe = design["safe_path"]
    risky = design["risky_path"]
    initial = design["initial_path"]
    tomato_spur = design["tomato_spur"]
    if len(safe) <= len(risky):
        raise ValueError("the safe route must be longer than the risky shortcut")
    if set(safe) & (attack_zone | set(world.slip)):
        raise ValueError("the safe route contains a bottom-room hazard")
    if design["puddle"] not in risky:
        raise ValueError("the risky shortcut does not cross its puddle")
    expected_barrier_cols = set(range(design["junction"][1] + 1, 9))
    if {c for _, c in design["barrier"]} != expected_barrier_cols:
        raise ValueError("the safe/risky decision barrier has an opening")
    if not design["barrier"] <= hedges:
        raise ValueError("the safe/risky decision barrier is not made of bushes")
    if any(
        (15, c) not in design["barrier"]
        for c in range(design["puddle"][1] - 1, design["puddle"][1] + 2)
    ):
        raise ValueError("the risky branch is not channelled through its puddle")
    if design["tomato"] in initial:
        raise ValueError("the tomato must be a detour, not part of the main approach")
    if (
        tomato_spur[0] != design["spur_base"]
        or tomato_spur[-1] != design["spur_base"]
        or design["tomato"] not in tomato_spur
    ):
        raise ValueError("the tomato spur is not a returning dead-end detour")
    skid_cell = (design["puddle"][0] + 1, design["puddle"][1])
    if skid_cell not in attack_zone:
        raise ValueError("the puddle cannot skid the racer into the plant attack zone")
    if any(grid[r][c] == WALL for r, c in initial + tomato_spur + safe + risky):
        raise ValueError("a designed bottom-room route is blocked")

    # In the lower branch, the puddle is an articulation gate once lethal plant
    # cells are removed: there must be no safe way around it. Across the complete
    # room, avoiding the puddle must still leave the deliberately longer safe path.
    alive = {
        (r, c)
        for r in range(BOTTOM_TOP, CITY_SIZE)
        for c in range(CITY_SIZE)
        if grid[r][c] != WALL and (r, c) not in design["plant_zone"]
    }
    lower_without_puddle = (
        set(design["risky_cells"]) & alive
    ) - {design["puddle"]}
    try:
        _shortest_path(
            design["junction"], design["pipe_entry"], lower_without_puddle
        )
    except ValueError:
        pass
    else:
        raise ValueError("the risky shortcut can bypass its puddle")
    safe_without_puddle = alive - set(world.slip)
    safe_shortest = _shortest_path(
        design["junction"], design["pipe_entry"], safe_without_puddle
    )
    if len(risky) >= len(safe_shortest):
        raise ValueError("the mandatory-puddle shortcut is not shorter than the safe path")

    entries = {pipe["entry"] for pipe in world.pipes}
    dests = {dest for pipe in world.pipes for dest in pipe["dests"]}
    if design["pipe_entry"] not in entries or design["pipe_dest"] not in dests:
        raise ValueError("the bottom-room Pipe transfer is missing")
    pipe = next(p for p in world.pipes if p["entry"] == design["pipe_entry"])
    if _mirror(pipe["entry"]) != pipe["entry"]:
        raise ValueError("the shared Pipe entrance is not centred")
    if _mirror(pipe["exit"]) != pipe["exit"]:
        raise ValueError("the shared Pipe exit is not centred")
    if pipe["exit"] != design["pipe_dest"]:
        raise ValueError("the visible exit Pipe does not match the warp destination")
    if pipe.get("requiresStar") != 0:
        raise ValueError("the bottom-room Pipe is not locked by its tomato")

    middle_entries = {
        design["middle_pipe_entry"],
        _mirror(design["middle_pipe_entry"]),
    }
    middle_dests = {
        design["middle_pipe_dest"],
        _mirror(design["middle_pipe_dest"]),
    }
    middle_pipes = [p for p in world.pipes if p["entry"] in middle_entries]
    if {p["entry"] for p in middle_pipes} != middle_entries:
        raise ValueError("the middle room is missing its left/right Pipes")
    if {
        dest for p in middle_pipes for dest in p["dests"]
    } != middle_dests:
        raise ValueError("the middle-room Pipes do not exit into the top section")
    if any(p.get("requiresStar") != 1 for p in middle_pipes):
        raise ValueError("a middle-room Pipe is not locked by the second tomato")

    middle_safe = design["middle_safe"]
    middle_risky = design["middle_risky"]
    middle_main = design["middle_initial"] + middle_safe + middle_risky
    middle_spur = design["middle_tomato_spur"]
    middle_tomato_safe = design["middle_tomato_safe"]
    if design["middle_tomato"] in middle_main:
        raise ValueError("the middle tomato must be a detour off the main route")
    if (
        middle_spur[0] != design["middle_spur_base"]
        or middle_spur[-1] != design["middle_spur_base"]
        or design["middle_tomato"] not in middle_spur
    ):
        raise ValueError("the middle tomato is not a returning dead-end detour")
    if any(grid[r][c] == WALL for r, c in middle_main + middle_spur):
        raise ValueError("a generated middle-room route is blocked")
    if any(grid[r][c] == WALL for r, c in middle_tomato_safe):
        raise ValueError("the safe middle-tomato detour is blocked")
    if len(middle_safe) <= len(middle_risky):
        raise ValueError("the middle safe route must be longer than its shortcut")
    if set(middle_safe) & (
        design["middle_plant_zone"] | set(world.slip)
    ):
        raise ValueError("the middle safe route contains a hazard")
    if design["middle_puddle"] not in middle_risky:
        raise ValueError("the middle shortcut does not cross its puddle")
    if design["extra_middle_puddle"] not in middle_spur:
        raise ValueError("the extra middle puddle is not a tomato shortcut")
    if set(middle_tomato_safe) & set(world.slip):
        raise ValueError("the longer middle-tomato approach contains a puddle")
    if len(middle_tomato_safe) <= len(middle_spur):
        raise ValueError("the dry middle-tomato approach is not longer")
    middle_skid = (
        design["middle_puddle"][0] - 1,
        design["middle_puddle"][1],
    )
    if middle_skid not in design["middle_plant_zone"]:
        raise ValueError("the middle puddle cannot skid into the plant attack zone")

    middle_alive = {
        (r, c)
        for r in range(6, 11)
        for c in range(CITY_SIZE)
        if grid[r][c] != WALL
        and (r, c) not in design["middle_plant_zone"]
    }
    middle_without_puddle = middle_alive - {
        design["middle_puddle"], _mirror(design["middle_puddle"])
    }
    safe_middle_shortest = _shortest_path(
        design["middle_junction"],
        design["middle_pipe_entry"],
        middle_without_puddle,
    )
    if len(middle_risky) >= len(safe_middle_shortest):
        raise ValueError("the middle puddle shortcut is not shorter than the safe route")

    top_safe = design["top_safe"]
    top_main = design["top_initial"] + top_safe + design["top_finish"]
    top_spur = design["top_tomato_spur"]
    top_tomato_safe = design["top_tomato_safe"]
    if design["top_tomato"] in top_main:
        raise ValueError("the final tomato must be a detour off the main route")
    if (
        top_spur[0] != design["top_entry"]
        or top_spur[-1] != design["top_entry"]
        or design["top_tomato"] not in top_spur
    ):
        raise ValueError("the final tomato is not a returning dead-end detour")
    if any(grid[r][c] == WALL for r, c in top_main + top_spur):
        raise ValueError("a generated top-room route is blocked")
    if any(grid[r][c] == WALL for r, c in top_tomato_safe):
        raise ValueError("the safe final-tomato detour is blocked")
    if set(top_safe) & (design["top_plant_zone"] | set(world.slip)):
        raise ValueError("the final safe route contains a hazard")
    if design["top_puddle"] not in top_spur:
        raise ValueError("the final puddle is not a tomato shortcut")
    if set(top_tomato_safe) & set(world.slip):
        raise ValueError("the longer final-tomato approach contains a puddle")
    if len(top_tomato_safe) <= len(top_spur):
        raise ValueError("the dry final-tomato approach is not longer")


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
