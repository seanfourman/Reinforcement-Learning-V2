"""Round 3 (Fossil Falls) invariants: the symmetric 1-thick-wall Goomba maze race."""

from collections import deque
from math import gcd

from rl.env import GridWorld, STAY, CAGE_LEN
from rl.worlds import fossilfalls
from rl.worlds.grid import WALL


def _approach(e, target):
    """Return (from_cell, action) that steps onto `target` from an open neighbour."""
    act = {(-1, 0): 0, (1, 0): 1, (0, -1): 2, (0, 1): 3}
    for (dr, dc), a in act.items():
        nb = (target[0] - dr, target[1] - dc)
        if 0 <= nb[0] < e.H and 0 <= nb[1] < e.W and e.world.grid[nb[0]][nb[1]] != WALL:
            return nb, a
    raise AssertionError("target has no open neighbour")


def _world(seed=0):
    return fossilfalls.generate(seed)


def test_generation_shape_and_pieces():
    w = _world()
    assert w.H == 19 and w.W == 19
    assert w.escape == [(0, 9)]                              # shared exit, top EDGE centre
    assert w.blue_spawn == (18, 0) and w.red_spawn == (18, 18)   # bottom-left / bottom-right corners
    assert len(w.goombas) == 2 * fossilfalls.N_GOOMBA_PAIRS  # 3 per side -> 6, in mirror pairs


def test_walls_are_one_cell_thick():
    # A perfect even-coordinate maze can never hold a 2x2 block of solid wall: every
    # 2x2 window contains exactly one even/even passage cell. That IS "1-thick walls".
    g = _world().grid
    for r in range(18):
        for c in range(18):
            block = [g[r][c], g[r][c + 1], g[r + 1][c], g[r + 1][c + 1]]
            assert block.count(WALL) < 4, f"2x2 wall clump at ({r},{c})"


def test_maze_is_mirror_symmetric():
    # walkability must reflect about the centre column so both corner racers are equal.
    g, W = _world(6).grid, 19
    for r in range(19):
        for c in range(19):
            assert (g[r][c] == WALL) == (g[r][W - 1 - c] == WALL), f"asymmetry at ({r},{c})"


def test_goombas_come_in_mirror_pairs():
    w = _world(6)
    patrols = {tuple(tuple(c) for c in gb["cells"]) for gb in w.goombas}
    for gb in w.goombas:
        mirror = tuple((r, 18 - c) for (r, c) in gb["cells"])
        assert mirror in patrols, "a Goomba patrol has no mirror twin"


def test_solvable_with_stay_action_against_moving_goombas():
    # The real solvability check: an agent that may WAIT can always time its way past
    # every sentry to the exit (BFS over cell x global-phase, honouring goomba deaths).
    for seed in (0, 1, 2, 3, 11):
        w = _world(seed)
        assert _timed_reachable(w), f"seed {seed} is an uncrossable death-trap"


def _timed_reachable(w):
    g, H, W = w.grid, w.H, w.W
    def period(n):
        return 2 * (n - 1) if n > 1 else 1
    P = 1
    for gb in w.goombas:
        p = period(len(gb["cells"]))
        P = P * p // gcd(P, p)
    def gpos(gb, t):
        cells = gb["cells"]; n = len(cells)
        if n <= 1:
            return cells[0]
        per = 2 * (n - 1); tt = (t + gb["phase0"]) % per
        return cells[tt if tt < n else per - tt]
    def occ(t):
        return {gpos(gb, t) for gb in w.goombas}
    def walk(r, c):
        return 0 <= r < H and 0 <= c < W and g[r][c] != WALL
    start, goal = tuple(w.blue_spawn), tuple(w.escape[0])
    seen = {(start, 0)}; q = deque([(start, 0)])
    moves = [(-1, 0), (1, 0), (0, -1), (0, 1), (0, 0)]      # N, S, W, E, STAY
    while q:
        cell, t = q.popleft()
        if cell == goal:
            return True
        nt = (t + 1) % P; here = occ(t + 1)
        for dr, dc in moves:
            nc = (cell[0] + dr, cell[1] + dc)
            if not walk(*nc):
                nc = cell
            if nc in here:
                continue                                    # would step onto a goomba
            if any(gpos(gb, t) == nc and gpos(gb, t + 1) == cell for gb in w.goombas):
                continue                                    # swap-through death
            if (nc, nt) not in seen:
                seen.add((nc, nt)); q.append((nc, nt))
    return False


def test_maze_reaches_every_edge_no_border_ring():
    # the corridors run right to the arena boundary (the board edge IS the outer wall),
    # so every edge row/col must hold at least one open cell - no solid rock ring.
    g = _world(4).grid
    top = [g[0][c] for c in range(19)]
    bottom = [g[18][c] for c in range(19)]
    left = [g[r][0] for r in range(19)]
    right = [g[r][18] for r in range(19)]
    for edge, name in ((top, "top"), (bottom, "bottom"), (left, "left"), (right, "right")):
        assert any(t != WALL for t in edge), f"{name} edge is a solid wall ring"


def test_reproducible_per_seed_but_varies():
    a, b = _world(7), _world(7)
    assert a.rows() == b.rows()                              # same seed -> same maze
    assert _world(1).rows() != _world(2).rows()             # different seed -> reshuffled


def test_solvable_both_spawns_reach_exit():
    # generate() calls validate(); a connected maze means both racers can reach the exit.
    w = _world(3)
    assert w.escape[0] not in {w.red_spawn, w.blue_spawn}


