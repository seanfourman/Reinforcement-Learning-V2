"""Round 2 - New Donk City (Every-visit MC vs First-visit MC).

THE COLLECT-3-STARS RACE, played on a REGIONED MAZE. The park is a FULL-BOARD hedge
maze (regenerated from the world SEED like Round 1's castle) that is left-right
mirror-symmetric: we build the LEFT half and REFLECT it (mirror col = 19 - c), so both
racers face the identical layout. The maze fills the WHOLE 20x20 board edge to edge -
there is NO bush border frame - and is carved into FOUR STACKED REGIONS separated by
solid hedge walls:

    Region A (spawn, bottom)  ->  Region B  ->  Region C  ->  Region D (goal, top)

You CANNOT walk between regions - the separator walls are unbroken. The ONLY way up is
the WARP-PIPE NETWORK: each region holds a DIVE pipe that warps to its ONE fixed EXIT
pipe in the region above - you leap into a pipe and pop OUT of a pipe (a fixed pipe ->
pipe pair, never into open ground).

Each agent gathers its OWN three Power Stars - one in each of regions A/B/C - and the
goal at the top stays LOCKED until it holds all three (see env.py's ``star_mode``).

PIRANHA PLANTS (carnivorous) lurk on the hedge walls; a plant's 8 surrounding tiles
(incl. diagonals) kill on entry (death = respawn + penalty, the race continues). There
are NO spike traps. Slippery PUDDLES sit at TACTICAL spots right beside the plants, so a
skid can shove you into a plant's jaws. A hazard-free ALIVE route to every star and the
goal always exists (validated), so the task stays learnable.

Coordinates are (row, col), row 0 = NORTH (goal), row 19 = SOUTH (spawns); the theme
camera flips the view so the goal reads on top.
"""
import random

from .grid import World, validate, SIZE, WALL, FLOOR, ESCAPE, ORTHO

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

# Four stacked regions (row ranges, inclusive), goal-region first. Between every pair
# sits a SOLID separator wall row - unbroken, so regions connect ONLY through pipes.
REGION_D = (0, 3)                   # goal region (top)
REGION_C = (5, 8)
REGION_B = (10, 13)
REGION_A = (15, 19)                # spawn region (bottom)
SEP_ROWS = (4, 9, 14)             # solid hedge walls separating the four regions
REGIONS = (REGION_A, REGION_B, REGION_C, REGION_D)

GOALS = [(0, 9), (0, 10)]         # the two mirror-symmetric goal cells (top centre)

DEF_PLANTS = 2                     # piranha plants per side (mirrored)
DEF_SLIP = 3                       # slippery puddles per side (mirrored)
WALL_DENSITY = 0.24                # target hedge-wall fraction per region. The maze FILLS
                                   # the whole board (the look), but the star tour stays in
                                   # the central columns and short (so MC stays learnable).


def _mirror(c):
    return 19 - c                   # (0,19) (1,18) ... (9,10): full-board symmetry, no orphan


def _fold(cell):
    """A cell's LEFT-half representative (walls/plants are placed in mirror pairs, so
    protecting the left twin protects both)."""
    r, c = cell
    return (r, c) if c <= 9 else (r, _mirror(c))


def _nbrs(cell):
    return [(cell[0] + dr, cell[1] + dc) for dr, dc in ORTHO]


def _king(cell):                    # the 8 neighbours (a plant's kill zone, incl diagonals)
    return [(cell[0] + dr, cell[1] + dc)
            for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]


def _region_of(r):
    for (r0, r1) in REGIONS:
        if r0 <= r <= r1:
            return (r0, r1)
    return None


def generate(seed=None, n_plants=DEF_PLANTS, n_slip=DEF_SLIP, **_):
    """Build Round 2's regioned maze. Extra keyword args (stale knobs from older configs,
    e.g. n_spikes / n_dests) are accepted and ignored."""
    n_plants = max(0, min(4, int(n_plants)))
    n_slip = max(0, min(8, int(n_slip)))

    # The static skeleton (regions, stars, pipes, goal) is FIXED; the hedge-wall scatter,
    # the piranha plants and the puddles are seed-random, so we re-roll until an ALIVE
    # tour is solvable for both racers.
    for attempt in range(300):
        rng = random.Random((seed if seed is not None else 0) * 131 + attempt)
        world = _build(rng, n_plants, n_slip)
        if world is not None:
            validate(world)
            return world
    # Fallback: no plants (always solvable) + open-ish regions.
    rng = random.Random(seed)
    world = _build(rng, 0, n_slip)
    validate(world)
    return world


