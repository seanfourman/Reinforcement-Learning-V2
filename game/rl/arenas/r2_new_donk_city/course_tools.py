"""The city course generator's toolbox: board constants + carving helpers.

Shared by ``world.py`` (which assembles the three-room course) and
``course_checks.py`` (which validates each seeded design). Everything here is
pure geometry over the 19x19 board: mirroring, orthogonal lines and paths, the
sealed stair-step dividers, the safe-vs-risky decision barrier, and the
seeded bush scatterer that fills each room without ever sealing a route.
"""

from collections import deque

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
