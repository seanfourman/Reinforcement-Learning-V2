"""Round 2 - New Donk City (Every-visit MC vs First-visit MC).

The Monte-Carlo round, and a real GAMBLE. A PROCEDURALLY-GENERATED, left-right
mirror-symmetric park maze (regenerated from the world SEED, exactly like Round 1's
castle) whose hedges are the walls. The twist is fixed on every seed: the Power Star
sits in a SEALED antechamber at the top-centre with NO walk-in path - the ONLY way
in is to dive into a WARP PIPE and get spat out next to it. Scattered through the
maze are SPIKE TRAPS and PIRANHA PLANTS (instant death), so a model cannot just walk
to the goal; it must learn - from episode returns alone - that reaching a pipe and
GAMBLING on the random warp beats death and beats wandering. That expected-value-
under-randomness lesson is exactly what Monte-Carlo control is for.

Mechanics (see env.py):
  * SPIKE TRAP  - a floor tile that kills on entry.
  * PIRANHA PLANT - an impassable tile whose 4 orthogonal neighbours kill on entry.
  * WARP PIPE   - stepping onto one teleports you to a UNIFORMLY-RANDOM destination
                  from its list (the gamble); one destination sits by the goal.

Everything is mirrored about the centre column, so both spawns face the identical
maze reflected: a fair race. Hazards are placed so a SAFE route to a pipe (and thus
the goal) always exists (asserted by ``validate``). Coordinates are (row, col),
row 0 = NORTH (goal), row 19 = SOUTH (spawns); the theme camera flips the view.
"""
import random

from .grid import World, validate, SIZE, WALL, FLOOR, ESCAPE, ORTHO

THEME = "city"
ROUND_ID = 2
TITLE = "New Donk City"