def _build(rng, n_plants, n_slip):
    g = [[WALL] * SIZE for _ in range(SIZE)]

    # ---- carve every region as an OPEN band (full width); separators stay walls -------
    for (r0, r1) in REGIONS:
        for r in range(r0, r1 + 1):
            for c in range(SIZE):
                g[r][c] = FLOOR
    for (r, c) in GOALS:
        g[r][c] = ESCAPE

    # ---- fixed skeleton: spawns, stars, DIVE pipes + EXIT pipes -----------------------
    blue_spawn = (19, 6)
    red_spawn = (19, _mirror(6))                  # (19, 13)
    # one blue star per region A/B/C, kept in the LEFT-CENTRAL columns so the vertical
    # climb (spawn -> star -> dive pipe -> ... -> goal) is a short central tour.
    blue_stars = [(17, 5), (12, 5), (7, 5)]
    red_stars = [(r, _mirror(c)) for (r, c) in blue_stars]

    # LEFT-half pipes, each = (DIVE entry, solid EXIT pipe, LANDING tile). Stepping onto the
    # dive pipe warps you to the LANDING - a floor cell right BESIDE a SOLID exit pipe in the
    # region above. You pop out NEXT TO a pipe, never standing ON one, so a pipe is never
    # re-enterable; the landing sits by that region's star + next dive pipe (short climb).
    raw_pipes = [
        ((15, 8), (13, 6), (12, 6)),   # A -> B  (land beside star B)
        ((10, 8), (8, 6), (7, 6)),     # B -> C  (land beside star C)
        ((5, 8), (3, 7), (2, 7)),      # C -> D  (land toward the goal)
    ]
    pipes, exit_walls = [], set()
    for entry, exit_cell, land in raw_pipes:
        me = (entry[0], _mirror(entry[1]))
        mx = (exit_cell[0], _mirror(exit_cell[1]))
        ml = (land[0], _mirror(land[1]))
        pipes.append({"entry": entry, "dests": [land], "weights": [1.0], "exit": exit_cell})
        pipes.append({"entry": me, "dests": [ml], "weights": [1.0], "exit": mx})
        exit_walls |= {exit_cell, mx}
    for (r, c) in exit_walls:                       # a SOLID exit pipe stands here (not a hedge)
        g[r][c] = WALL

    # the goal APPROACH: the central 2-wide column in region D so any landing reaches the goal
    goal_col = [(r, c) for r in range(REGION_D[0], REGION_D[1] + 1) for c in (9, 10)]

    entries = {p["entry"] for p in pipes}
    dests = {d for p in pipes for d in p["dests"]}   # the LANDING tiles (floor, beside a pipe)
    reserved = set()
    reserved |= entries | dests
    reserved |= {blue_spawn, red_spawn}
    reserved |= set(blue_stars) | set(red_stars)
    reserved |= set(goal_col) | set(GOALS)
    no_wall = {_fold(cell) for cell in reserved}     # left-half representatives to protect

    # ---- carve the maze: add hedge walls (mirror pairs) inside each region, keeping the
    # region a single connected component so every star / pipe stays reachable -----------
    for (r0, r1) in REGIONS:
        band = [(r, c) for r in range(r0, r1 + 1) for c in range(SIZE)]
        seed_floor = next((cell for cell in band if cell in reserved), band[0])
        max_removed = int(WALL_DENSITY * len(band))
        removed = 0

        def band_connected():
            seen, stack = {seed_floor}, [seed_floor]
            while stack:
                cur = stack.pop()
                for nb in _nbrs(cur):
                    if nb in seen:
                        continue
                    nr, nc = nb
                    if r0 <= nr <= r1 and 0 <= nc < SIZE and g[nr][nc] != WALL:
                        seen.add(nb)
                        stack.append(nb)
            floors = sum(1 for (r, c) in band if g[r][c] != WALL)
            return len(seen) == floors

        cands = [(r, c) for r in range(r0, r1 + 1)
                 for c in range(0, 10) if (r, c) not in no_wall]
        rng.shuffle(cands)
        for (r, c) in cands:
            if removed >= max_removed:
                break
            pair = {(r, c), (r, _mirror(c))}
            if any(g[pr][pc] != FLOOR for (pr, pc) in pair):   # never wall a goal / already-walled
                continue
            for (pr, pc) in pair:
                g[pr][pc] = WALL
            if band_connected():
                removed += len(pair)
            else:
                for (pr, pc) in pair:                # revert: it split the region
                    g[pr][pc] = FLOOR

    # ---- warp reachability helpers (alive = never stepping into a plant's kill zone) ----
    warp = {}
    for p in pipes:
        warp.setdefault(p["entry"], []).extend(p["dests"])

    def lethal_of(plants):
        lethal = set()
        for pl in plants:
            for nb in _king(pl):
                r, c = nb
                if 0 <= r < SIZE and 0 <= c < SIZE and g[r][c] != WALL:
                    lethal.add(nb)
        return lethal

    def alive_reach(start, plants):
        lethal = lethal_of(plants)
        goalset = set(GOALS)
        seen, stack = {start}, [start]
        while stack:
            cur = stack.pop()
            for nb in _nbrs(cur) + warp.get(cur, []):
                r, c = nb
                if nb in seen or not (0 <= r < SIZE and 0 <= c < SIZE):
                    continue
                if g[r][c] == WALL or nb in plants or (nb in lethal and nb not in goalset):
                    continue
                seen.add(nb)
                stack.append(nb)
        return seen

    def spec_ok(plants):
        lethal = lethal_of(plants)
        if any(d in lethal for d in dests):          # a pipe must never spit you onto death
            return False
        for spawn, stars in ((blue_spawn, blue_stars), (red_spawn, red_stars)):
            reach = alive_reach(spawn, plants)
            if not all(s in reach for s in stars) or not (reach & set(GOALS)):
                return False
        for d in dests:                              # no exit pipe is a sealed dead end
            if not (alive_reach(d, plants) & set(GOALS)):
                return False
        return True

    # ---- PIRANHA PLANTS: sit on hedge-wall cells (impassable); their 8-tile kill zone must
    # avoid every reserved cell, and the ALIVE tour must survive. Placed in mirror pairs. ---
    plants = []
    plant_pool = [(r, c) for r in range(SIZE) for c in range(0, 10)
                  if g[r][c] == WALL and _region_of(r) is not None
                  and (r, c) not in reserved and (r, c) not in exit_walls
                  and any(0 <= nb[0] < SIZE and 0 <= nb[1] < SIZE and g[nb[0]][nb[1]] == FLOOR
                          for nb in _nbrs((r, c)))]
    rng.shuffle(plant_pool)
    for (r, c) in plant_pool:
        if len(plants) >= 2 * n_plants:
            break
        pair = [(r, c), (r, _mirror(c))]
        if {nb for pl in pair for nb in _king(pl)} & reserved:
            continue
        if spec_ok(plants + pair):
            plants.extend(pair)

    if not spec_ok(plants):
        return None

    # ---- SLIPPERY PUDDLES: TACTICAL, right beside the plants - a safe floor tile that sits
    # next to a plant's kill zone, so a skid can shove you into the jaws. Mirror pairs. -----
    lethal_now = lethal_of(plants)
    slip = []
    slip_pool = []
    for pl in (p for p in plants if p[1] < 10):
        for nb in _king(pl):                         # ring-2 floor around the plant
            for nb2 in _nbrs(nb):
                slip_pool.append(nb2)
    for e in (p["entry"] for p in pipes if p["entry"][1] < 10):
        slip_pool.extend(_nbrs(e))                   # fallback: on the pipe approaches
    seen_slip, ordered = set(), []
    for cell in slip_pool:
        if cell not in seen_slip:
            seen_slip.add(cell)
            ordered.append(cell)
    rng.shuffle(ordered)
    for (r, c) in ordered:
        if len(slip) >= 2 * n_slip:
            break
        if not (0 <= r < SIZE and 0 <= c < 10) or g[r][c] == WALL:
            continue
        if (r, c) in reserved or (r, _mirror(c)) in reserved:
            continue
        if (r, c) in lethal_now or (r, c) in slip:   # a puddle you could stand on (not itself death)
            continue
        slip.extend([(r, c), (r, _mirror(c))])

    world = World(
        g, theme=THEME, round_id=ROUND_ID, title=TITLE, objective="cross",
        red_spawn=red_spawn, blue_spawn=blue_spawn, escape=GOALS, shine=GOALS,
        spikes=[], plants=plants, pipes=pipes, slip=slip,
        red_stars=red_stars, blue_stars=blue_stars,
    )
    return world


