"""Focused invariants for the stripped-down New Donk City foundation."""

from collections import deque

from rl.env import GridWorld
from rl.worlds import city
from rl.worlds.grid import World, SIZE, WALL, FLOOR, ESCAPE, ORTHO


def _walk_reach(world, start):
    seen = {start}
    todo = deque([start])
    while todo:
        r, c = todo.popleft()
        for dr, dc in ORTHO:
            nxt = (r + dr, c + dc)
            nr, nc = nxt
            if nxt in seen:
                continue
            if 0 <= nr < SIZE and 0 <= nc < SIZE and world.grid[nr][nc] != WALL:
                seen.add(nxt)
                todo.append(nxt)
    return seen


def _signature(world):
    return tuple(world.rows()), world.blue_spawn, tuple(world.hedge_cells)


def test_seed_is_repeatable_and_changes_both_zigzags():
    assert _signature(city.generate(seed=42)) == _signature(city.generate(seed=42))
    signatures = {_signature(city.generate(seed=seed)) for seed in range(20)}
    assert len(signatures) >= 18


def test_two_sealed_two_row_dividers_form_three_disconnected_sections():
    for seed in range(200):
        world = city.generate(seed=seed)
        assert world.blue_spawn == (19, 0)
        assert world.red_spawn == (19, 19)
        assert world.red_spawn == city._mirror(world.blue_spawn)
        assert world.grid[0][9] == world.grid[0][10] == ESCAPE
        for row in world.grid:
            assert row == list(reversed(row))

        hedges = set(world.hedge_cells)
        for allowed_rows in city.DIVIDER_ROWS:
            band = {(r, c) for r, c in hedges if r in allowed_rows}
            assert {r for r, _ in band} == set(allowed_rows)
            assert all(
                sum((r, c) in band for r in allowed_rows) == 1
                for c in range(SIZE)
            )
            for row in allowed_rows:
                run = 0
                for col in range(SIZE):
                    run = run + 1 if (row, col) in band else 0
                    assert run <= 2

        assert not (set(world.escape) & _walk_reach(world, world.blue_spawn))

        remaining = {
            (r, c)
            for r in range(SIZE)
            for c in range(SIZE)
            if world.grid[r][c] != WALL
        }
        components = 0
        while remaining:
            components += 1
            component = _walk_reach(world, next(iter(remaining)))
            remaining -= component
        assert components == 3


def test_bottom_room_has_one_mirrored_risk_setup_and_pipe():
    world = city.generate(seed=7)
    assert world.spikes == []
    assert len(world.plants) == 2
    assert len(world.slip) == 2
    assert len(world.pipes) == 2
    assert world.blue_stars == [(16, 0)]
    assert world.red_stars == [(16, 19)]

    blue_plant = next(cell for cell in world.plants if cell[1] < SIZE // 2)
    blue_puddle = next(cell for cell in world.slip if cell[1] < SIZE // 2)
    blue_pipe = next(pipe for pipe in world.pipes if pipe["entry"][1] < SIZE // 2)
    assert blue_plant == (19, blue_puddle[1])
    assert blue_puddle[0] == 17
    assert blue_pipe["entry"] == (16, 8)
    assert blue_pipe["dests"] == [(12, 8)]
    assert blue_pipe["requiresStar"] == 0
    assert world.grid[blue_plant[0]][blue_plant[1]] == WALL
    assert blue_plant not in world.hedge_cells

    # A southward skid from the water enters one of the eight attack cells.
    assert (18, blue_puddle[1]) in {
        (blue_plant[0] + dr, blue_plant[1] + dc)
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if dr or dc
    }


def test_plant_death_ends_episode_and_respawns_only_on_reset():
    env = GridWorld(seed=7, round_id=2)
    env.reset()
    plant = next(cell for cell in env.world.plants if cell[1] < SIZE // 2)
    lethal_cell = (plant[0] - 1, plant[1])
    env.blue_pos = (lethal_cell[0] - 1, lethal_cell[1])
    env.r2_slip_prob = 0.0

    _, rewards, done, truncated, info = env.step(0, 1)
    assert done and not truncated
    assert info["winner"] == "red"
    assert rewards["blue"] < 0
    assert env.blue_pos == lethal_cell

    env.reset()
    assert env.blue_pos == (19, 0)


def test_tomato_is_required_before_bottom_pipe_activates():
    env = GridWorld(seed=4, round_id=2)
    env.reset()

    env.blue_pos = (15, 8)
    env.step(0, 1)
    assert env.blue_pos == (15, 8)

    env.blue_pos = (17, 0)
    env.step(0, 0)
    assert env.blue_pos == (16, 0)
    assert env.stars_collected["blue"] == 1

    env.blue_pos = (15, 8)
    env.step(0, 1)
    assert env.blue_pos == (12, 8)


def test_piranha_attack_zone_is_eight_neighbours_not_plant_cell():
    plant = (10, 10)
    grid = [[FLOOR] * SIZE for _ in range(SIZE)]
    grid[0][9] = ESCAPE
    grid[0][10] = ESCAPE
    world = World(
        grid,
        red_spawn=(19, 17),
        blue_spawn=(19, 2),
        escape=((0, 9), (0, 10)),
        plants=[plant],
    )

    env = GridWorld(seed=1, round_id=2)
    env._install(world)
    expected = {
        (plant[0] + dr, plant[1] + dc)
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if dr or dc
    }
    assert env.plant_lethal == expected
    assert plant not in env.plant_lethal

    env.blue_pos = (11, 9)
    _, adjacent_death, _, _ = env._r2_resolve("blue", 0)
    assert adjacent_death == "plant"

    env.blue_pos = (11, 10)
    landed, direct_death, _, _ = env._r2_resolve("blue", 0)
    assert landed == plant
    assert direct_death is None
