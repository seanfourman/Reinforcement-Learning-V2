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
            if 0 <= nr < world.H and 0 <= nc < world.W and world.grid[nr][nc] != WALL:
                seen.add(nxt)
                todo.append(nxt)
    return seen


def _signature(world):
    return tuple(world.rows()), world.blue_spawn, tuple(world.hedge_cells)


def test_seed_is_repeatable_and_changes_both_zigzags():
    assert _signature(city.generate(seed=42)) == _signature(city.generate(seed=42))
    signatures = {_signature(city.generate(seed=seed)) for seed in range(20)}
    assert len(signatures) >= 18
    bottom_rooms = {
        (
            tuple(city.generate(seed=seed).rows()[14:]),
            tuple(city.generate(seed=seed).slip),
            tuple(city.generate(seed=seed).blue_stars),
        )
        for seed in range(100)
    }
    assert len(bottom_rooms) >= 95


def test_two_sealed_two_row_dividers_form_three_disconnected_sections():
    for seed in range(200):
        world = city.generate(seed=seed)
        assert world.H == world.W == city.CITY_SIZE == 19
        assert world.blue_spawn == (18, 0)
        assert world.red_spawn == (18, 18)
        assert world.red_spawn == city._mirror(world.blue_spawn)
        assert world.grid[0][9] == ESCAPE
        assert world.escape == [(0, 9)]
        for row in world.grid:
            assert row == list(reversed(row))

        hedges = set(world.hedge_cells)
        for allowed_rows in city.DIVIDER_ROWS:
            band = {(r, c) for r, c in hedges if r in allowed_rows}
            assert {r for r, _ in band} == set(allowed_rows)
            assert all(
                sum((r, c) in band for r in allowed_rows) == 1
                for c in range(world.W)
            )
            for row in allowed_rows:
                run = 0
                for col in range(world.W):
                    run = run + 1 if (row, col) in band else 0
                    assert run <= 2

        assert not (set(world.escape) & _walk_reach(world, world.blue_spawn))

        remaining = {
            (r, c)
            for r in range(world.H)
            for c in range(world.W)
            if world.grid[r][c] != WALL
        }
        components = 0
        while remaining:
            components += 1
            component = _walk_reach(world, next(iter(remaining)))
            remaining -= component
        assert components == 3


def test_bottom_room_has_one_mirrored_risk_setup_and_shared_pipe():
    world = city.generate(seed=7)
    assert world.spikes == []
    assert len(world.plants) == 6
    assert len(world.slip) == 8
    assert len(world.pipes) == 3
    assert len(world.blue_stars) == len(world.red_stars) == 3
    assert world.blue_stars[0] in ((14, 0), (15, 0))
    assert world.red_stars[0] == city._mirror(world.blue_stars[0])

    blue_plant = next(cell for cell in world.plants if cell[0] == 18 and cell[1] < 9)
    blue_puddle = next(cell for cell in world.slip if cell[0] == 16 and cell[1] < 9)
    pipe = next(p for p in world.pipes if p["entry"] == (15, 9))
    assert blue_plant == (18, blue_puddle[1])
    assert blue_puddle[0] == 16
    assert pipe["entry"] == (15, 9)
    assert pipe["dests"] == [(9, 9)]
    assert pipe["exit"] == (9, 9)
    assert pipe["requiresStar"] == 0
    assert world.grid[blue_plant[0]][blue_plant[1]] == WALL
    assert blue_plant not in world.hedge_cells
    attack_zone = {
        (r + dr, c + dc)
        for r, c in world.plants
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if dr or dc
    }
    assert not (attack_zone & set(world.hedge_cells))

    # A southward skid from the water enters one of the eight attack cells.
    assert (17, blue_puddle[1]) in {
        (blue_plant[0] + dr, blue_plant[1] + dc)
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if dr or dc
    }


def test_middle_room_has_required_tomatoes_and_one_pipe_per_side():
    world = city.generate(seed=7)
    blue_tomato = world.blue_stars[1]
    red_tomato = world.red_stars[1]
    assert blue_tomato[0] == red_tomato[0] == 7
    assert red_tomato == city._mirror(blue_tomato)

    side_pipes = [p for p in world.pipes if p["requiresStar"] == 1]
    assert {p["entry"] for p in side_pipes} == {(8, 1), (8, 17)}
    assert {dest for p in side_pipes for dest in p["dests"]} == {(2, 1), (2, 17)}
    assert all(p["exit"] in p["dests"] for p in side_pipes)

    env = GridWorld(seed=7, round_id=2)
    env.reset()
    middle_plant = next(cell for cell in world.plants if cell[0] == 8 and cell[1] < 9)
    middle_puddle = next(cell for cell in world.slip if cell[0] == 10 and cell[1] < 9)
    assert middle_plant[1] == middle_puddle[1]
    middle_zone = {
        (middle_plant[0] + dr, middle_plant[1] + dc)
        for dr in (-1, 0, 1)
        for dc in (-1, 0, 1)
        if dr or dc
    }
    assert (9, middle_puddle[1]) in middle_zone

    env.blue_pos = (9, 1)
    env.step(0, 0)
    assert env.blue_pos == (9, 1)

    env.blue_pos = (blue_tomato[0] + 1, blue_tomato[1])
    env.step(0, 0)
    assert env.blue_pos == blue_tomato
    assert env.stars_collected["blue"] == 2

    env.blue_pos = (9, 1)
    env.step(0, 0)
    assert env.blue_pos == (2, 1)

    env.reset()
    env.red_pos = (red_tomato[0] + 1, red_tomato[1])
    env.step(0, 0)
    assert env.red_pos == red_tomato
    assert env.stars_collected["red"] == 2

    env.red_pos = (9, 17)
    env.step(0, 0)
    assert env.red_pos == (2, 17)