def test_state_is_cell_phase_rival_triple():
    e = GridWorld(seed=0, round_id=3)
    (sr, sb), _ = e.reset()
    assert e.goomba_mode and e.hazardous
    assert len(sr) == 3 and len(sb) == 3                     # (cell, phase, rival_flag)
    assert 0 <= sr[1] < e._phase_period                      # patrol phase in range
    assert 0 <= sr[2] <= 5                                   # compact rival flag


def test_goombas_patrol_deterministically():
    e = GridWorld(seed=0, round_id=3)
    e.reset()
    p0 = e._goomba_positions(0)
    p1 = e._goomba_positions(1)
    assert p0 != p1                                          # they move
    assert e._goomba_positions(0) == e._goomba_positions(e._phase_period)  # periodic


def test_walking_into_a_goomba_is_death():
    e = GridWorld(seed=5, round_id=3)
    e.reset()
    gpos = e._goomba_positions(1)[0]                         # goomba 0's cell after one step
    gr, gc = gpos
    act = {0: (-1, 0), 1: (1, 0), 2: (0, -1), 3: (0, 1)}
    for a, (dr, dc) in act.items():
        br, bc = gr - dr, gc - dc                           # cell from which action a steps onto the goomba
        if 0 <= br < e.H and 0 <= bc < e.W and e.world.grid[br][bc] != WALL:
            e.red_pos = e.world.red_spawn                    # keep red out of the way
            e.blue_pos = (br, bc)
            (_, _), _, _, _, info = e.step(1, a)             # blue steps onto the goomba -> death
            assert "blue" in info["died"]
            return
    raise AssertionError("no open cell adjacent to the goomba to test with")


def test_cannot_enter_the_live_rivals_cell():
    e = GridWorld(seed=5, round_id=3)
    e.reset()
    r0 = e.world.red_spawn                                   # bottom-right corner: South is the border wall
    act = {0: (-1, 0), 1: (1, 0), 2: (0, -1), 3: (0, 1)}
    opp = {0: 1, 1: 0, 2: 3, 3: 2}
    for a, (dr, dc) in act.items():
        nb = (r0[0] + dr, r0[1] + dc)
        if 0 <= nb[0] < e.H and 0 <= nb[1] < e.W and e.world.grid[nb[0]][nb[1]] != WALL:
            e.red_pos = r0                                   # red idles in the corner (walled to the South)
            e.blue_pos = nb
            e.step(1, opp[a])                                # blue steps toward red -> blocked
            assert e.blue_pos == nb
            return
    raise AssertionError("red spawn has no open neighbour to test the block with")


def test_round3_exposes_a_stay_action():
    e = GridWorld(seed=0, round_id=3)
    e.reset()
    assert e.n_actions == 5 and STAY == 4                    # 4 moves + STAY
    # STAY is always an allowed choice on the timing round (so agents can wait)
    assert e.effective_actions("blue")[STAY] is True
    # a plain grid round keeps the 4 moves, no STAY
    assert GridWorld(seed=0, round_id=2).n_actions == 4


def test_stay_action_holds_position():
    e = GridWorld(seed=0, round_id=3)
    e.reset()
    e.red_pos = e.world.red_spawn
    e.blue_pos = e.world.blue_spawn                          # corner, clear of the sentries
    before = e.blue_pos
    (_, _), _, _, _, info = e.step(STAY, STAY)               # both wait a tick
    assert e.blue_pos == before and "blue" not in info["died"]


def test_cage_pickups_are_off_path_and_symmetric():
    for seed in (0, 1, 2, 7):
        w = fossilfalls.generate(seed)
        b, r = w.blue_cage[0], w.red_cage[0]
        assert r == (b[0], 18 - b[1])                        # mirror pair
        path = set(fossilfalls._path(w.grid, w.blue_spawn, w.escape[0]))
        assert b not in path                                 # a deliberate DETOUR, not on the route
        gcells = {c for gb in w.goombas for c in gb["cells"]}
        assert b not in gcells and r not in gcells           # clear of goomba patrols


def test_grabbing_your_cage_freezes_the_rival():
    e = GridWorld(seed=0, round_id=3)
    e.reset()
    e.red_pos = e.world.red_spawn
    frm, act = _approach(e, e.cage_cell["blue"])
    e.blue_pos = frm
    e.step(STAY, act)                                        # blue steps onto its own cage
    assert e.cage_taken["blue"] and e.caged["red"] >= CAGE_LEN - 1
    # the rival is now stuck for several ticks no matter what it tries
    rp = e.red_pos
    for _ in range(CAGE_LEN - 2):
        e.step(0, STAY)                                      # red tries to move North, blue waits
        assert e.red_pos == rp                               # frozen in the cage


def test_caged_agent_is_shielded_from_goombas():
    e = GridWorld(seed=5, round_id=3)
    e.reset()
    gcell = e.goombas[0]["cells"][0]
    e.caged["blue"] = CAGE_LEN                               # pretend blue is caged
    e.blue_pos = gcell                                       # sitting where a goomba patrols
    e.red_pos = e.world.red_spawn
    died = False
    for _ in range(2 * len(e.goombas[0]["cells"])):
        (_, _), _, _, _, info = e.step(STAY, STAY)
        if "blue" in info["died"]:
            died = True
            break
    assert not died                                          # the cage protects it from the patrol


def test_cage_ready_bit_clears_after_grab():
    e = GridWorld(seed=0, round_id=3)
    (_, sb), _ = e.reset()
    assert sb[2] % 2 == 1                                    # cage-ready bit set at the start
    frm, act = _approach(e, e.cage_cell["blue"])
    e.blue_pos = frm
    e.red_pos = e.world.red_spawn
    (_, sb2), _, _, _, _ = e.step(STAY, act)
    assert sb2[2] % 2 == 0                                   # ...and clears once the cage is taken