# maze geometry: a BOARD-wide mirror maze fills the board BELOW a sealed goal room
BOARD = 15
LO = (SIZE - BOARD) // 2        # 2   left/right margin (also the goal room's flanks)
HI = LO + BOARD - 1             # 16  last maze row/col
MID = (LO + HI) // 2            # 9   mirror axis + the goal's column
TOP = 4                         # first maze cell row (rows 0-3 reserved for the goal room)
HALF_C = ((BOARD + 1) // 2) // 2   # 4   left-half maze cell columns
BRAID_P = 0.34                  # heavy braiding -> an OPEN maze (short, forgiving paths
                                # Monte-Carlo can actually learn, unlike a tight perfect maze)

# defaults for the tunable hazard counts (panel-overridable, see match.set_params)
DEF_SPIKES = 3                  # spike traps PER SIDE (mirrored -> ~6 total)
DEF_PLANTS = 1                  # piranha plants per side
DEF_DESTS = 3                   # warp-pipe destinations (the gamble breadth); 1 lands by goal


def _mirror(c):
    return LO + HI - c          # 2<->16, ... , 9<->9


def _cell(cr, cc):
    return (TOP + 2 * cr, LO + 2 * cc)     # maze cell (cr, cc) -> grid position


def _neighbours(cell):
    return [(cell[0] + dr, cell[1] + dc) for dr, dc in ORTHO]


def generate(seed=None, n_spikes=DEF_SPIKES, n_plants=DEF_PLANTS, n_dests=DEF_DESTS, **_):
    rng = random.Random(seed)
    n_spikes = max(0, min(10, int(n_spikes)))
    n_plants = max(0, min(4, int(n_plants)))
    n_dests = max(2, min(5, int(n_dests)))
    g = [[WALL] * SIZE for _ in range(SIZE)]
    cells_r = (HI - TOP) // 2 + 1          # 7 maze cell rows (rows 4..16)

    # --- carve the LEFT half of the maze via a DFS backtracker ----------------
    seen = set()

    def carve(cr, cc):
        seen.add((cr, cc))
        r, c = _cell(cr, cc)
        g[r][c] = FLOOR
        dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        rng.shuffle(dirs)
        for dr, dc in dirs:
            nr, nc = cr + dr, cc + dc
            if 0 <= nr < cells_r and 0 <= nc < HALF_C and (nr, nc) not in seen:
                mr, mc = _cell(nr, nc)
                g[(r + mr) // 2][(c + mc) // 2] = FLOOR    # open the wall between
                carve(nr, nc)

    carve(cells_r - 1, 0)                   # start bottom-left

    # --- mirror the left half onto the right ---------------------------------
    for r in range(SIZE):
        for c in range(LO, MID):
            if g[r][c] == FLOOR:
                g[r][_mirror(c)] = FLOOR

    # --- connect the two halves across the centre column ---------------------
    links = [r for r in range(TOP, HI + 1)
             if g[r][MID - 1] == FLOOR and g[r][MID + 1] == FLOOR]
    for r in (rng.sample(links, min(3, len(links))) if links else []):
        g[r][MID] = FLOOR

    # --- braid: open some walls between two floor cells -> loops (choices) ----
    for r in range(TOP, HI + 1):
        for c in range(LO, MID):
            if g[r][c] == WALL and (
                    (g[r][c - 1] == FLOOR and g[r][c + 1] == FLOOR) or
                    (g[r - 1][c] == FLOOR and g[r + 1][c] == FLOOR)):
                if rng.random() < BRAID_P:
                    g[r][c] = FLOOR
                    g[r][_mirror(c)] = FLOOR

    # --- bottom plaza (open lawn) for the spawns -----------------------------
    for r in range(HI + 1, SIZE - 1):
        for c in range(1, SIZE - 1):
            g[r][c] = FLOOR
    blue_spawn, red_spawn = (SIZE - 2, 1), (SIZE - 2, SIZE - 2)

    # --- FORCE a clear SAFE LANE up each side ---------------------------------
    # A straight, always-open column from the plaza to the pipe. It guarantees a
    # learnable route to a pipe on EVERY seed (kept hazard-free below), so Monte-Carlo
    # never faces an unsolvable random maze - the variation lives in the centre.
    LANE = LO                              # col 2, mirrored to col 16
    for r in range(TOP, SIZE - 1):
        g[r][LANE] = FLOOR
        g[r][_mirror(LANE)] = FLOOR

    # --- the SEALED goal antechamber (top-centre, pipe-only) -----------------
    goals = [(0, MID), (0, MID + 1)]
    for (r, c) in goals:
        g[r][c] = ESCAPE
    for r in (1, 2):                        # the little room: cols 8-11, rows 1-2
        for c in (MID - 1, MID, MID + 1, MID + 2):
            g[r][c] = FLOOR
    # rows 0/3 and cols 7/12 around it stay WALL -> nothing can WALK in.
    ante = [(2, MID - 1), (2, MID + 2)]     # where pipes spit you out, by the star

    # ---- reachability helpers (BFS over SAFE floor + pipe teleport edges) ----
    def floor_cells():
        return [(r, c) for r in range(SIZE) for c in range(SIZE) if g[r][c] != WALL]

    def safe_reach(spawn, spikes, plants, pipes):
        lethal = set(spikes)
        for (pr, pc) in plants:
            for nb in _neighbours((pr, pc)):
                if 0 <= nb[0] < SIZE and 0 <= nb[1] < SIZE and g[nb[0]][nb[1]] != WALL:
                    lethal.add(nb)
        warp = {}
        for p in pipes:
            warp.setdefault(p["entry"], []).extend(p["dests"])
        goalset = set(goals)
        seen2, stack = {spawn}, [spawn]
        while stack:
            cur = stack.pop()
            for nb in _neighbours(cur) + warp.get(cur, []):
                r, c = nb
                if nb in seen2 or not (0 <= r < SIZE and 0 <= c < SIZE):
                    continue
                if g[r][c] == WALL or nb in plants:
                    continue
                if nb in lethal and nb not in goalset:
                    continue
                seen2.add(nb)
                stack.append(nb)
        return seen2

    # ---- WARP PIPES: one partway up each side LANE; the gamble. A miss lands just
    # below the pipe ON the lane (a cheap 1-step re-dive); one dest lands by the goal. --
    pipe_row = rng.randrange(TOP + 2, HI - 3)          # a mid spot on the lane
    entry_l, entry_r = (pipe_row, LANE), (pipe_row, _mirror(LANE))
    lane_below = [(pipe_row + 1, LANE), (pipe_row + 2, LANE), (pipe_row - 1, LANE)]
    lane_below = [d for d in lane_below if TOP <= d[0] < SIZE - 1][:max(1, n_dests - 1)]
    dests_l = [ante[0]] + lane_below
    dests_r = [ante[1]] + [(r, _mirror(c)) for (r, c) in lane_below]
    pipes = [{"entry": entry_l, "dests": dests_l},
             {"entry": entry_r, "dests": dests_r}]

    # keep the spawn, BOTH side lanes (route + pipe + dests), and the antechamber
    # hazard-free, so the guaranteed route to the goal is never a death-trap
    reserved = {blue_spawn, red_spawn, entry_l, entry_r} | set(ante) | set(goals)
    reserved |= set(dests_l) | set(dests_r)
    for r in range(TOP, SIZE - 1):
        reserved.add((r, LANE))
        reserved.add((r, _mirror(LANE)))
    reserved |= {(r, _mirror(c)) for (r, c) in reserved}

    # ---- SPIKE TRAPS: floor cells that keep a SAFE route open (added only if the
    # goal stays reachable-alive with them in). Placed on the LEFT, mirrored. --------
    spikes = []
    all_dests = {d for p in pipes for d in p["dests"]}
    # spikes cluster in the CENTRAL columns (a deadly decoy up the middle toward the
    # goal), leaving the side route to the pipe clean; mirrored across the axis
    spike_pool = [cell for cell in floor_cells()
                  if LO + 3 <= cell[1] <= MID and cell not in reserved
                  and cell[0] >= TOP and cell not in all_dests]
    rng.shuffle(spike_pool)
    for cell in spike_pool:
        if len(spikes) >= 2 * n_spikes:
            break
        pair = [cell, (cell[0], _mirror(cell[1]))]
        trial = spikes + pair
        if all(set(goals) & safe_reach(sp, trial, [], pipes)
               for sp in (blue_spawn, red_spawn)):
            spikes.extend(pair)

    # ---- PIRANHA PLANTS: impassable wall tiles beside a corridor, mirror pair. A plant
    # kills its NEIGHBOURS, so it must neither seal off the only safe route NOR make a
    # pipe destination/entry/spawn lethal (else a warp could land you dead - the gamble
    # must be "retry", never "instant death"). -----------------------------------------
    plants = []
    plant_pool = [(r, c) for r in range(TOP, HI + 1) for c in range(LO, MID)
                  if g[r][c] == WALL and (r, c) not in reserved
                  and sum(1 for nb in _neighbours((r, c))
                          if 0 <= nb[0] < SIZE and 0 <= nb[1] < SIZE and g[nb[0]][nb[1]] == FLOOR) >= 1]
    rng.shuffle(plant_pool)
    for (r, c) in plant_pool:
        if len(plants) >= 2 * n_plants:
            break
        pair = [(r, c), (r, _mirror(c))]
        kill_zone = {nb for p in pair for nb in _neighbours(p)}
        if kill_zone & reserved:               # never make the safe lane / a warp / spawn deadly
            continue
        trial = plants + pair
        if all(set(goals) & safe_reach(sp, spikes, trial, pipes)
               for sp in (blue_spawn, red_spawn)):
            plants.extend(pair)

    world = World(
        g, theme=THEME, round_id=ROUND_ID, title=TITLE, objective="cross",
        red_spawn=red_spawn, blue_spawn=blue_spawn, escape=goals, shine=goals,
        spikes=spikes, plants=plants, pipes=pipes,
    )
    validate(world)
    return world


if __name__ == "__main__":
    for s in (1, 2, 3):
        w = generate(seed=s)
        spikes, plants = set(w.spikes), set(w.plants)
        entries = {p["entry"] for p in w.pipes}
        dests = {d for p in w.pipes for d in p["dests"]}
        goals = {tuple(e) for e in w.escape}
        floor = sum(row.count(FLOOR) for row in w.rows())
        print(f"\nseed {s}: {floor} floor, spawns {w.red_spawn}/{w.blue_spawn}, "
              f"{len(spikes)} spikes, {len(plants)} plants, "
              f"pipes {[(p['entry'], len(p['dests'])) for p in w.pipes]}")
        for r, row in enumerate(w.rows()):
            line = ""
            for c, ch in enumerate(row):
                cell = (r, c)
                line += ("G" if cell in goals else "R" if cell == w.red_spawn
                         else "B" if cell == w.blue_spawn else "P" if cell in plants
                         else "^" if cell in spikes else "O" if cell in entries
                         else "x" if cell in dests else ch)
            print(line)