def test_top_room_has_final_tomatoes_plants_puddles_and_bush_routes():
    world = city.generate(seed=7)
    assert world.blue_stars[2] == (0, 1)
    assert world.red_stars[2] == (0, 17)

    top_plants = [cell for cell in world.plants if cell[0] == 1]
    top_puddles = [cell for cell in world.slip if cell[0] == 1]
    assert len(top_plants) == len(top_puddles) == 2
    assert top_plants[1] == city._mirror(top_plants[0])
    assert top_puddles == [(1, 1), (1, 17)]

    env = GridWorld(seed=7, round_id=2)
    env.reset()
    env.stars_collected["blue"] = 3
    env.blue_pos = (1, 1)
    env.r2_slip_prob = 0.0
    env.step(0, 0)
    assert env.blue_pos == (0, 1)
    assert env.stars_collected["blue"] == 7

    env.blue_pos = (1, 9)
    _, _, done, _, info = env.step(0, 0)
    assert done
    assert info["winner"] == "blue"


def test_second_room_puddle_pair_creates_a_tomato_shortcut():
    for seed in range(100):
        world, design = city._build(
            city.random.Random(f"new-donk-foundation:{seed}")
        )
        extra = [cell for cell in world.slip if cell[0] == 8]
        assert len(extra) == 2
        assert extra[1] == city._mirror(extra[0])
        assert design["extra_middle_puddle"] in design["middle_tomato_spur"]
        assert not (set(design["middle_tomato_safe"]) & set(world.slip))
        assert (
            len(design["middle_tomato_safe"])
            > len(design["middle_tomato_spur"])
        )


def test_plant_death_ends_episode_and_respawns_only_on_reset():
    env = GridWorld(seed=7, round_id=2)
    env.reset()
    plant = next(cell for cell in env.world.plants if cell[0] == 18 and cell[1] < 9)
    lethal_cell = (plant[0] - 1, plant[1])
    env.blue_pos = (lethal_cell[0] - 1, lethal_cell[1])
    env.r2_slip_prob = 0.0

    _, rewards, done, truncated, info = env.step(0, 1)
    assert done and not truncated
    assert info["winner"] == "red"
    assert rewards["blue"] < 0
    assert env.blue_pos == lethal_cell

    env.reset()
    assert env.blue_pos == (18, 0)


def test_tomato_is_required_before_bottom_pipe_activates():
    env = GridWorld(seed=4, round_id=2)
    env.reset()

    env.blue_pos = (14, 9)
    env.step(0, 1)
    assert env.blue_pos == (14, 9)

    blue_tomato = env.world.blue_stars[0]
    env.blue_pos = (blue_tomato[0] + 1, blue_tomato[1])
    env.step(0, 0)
    assert env.blue_pos == blue_tomato
    assert env.stars_collected["blue"] == 1

    env.blue_pos = (14, 9)
    env.step(0, 1)
    assert env.blue_pos == (9, 9)

    # Red owns the mirrored tomato but enters and exits through the same Pipe.
    env.reset()
    red_tomato = env.world.red_stars[0]
    env.red_pos = (red_tomato[0] + 1, red_tomato[1])
    env.step(0, 0)
    assert env.red_pos == red_tomato
    assert env.stars_collected["red"] == 1

    env.red_pos = (14, 9)
    env.step(1, 0)
    assert env.red_pos == (9, 9)


def test_pipe_exits_return_to_their_paired_entrances():
    env = GridWorld(seed=7, round_id=2)
    env.reset()
    env.stars_collected["blue"] = 1

    env.blue_pos = (14, 9)
    env.step(0, 1)
    assert env.blue_pos == (9, 9)

    env.step(0, 0)
    assert env.blue_pos == (8, 9)
    env.step(0, 1)
    assert env.blue_pos == (15, 9)

    env.stars_collected["blue"] = 3
    env.blue_pos = (9, 1)
    env.step(0, 0)
    assert env.blue_pos == (2, 1)

    env.step(0, 2)
    assert env.blue_pos == (2, 0)
    env.step(0, 3)
    assert env.blue_pos == (8, 1)


def test_tomato_reward_is_paid_only_on_first_collection():
    env = GridWorld(seed=7, round_id=2)
    env.reset()
    tomato = env.world.blue_stars[0]

    env.blue_pos = (tomato[0] + 1, tomato[1])
    _, first_rewards, *_ = env.step(0, 0)
    assert first_rewards["blue"] == env.star_reward - 0.01
    assert env.stars_collected["blue"] == 1

    env.blue_pos = (tomato[0] + 1, tomato[1])
    _, repeat_rewards, *_ = env.step(0, 0)
    assert repeat_rewards["blue"] == -0.01
    assert env.stars_collected["blue"] == 1


def test_every_pipe_exit_has_a_clear_landing_plaza():
    for seed in range(300):
        world = city.generate(seed=seed)
        hedges = set(world.hedge_cells)
        for pipe in world.pipes:
            exit_cell = pipe["exit"]
            plaza = city._surrounding(exit_cell)
            assert exit_cell not in hedges
            assert not (plaza & hedges)
            assert all(world.grid[r][c] != WALL for r, c in plaza)


def test_middle_room_has_short_risky_and_long_safe_route():
    for seed in range(300):
        world, design = city._build(
            city.random.Random(f"new-donk-foundation:{seed}")
        )
        safe = design["middle_safe"]
        risky = design["middle_risky"]
        assert len(safe) > len(risky)
        assert design["middle_puddle"] in risky
        assert not (
            set(safe)
            & (design["middle_plant_zone"] | set(world.slip))
        )


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
