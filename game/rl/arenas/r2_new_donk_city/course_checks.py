"""The city course design validator: every rule a seeded course must obey.

Run on every generated world (see ``world.generate``): mirror symmetry, the
sealed dividers, exactly three sections, the mirrored tomatoes, the
longer-safe / shorter-risky route inequalities in all three rooms, mandatory
puddles that really gate their shortcuts, plant zones clear of bushes, and
sane Pipe landings. A violated rule raises immediately, so a bad seed can
never ship a broken course - the generator retries at a different density
instead.
"""

from core.worldgen import WALL

from .course_tools import (CITY_SIZE, DIVIDER_ROWS, BOTTOM_TOP,
                           _mirror, _surrounding, _shortest_path,
                           _component_count)

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
