"""Round 3 (Fossil Falls) invariants: the random 1-thick-wall Goomba maze race."""

from rl.env import GridWorld
from rl.worlds import fossilfalls
from rl.worlds.grid import WALL


def _world(seed=0):
    return fossilfalls.generate(seed)


def test_generation_shape_and_pieces():
    w = _world()
    assert w.H == 19 and w.W == 19
    assert w.escape == [(1, 9)]                              # shared exit, top centre
    assert w.blue_spawn == (17, 1) and w.red_spawn == (17, 17)   # bottom-left / bottom-right
    assert 1 <= len(w.goombas) <= fossilfalls.N_GOOMBAS      # patrolling hazards


def test_walls_are_one_cell_thick():
    # A perfect odd-coordinate maze can never hold a 2x2 block of solid wall: every
    # 2x2 window contains exactly one odd/odd passage cell. That IS "1-thick walls".
    g = _world().grid
    for r in range(18):
        for c in range(18):
            block = [g[r][c], g[r][c + 1], g[r + 1][c], g[r + 1][c + 1]]
            assert block.count(WALL) < 4, f"2x2 wall clump at ({r},{c})"


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
