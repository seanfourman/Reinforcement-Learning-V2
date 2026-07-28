"""Round 2 - New Donk City foundation.

The arena currently contains:

* a 20x20 open board;
* two seeded, non-straight bush dividers that form three horizontal sections;
* mirrored spawns and the shared top-centre goal.
* a mirrored decision maze in the bottom section.

The left half of each divider is generated from the seed and reflected for the
right half, so both racers always receive exactly the same geometry.  Each
divider is sealed from edge to edge: the three sections are intentionally
disconnected except for Pipes.  The bottom room has a required dead-end tomato
spur off the main approach, followed by a short slippery route and a longer
safe route. Both routes merge at a Pipe locked by that tomato.
"""

import random

from .grid import World, SIZE, WALL, FLOOR, ESCAPE

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

GOALS = ((0, 9), (0, 10))
DIVIDER_ROWS = ((6, 7), (13, 14))

# Kept for compatibility with Match's existing Round-2 generator arguments.
DEF_PLANTS = 1
DEF_SLIP = 1
MAX_PLANTS = 1
MAX_SLIP = 1


def _mirror(cell):
    r, c = cell
    return r, SIZE - 1 - c


def _left_steps(rng, first=None):
    """Ten binary steps with horizontal runs no longer than two cells."""
    steps = [rng.randint(0, 1) if first is None else first]
    run_length = 1
    for _ in range(1, SIZE // 2 - 1):
        if run_length == 2 or rng.random() < 0.58:
            steps.append(1 - steps[-1])
            run_length = 1
        else:
            steps.append(steps[-1])
            run_length += 1

    # The mirrored centre duplicates the last left value. Make that left value
    # a fresh turn so the centre run is exactly two, never three or four.
    steps.append(1 - steps[-1])
    return steps


def _divider(rng, rows):
    """A sealed mirrored stair-step: one bush per column across two rows."""
    # The lower divider begins on its lower row directly above the tomato
    # pocket cap, avoiding a trapped one-cell patch at either board edge.
    first = 1 if rows == DIVIDER_ROWS[-1] else None
    left = _left_steps(rng, first=first)
    steps = left + list(reversed(left))
    cells = {(rows[steps[c]], c) for c in range(SIZE)}
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


def _build(rng):
    grid = [[FLOOR] * SIZE for _ in range(SIZE)]
    dividers = []
    for rows in DIVIDER_ROWS:
        cells = _divider(rng, rows)
        dividers.append(cells)
        for r, c in cells:
            grid[r][c] = WALL

    for r, c in GOALS:
        grid[r][c] = ESCAPE

    blue_spawn = (19, 0)
    red_spawn = _mirror(blue_spawn)

    # Bottom-room route guides.  No horizontal bush run exceeds two cells:
    # the bottom pair forces the spawn onto the tomato approach, while the
    # upper/lower guide groups make the safe and risky lanes visually distinct.
    blue_maze = {
        (19, 1), (19, 2),
        (15, 0), (16, 1), (17, 2),
        (16, 4), (16, 5), (16, 7),
        (18, 4), (18, 7),
    }
    maze_walls = blue_maze | {_mirror(cell) for cell in blue_maze}
    for r, c in maze_walls:
        grid[r][c] = WALL

    pipe_entry = (16, 8)
    pipe_dest = (12, 8)
    tomato = (16, 0)
    spur_base = (18, 0)
    junction = (18, 3)
    water_col = rng.choice((5, 6))
    puddle = (17, water_col)
    plant = (19, water_col)
    plants = [plant, _mirror(plant)]
    slip = [puddle, _mirror(puddle)]
    for r, c in plants:
        grid[r][c] = WALL

    pipes = []
    for reflect in (lambda cell: cell, _mirror):
        pipes.append({
            "entry": reflect(pipe_entry),
            "dests": [reflect(pipe_dest)],
            "weights": [1.0],
            "exit": None,
            "requiresStar": 0,
        })

    initial_path = _join(
        _line(blue_spawn, (18, 0)),
        _line((18, 0), junction),
    )
    tomato_spur = _join(
        _line(spur_base, tomato),
        _line(tomato, spur_base),
    )
    safe_path = _join(
        _line(junction, (15, 3)),
        _line((15, 3), (15, 8)),
        _line((15, 8), pipe_entry),
    )
    risky_path = _join(
        _line(junction, (17, 3)),
        _line((17, 3), (17, 8)),
        _line((17, 8), pipe_entry),
    )

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
        "blue_maze": blue_maze,
        "pipe_entry": pipe_entry,
        "pipe_dest": pipe_dest,
        "tomato": tomato,
        "spur_base": spur_base,
        "tomato_spur": tomato_spur,
        "junction": junction,
        "puddle": puddle,
        "plant": plant,
        "initial_path": initial_path,
        "safe_path": safe_path,
        "risky_path": risky_path,
    }


def _validate_design(world, design):
    grid = world.grid
    hedges = set(world.hedge_cells)

    if world.red_spawn != _mirror(world.blue_spawn):
        raise ValueError("Arena-2 spawns are not mirrored")
    for r in range(SIZE):
        for c in range(SIZE):
            if grid[r][c] != grid[r][SIZE - 1 - c]:
                raise ValueError("Arena-2 board is not mirror-symmetric")

    divider_cells = set().union(*design["dividers"])
    if any(r in (0, SIZE - 1) for r, _ in divider_cells):
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
        if len(cells) != SIZE:
            raise ValueError("a sealed divider must contain one bush in every column")
        if any(sum((r, c) in cells for r in allowed_rows) != 1 for c in range(SIZE)):
            raise ValueError("a divider has a gap or exceeds one-cell thickness")

        for row in allowed_rows:
            run = 0
            for c in range(SIZE):
                run = run + 1 if (row, c) in cells else 0
                if run > 2:
                    raise ValueError("a divider has three bushes in the same row")

    if len(world.plants) != 2 or len(world.slip) != 2 or len(world.pipes) != 2:
        raise ValueError("bottom room needs one mirrored plant, puddle, and Pipe")
    if any(r < 15 for r, _ in world.plants + world.slip):
        raise ValueError("a bottom-room hazard escaped into another section")
    if any(grid[r][c] != WALL for r, c in world.plants):
        raise ValueError("Piranha Plant cells must be impassable")
    if set(world.plants) & hedges:
        raise ValueError("a Piranha Plant was rendered as a bush")

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

    entries = {pipe["entry"] for pipe in world.pipes}
    dests = {dest for pipe in world.pipes for dest in pipe["dests"]}
    if design["pipe_entry"] not in entries or design["pipe_dest"] not in dests:
        raise ValueError("the bottom-room Pipe transfer is missing")
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
