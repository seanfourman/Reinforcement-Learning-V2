"""Round 2 - New Donk City (Every-visit MC vs First-visit MC).

THE COLLECT-3-STARS RACE. A PROCEDURALLY-GENERATED, left-right mirror-symmetric
hedge park (regenerated from the world SEED like Round 1's castle): we build ONLY
the LEFT half and REFLECT it, so both racers face the identical layout. Each agent
must gather its OWN three Power Stars - one in each of three sections of the park -
and the final goal at the top stays LOCKED until all three are held; stepping on it
with fewer than three does nothing (see env.py's ``star_mode``). So a model cannot
just walk to the goal: it has to plan a full collection tour.

The park is threaded by a WARP-PIPE NETWORK (6-8 pipes, mirrored). Each pipe has 2-3
FIXED destinations with FIXED probabilities (baked into the seed, never re-rolled per
episode), so a pipe is a STATIONARY stochastic teleport - Markov, and exactly what
Monte-Carlo control is built to value. Pipes CHAIN (one spits you out at another's
mouth) and LOOP (a chain can cycle back), giving fast-but-risky routes that rival the
slow safe walk. SPIKE TRAPS and PIRANHA PLANTS (instant death) and slippery PUDDLES
lace the risky routes. A guaranteed hazard-free SAFE CORRIDOR always exists from each
spawn through all three of that side's stars to the goal, so the task stays learnable.

Mechanics (see env.py):
  * POWER STAR   - collect all 3 (per agent) to UNLOCK the goal.
  * SPIKE TRAP   - a floor tile that kills on entry.
  * PIRANHA PLANT- an impassable tile whose 8 neighbours (incl. diagonals) kill on entry.
  * PUDDLE       - a slippery floor tile: a move may skid to a perpendicular tile.
  * WARP PIPE    - stepping onto an ENTRY teleports you to one of its FIXED-probability
                   destinations. Destinations are walkable (you pop out and keep going).

Coordinates are (row, col), row 0 = NORTH (goal), row 19 = SOUTH (spawns); the theme
camera flips the view so the goal reads on top.
"""
import random

from .grid import World, validate, SIZE, WALL, FLOOR, ESCAPE, ORTHO

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

AX = 9                              # mirror axis column (self-mirror); mirror(c) = 18 - c
LANE = 5                            # the SAFE corridor column on the left (mirror -> col 13)
ALT_L, ALT_R = 2, 7                # the two alternate/pipe lane columns on the left
STAR_ROWS = (13, 8, 3)             # the three star heights: low / mid / high section
GOAL = (0, AX)                     # single walkable goal cell at top-centre

DEF_SPIKES = 3                     # spike traps per side (mirrored)
DEF_PLANTS = 2                     # piranha plants per side
DEF_DESTS = 3                      # destinations per warp pipe (2..3, the gamble breadth)
DEF_SLIP = 2                       # slippery puddles per side

# The navigation grid uses WALL cells as collision, and the city renderer turns every
# WALL into a hedge. Keep an open lawn band around the actual maze so generation can
# never produce the unwanted rectangular bush outline. The right band is one column
# wider because this layout mirrors around column 9 (``18 - c``), leaving column 19
# outside the mirrored play area.
HEDGE_OUTLINE = frozenset(
    (r, c)
    for r in range(SIZE)
    for c in range(SIZE)
    if r < 3 or r >= 16 or c < 2 or c >= 17
)


def _mirror(c):
    return 18 - c                   # 1<->17, 2<->16, 5<->13, 9<->9


def _nbrs(cell):
    return [(cell[0] + dr, cell[1] + dc) for dr, dc in ORTHO]


def _king(cell):                    # the 8 neighbours (a plant's kill zone, incl diagonals)
    return [(cell[0] + dr, cell[1] + dc)
            for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]


def generate(seed=None, n_spikes=DEF_SPIKES, n_plants=DEF_PLANTS,
             n_dests=DEF_DESTS, n_slip=DEF_SLIP, **_):
    n_spikes = max(0, min(8, int(n_spikes)))
    n_plants = max(0, min(4, int(n_plants)))
    n_dests = max(2, min(3, int(n_dests)))
    n_slip = max(0, min(6, int(n_slip)))

    # The static skeleton (corridors, stars, pipes, goal) is DETERMINISTIC from the
    # geometry; only the hazard scatter is seed-random, so we re-roll just that until
    # every safety invariant holds. A couple of hundred tries is always enough.
    for attempt in range(200):
        rng = random.Random((seed if seed is not None else 0) * 131 + attempt)
        world = _build(rng, n_spikes, n_plants, n_dests, n_slip)
        if world is not None:
            validate(world)
            return world
    # Fallback: the skeleton with NO hazards (always valid and learnable).
    rng = random.Random(seed)
    world = _build(rng, 0, 0, n_dests, 0)
    validate(world)
    return world