if __name__ == "__main__":
    for s in (1, 2, 3):
        w = generate(seed=s)
        slip, plants = set(w.slip), set(w.plants)
        entries = {p["entry"] for p in w.pipes}
        dests = {d for p in w.pipes for d in p["dests"]}
        rstars, bstars = set(w.red_stars), set(w.blue_stars)
        goals = {tuple(e) for e in w.escape}
        floor = sum(row.count(FLOOR) for row in w.rows())
        sym = all(w.grid[r][c] == w.grid[r][_mirror(c)] for r in range(SIZE) for c in range(SIZE))
        print(f"\nseed {s}: {floor} floor, symmetric={sym}, spikes={len(w.spikes)} "
              f"plants={len(plants)} slip={len(slip)} pipes={len(w.pipes)} "
              f"dests/pipe={[len(p['dests']) for p in w.pipes]}")
        for r, rowstr in enumerate(w.rows()):
            line = ""
            for c, ch in enumerate(rowstr):
                cell = (r, c)
                line += ("G" if cell in goals else "R" if cell == w.red_spawn
                         else "B" if cell == w.blue_spawn
                         else "*" if cell in rstars or cell in bstars
                         else "P" if cell in plants else "O" if cell in entries
                         else "~" if cell in slip else "x" if cell in dests else ch)
            print(line)
