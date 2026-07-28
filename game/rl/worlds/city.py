"""Round 2 - New Donk City foundation.

The arena currently contains:

* a 19x19 open board;
* two seeded, non-straight bush dividers that form three horizontal sections;
* mirrored spawns and the shared top-centre goal.
* a mirrored decision maze in the bottom section;
* one shared centre Pipe into the second section.

The left half of each divider is generated from the seed and reflected for the
right half, so both racers always receive exactly the same geometry.  Each
divider is sealed from edge to edge: the three sections are intentionally
disconnected except for Pipes.  The bottom room has a required dead-end tomato
spur off the main approach, followed by a short slippery route and a longer
safe route. Both racers' routes merge at one centre Pipe locked by their own
tomato. Its visible exit Pipe is in the second section.
"""

import random
from collections import deque

from .grid import World, WALL, FLOOR, ESCAPE

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

CITY_SIZE = 19
GOALS = ((0, 9),)
DIVIDER_ROWS = ((5, 6), (11, 12))
BOTTOM_TOP = 13

# Kept for compatibility with Match's existing Round-2 generator arguments.
DEF_PLANTS = 1
DEF_SLIP = 1
MAX_PLANTS = 1
MAX_SLIP = 1


def _mirror(cell):
    r, c = cell
    return r, CITY_SIZE - 1 - c


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
    rng, protected, forced, plants, plant_zone, divider_cells
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
        for r in range(BOTTOM_TOP, CITY_SIZE)
        for c in range(CITY_SIZE // 2)
        if (r, c) not in protected
        and _mirror((r, c)) not in protected
        and (r, c) not in forced
        and _mirror((r, c)) not in forced
        and (r, c) not in plant_set
        and _mirror((r, c)) not in plant_set
        and (r, c) not in plant_zone
        and _mirror((r, c)) not in plant_zone
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
        blocked = set(divider_cells) | walls | plant_set
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
    pipe_dest = (10, 9)
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
    # When the lower divider occupies row 11, the floor immediately below it
    # on row 12 belongs to the bottom room. Keep its row-13 continuation open;
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
        set().union(*dividers)
    )
    for r, c in maze_walls | set(plants):
        grid[r][c] = WALL

    hedges = set().union(*dividers) | maze_walls
    hedges -= set(plants)
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
        plants=plants,
        pipes=pipes,
        slip=slip,
        red_stars=[_mirror(tomato)],
        blue_stars=[tomato],
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
        raise ValueError("bottom-room tomatoes are not mirrored")
    if len(world.blue_stars) != 1:
        raise ValueError("bottom room needs exactly one tomato per racer")

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

    if len(world.plants) != 2 or len(world.slip) != 2:
        raise ValueError("bottom room needs one mirrored plant and puddle")
    if len(world.pipes) != 1:
        raise ValueError("bottom room needs exactly one shared centre Pipe")
    if any(r < BOTTOM_TOP for r, _ in world.plants + world.slip):
        raise ValueError("a bottom-room hazard escaped into another section")
    if any(grid[r][c] != WALL for r, c in world.plants):
        raise ValueError("Piranha Plant cells must be impassable")
    if set(world.plants) & hedges:
        raise ValueError("a Piranha Plant was rendered as a bush")
    if hedges & design["plant_zone"]:
        raise ValueError("a bush generated inside a Piranha Plant attack zone")

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
    pipe = world.pipes[0]
    if _mirror(pipe["entry"]) != pipe["entry"]:
        raise ValueError("the shared Pipe entrance is not centred")
    if _mirror(pipe["exit"]) != pipe["exit"]:
        raise ValueError("the shared Pipe exit is not centred")
    if pipe["exit"] != design["pipe_dest"]:
        raise ValueError("the visible exit Pipe does not match the warp destination")
    if any(pipe.get("requiresStar") != 0 for pipe in world.pipes):
        raise ValueError("the bottom-room Pipe is not locked by its tomato")


def generate(seed=None, **_):
    """Return the same arena for the same seed and a new shape for a new seed."""
    base_seed = 0 if seed is None else seed
    rng = random.Random(f"new-donk-foundation:{base_seed}")
    world, design = _build(rng)
    # Generic world validation still requires a full spawn-to-goal route.  Only
    # the bottom room has a Pipe so far; the upper divider remains intentionally
    # sealed until its own decision room is added.
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