def _build(rng, n_spikes, n_plants, n_dests, n_slip):
    g = [[WALL] * SIZE for _ in range(SIZE)]

    def carve(cells):
        for (r, c) in cells:
            if 0 <= r < SIZE and 0 <= c < SIZE:
                g[r][c] = FLOOR

    def col(c, r0, r1):
        return [(r, c) for r in range(min(r0, r1), max(r0, r1) + 1)]

    def row(r, c0, c1):
        return [(r, c) for c in range(min(c0, c1), max(c0, c1) + 1)]

    # ---- LEFT-half skeleton (mirrored to the right afterwards) ----------------
    # spawn plaza (open lawn, bottom rows) - links the two lanes and both halves
    for r in range(16, SIZE - 1):
        carve(row(r, 1, AX))
    spawn = (SIZE - 2, LANE)                      # (18, 5)

    # the SAFE CORRIDOR: straight up column LANE, through all three stars, to the top
    carve(col(LANE, 1, 16))
    stars = [(sr, LANE) for sr in STAR_ROWS]      # (13,5) (8,5) (3,5)

    # the two ALTERNATE / pipe lanes and the connectors that weave them into loops
    carve(col(ALT_L, 3, 16))                      # left lane, col 2
    carve(col(ALT_R, 5, 15))                      # right lane, col 7
    for r in (16, 13, 10, 8, 5, 3):               # rungs -> real route choices + loops
        carve(row(r, ALT_L, ALT_R))
    # top link: corridor -> axis -> goal (mirror completes the right approach)
    carve(row(1, LANE, AX))
    carve([(1, AX), GOAL])
    g[GOAL[0]][GOAL[1]] = ESCAPE

    # ---- WARP-PIPE NETWORK (left side; mirrored) ------------------------------
    # Chains: P1 -> P2 mouth and P1 -> P3 mouth. Loop: P2 -> (12,7) -> walk back to
    # P1's mouth (15,7) -> re-dive. All destinations sit well below the goal, so no
    # pipe (or chain) is ever a spawn->goal shortcut. Weights are FIXED.
    raw_pipes = [
        ((15, ALT_R), [((10, ALT_R), 0.5), ((14, ALT_L), 0.3), ((12, LANE), 0.2)]),
        ((10, ALT_R), [((5, ALT_R), 0.5), ((12, ALT_R), 0.3), ((7, ALT_L), 0.2)]),
        ((14, ALT_L), [((8, ALT_L), 0.5), ((3, ALT_L), 0.3), ((11, ALT_L), 0.2)]),
    ]
    pipes = []
    for entry, dw in raw_pipes:
        dw = dw[:n_dests]
        dests = [d for d, _ in dw]
        weights = [w for _, w in dw]
        carve([entry] + dests)                    # a pipe's mouth + landings are floor
        # mirror twin
        m_entry = (entry[0], _mirror(entry[1]))
        m_dests = [(r, _mirror(c)) for (r, c) in dests]
        carve([m_entry] + m_dests)
        pipes.append({"entry": entry, "dests": dests, "weights": weights, "exit": None})
        pipes.append({"entry": m_entry, "dests": m_dests, "weights": list(weights), "exit": None})

    # ---- reflect the whole left skeleton onto the right -----------------------
    for r in range(SIZE):
        for c in range(1, AX):
            if g[r][c] == FLOOR:
                g[r][_mirror(c)] = FLOOR

    red_spawn = (spawn[0], _mirror(spawn[1]))
    blue_spawn = spawn
    goals = [GOAL]
    blue_stars = stars
    red_stars = [(r, _mirror(c)) for (r, c) in stars]

    # cells that must NEVER become a hazard: spawns, goal, the safe corridors + their
    # top links, every star, and every pipe mouth/landing (a warp must never drop you
    # onto death). Mirror-completed so both halves stay symmetric.
    entries = {p["entry"] for p in pipes}
    dests = {d for p in pipes for d in p["dests"]}
    safe = set()
    safe |= set(col(LANE, 1, 16)) | set(row(1, LANE, AX)) | {(1, AX), GOAL}
    safe |= set(blue_stars) | {blue_spawn}
    reserved = set(safe)
    reserved |= entries | dests | {blue_spawn, red_spawn} | set(goals)
    reserved |= set(blue_stars) | set(red_stars)
    reserved |= {(r, _mirror(c)) for (r, c) in reserved}
    reserved |= HEDGE_OUTLINE

    floor_cells = [(r, c) for r in range(SIZE) for c in range(SIZE) if g[r][c] == FLOOR]

    def warp_edges():
        w = {}
        for p in pipes:
            w.setdefault(p["entry"], []).extend(p["dests"])
        return w

    def lethal_of(spikes, plants):
        lethal = set(spikes)
        for (pr, pc) in plants:
            for nb in _king((pr, pc)):
                if 0 <= nb[0] < SIZE and 0 <= nb[1] < SIZE and g[nb[0]][nb[1]] != WALL:
                    lethal.add(nb)
        return lethal

    def alive_reach(start, spikes, plants):
        """Cells reachable from ``start`` walking (+ pipe warps) WITHOUT stepping on a
        lethal tile. Pipe entries add teleport edges to every destination."""
        lethal, warp = lethal_of(spikes, plants), warp_edges()
        goalset = set(goals)
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

    def spec_ok(spikes, plants):
        # every star + the goal must be reachable ALIVE from each spawn...
        for sp, sstars in ((blue_spawn, blue_stars), (red_spawn, red_stars)):
            reach = alive_reach(sp, spikes, plants)
            if not all(s in reach for s in sstars) or GOAL not in reach:
                return False
        # ...the safe corridor stays hazard-free (learnable low-variance route)...
        if any(s in reserved for s in spikes):
            return False
        # ...no pipe landing is lethal or a permanent TRAP (must still reach the goal)...
        lethal = lethal_of(spikes, plants)
        for d in dests:
            if d in lethal or GOAL not in alive_reach(d, spikes, plants):
                return False
        return True

    # ---- SPIKE TRAPS: risk on the alternate lanes; sample + validate ----------
    spikes = []
    spike_pool = [c for c in floor_cells if c[1] < AX and c not in reserved]
    rng.shuffle(spike_pool)
    for cpos in spike_pool:
        if len(spikes) >= 2 * n_spikes:
            break
        pair = [cpos, (cpos[0], _mirror(cpos[1]))]
        if spec_ok(spikes + pair, []):
            spikes.extend(pair)

    # ---- PIRANHA PLANTS: impassable wall tiles hugging a corridor -------------
    plants = []
    plant_pool = [(r, c) for r in range(1, SIZE - 1) for c in range(1, AX)
                  if g[r][c] == WALL and (r, c) not in reserved
                  and any(0 <= nb[0] < SIZE and 0 <= nb[1] < SIZE and g[nb[0]][nb[1]] == FLOOR
                          for nb in _nbrs((r, c)))]
    rng.shuffle(plant_pool)
    for (r, c) in plant_pool:
        if len(plants) >= 2 * n_plants:
            break
        pair = [(r, c), (r, _mirror(c))]
        if {nb for p in pair for nb in _king(p)} & reserved:      # 8-cell kill zone clear of safe cells
            continue
        if spec_ok(spikes, plants + pair):
            plants.extend(pair)

    # a build is only accepted if BOTH racers can still complete the tour alive
    if not spec_ok(spikes, plants):
        return None

    # ---- SLIPPERY PUDDLES: a few scattered non-lethal floor tiles -------------
    lethal_now = lethal_of(spikes, plants)
    slip = []
    slip_pool = [c for c in floor_cells
                 if c[1] < AX and c not in reserved and c not in lethal_now and c not in spikes]
    rng.shuffle(slip_pool)
    for cpos in slip_pool:
        if len(slip) >= 2 * n_slip:
            break
        if all(abs(cpos[0] - o[0]) + abs(cpos[1] - o[1]) > 2 for o in slip):
            slip.extend([cpos, (cpos[0], _mirror(cpos[1]))])

    # The outline cells are open lawn, not maze hedges. Do this after hazard
    # placement so opening the exterior never adds traps/puddles to the new lawn.
    # Re-apply the escape marker because the goal lives on the north edge.
    carve(HEDGE_OUTLINE)
    g[GOAL[0]][GOAL[1]] = ESCAPE

    world = World(
        g, theme=THEME, round_id=ROUND_ID, title=TITLE, objective="cross",
        red_spawn=red_spawn, blue_spawn=blue_spawn, escape=goals, shine=goals,
        spikes=spikes, plants=plants, pipes=pipes, slip=slip,
        red_stars=red_stars, blue_stars=blue_stars,
    )
    remaining_outline = [(r, c) for (r, c) in HEDGE_OUTLINE if world.grid[r][c] == WALL]
    if remaining_outline:
        raise ValueError(f"city generated a hedge outline at {remaining_outline[:5]}")
    return world


if __name__ == "__main__":
    for s in (1, 2, 3):
        w = generate(seed=s)
        spikes, plants, slip = set(w.spikes), set(w.plants), set(w.slip)
        entries = {p["entry"] for p in w.pipes}
        dests = {d for p in w.pipes for d in p["dests"]}
        rstars, bstars = set(w.red_stars), set(w.blue_stars)
        goals = {tuple(e) for e in w.escape}
        floor = sum(row.count(FLOOR) for row in w.rows())
        sym = all(w.grid[r][c] == w.grid[r][_mirror(c)]
                  for r in range(SIZE) for c in range(1, SIZE - 1))
        print(f"\nseed {s}: {floor} floor, symmetric={sym}, spikes={len(spikes)} "
              f"plants={len(plants)} slip={len(slip)} pipes={len(w.pipes)} "
              f"dests/pipe={[len(p['dests']) for p in w.pipes]}")
        for r, rowstr in enumerate(w.rows()):
            line = ""
            for c, ch in enumerate(rowstr):
                cell = (r, c)
                line += ("G" if cell in goals else "R" if cell == w.red_spawn
                         else "B" if cell == w.blue_spawn
                         else "*" if cell in rstars or cell in bstars
                         else "P" if cell in plants else "^" if cell in spikes
                         else "O" if cell in entries else "~" if cell in slip
                         else "x" if cell in dests else ch)
            print(line)
