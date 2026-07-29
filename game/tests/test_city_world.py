"""Focused invariants for the stripped-down New Donk City foundation."""

from collections import deque

from rl.env import GridWorld
from rl.match import Match, red_params
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


def _place_match_agent(match, side, cell, *, tomato_mask=None, action=0):
    """Move one racer in a test while keeping Match's cached transition state aligned."""
    setattr(match.env, f"{side}_pos", cell)
    if tomato_mask is not None:
        match.env.stars_collected[side] = tomato_mask
    setattr(match, f"s_{side}", match.env.observe(side))
    setattr(match, f"a_{side}", action)


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
    assert not done
    assert info["winner"] is None
    assert info["finishers"] == ["blue"]
    assert info["agentTerminated"] == {"red": False, "blue": True}
    assert info["agentDone"] == {"red": False, "blue": True}

    # A finisher remains frozen while the other racer completes its own MC return.
    blue_goal = env.blue_pos
    _, rewards, done, _, info = env.step(0, 3)
    assert not done
    assert env.blue_pos == blue_goal
    assert rewards["blue"] == 0.0
    assert not info["agentTerminated"]["blue"]

    env.stars_collected["red"] = env.star_full
    env.red_pos = (1, 9)
    _, _, done, truncated, info = env.step(0, 3)
    assert done and not truncated
    assert info["winner"] == "blue"
    assert info["finishers"] == ["blue", "red"]
    assert info["agentDone"] == {"red": True, "blue": True}


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


def test_plant_death_ends_only_that_trajectory_and_respawns_on_shared_reset():
    env = GridWorld(seed=7, round_id=2)
    env.reset()
    plant = next(cell for cell in env.world.plants if cell[0] == 18 and cell[1] < 9)
    lethal_cell = (plant[0] - 1, plant[1])
    env.blue_pos = (lethal_cell[0] - 1, lethal_cell[1])
    env.r2_slip_prob = 0.0

    _, rewards, done, truncated, info = env.step(0, 1)
    assert not done and not truncated
    assert info["winner"] is None
    assert info["finishers"] == []
    assert info["died"] == ["blue"]
    assert info["agentTerminated"] == {"red": False, "blue": True}
    assert info["agentDone"] == {"red": False, "blue": True}
    assert rewards["blue"] < 0
    assert rewards["red"] == -0.01
    assert env.blue_pos == lethal_cell

    # The dead racer pays no more step costs and cannot move while Red continues.
    _, rewards, done, _, info = env.step(0, 0)
    assert not done
    assert env.blue_pos == lethal_cell
    assert rewards["blue"] == 0.0
    assert not info["agentTerminated"]["blue"]

    env.stars_collected["red"] = env.star_full
    env.red_pos = (1, 9)
    _, _, done, truncated, info = env.step(0, 0)
    assert done and not truncated
    assert info["winner"] == "red"
    assert info["finishers"] == ["red"]
    assert info["died"] == ["blue"]

    env.reset()
    assert env.blue_pos == (18, 0)
    assert env._agent_done == {"red": False, "blue": False}


def test_inactive_racer_gets_no_extra_learning_actions_or_visits(tmp_path):
    match = Match(seed=7, round_id=2, checkpoint_dir=tmp_path)
    plant = next(
        cell for cell in match.env.world.plants
        if cell[0] == 18 and cell[1] < 9
    )
    match.env.r2_slip_prob = 0.0
    lethal_cell = (plant[0] - 1, plant[1])
    _place_match_agent(
        match, "blue", (plant[0] - 2, plant[1]), action=1
    )

    learn_calls = []
    policy_calls = []
    original_learn = match.blue.learn_step
    original_policy = match.blue.policy_action

    def learn_spy(*args, **kwargs):
        learn_calls.append(args)
        return original_learn(*args, **kwargs)

    def policy_spy(*args, **kwargs):
        policy_calls.append(args)
        return original_policy(*args, **kwargs)

    match.blue.learn_step = learn_spy
    match.blue.policy_action = policy_spy
    blue_actions_before = sum(match.act_counts["blue"])

    assert not match.tick()
    assert len(learn_calls) == 1
    assert learn_calls[0][2] == -1.01
    assert policy_calls == []
    assert len(match.blue._episode) == 1
    assert sum(match.act_counts["blue"]) == blue_actions_before + 1
    assert match.blue_visits[lethal_cell[0]][lethal_cell[1]] == 1
    assert match._top == {"red": [], "blue": []}

    # Red now resolves the shared episode. Blue must not receive a zero-reward
    # self-loop, another action draw/count, or another visit while frozen.
    _place_match_agent(
        match,
        "red",
        (1, 9),
        tomato_mask=match.env.star_full,
        action=0,
    )
    assert match.tick()
    assert len(learn_calls) == 1
    # The only later draw is the legitimate initial action for the automatically
    # reset next episode, not an action for frozen Blue in the old episode.
    assert len(policy_calls) == 1
    assert policy_calls[0][0] == match.s_blue
    assert sum(match.act_counts["blue"]) == blue_actions_before + 1
    assert match.blue_visits[lethal_cell[0]][lethal_cell[1]] == 1
    assert match.blue._episode == []
    death_state, death_action = learn_calls[0][0], learn_calls[0][1]
    assert match.blue.Q[death_state][death_action] < 0
    assert match._top["blue"] == []
    assert len(match._top["red"]) == 1


def test_each_finisher_replay_stops_at_its_own_finish_step(tmp_path):
    match = Match(seed=7, round_id=2, checkpoint_dir=tmp_path)
    full = match.env.star_full

    # Blue finishes on shared tick 1.
    _place_match_agent(match, "blue", (1, 9), tomato_mask=full, action=0)
    assert not match.tick()
    assert match.env._finish_steps == {"blue": 1}

    # Red takes one more ordinary step, then finishes on shared tick 3.
    assert not match.tick()
    _place_match_agent(match, "red", (1, 9), tomato_mask=full, action=0)
    assert match.tick()

    blue = match.replay("top", "blue", 0)
    red = match.replay("top", "red", 0)
    assert blue["available"] and red["available"]
    assert blue["steps"] == 1
    assert len(blue["frames"]) == 2
    assert blue["frames"][-1]["blue"] == [0, 9]
    assert red["steps"] == 3
    assert len(red["frames"]) == 4
    assert red["frames"][-1]["red"] == [0, 9]

    # The post-step frame records the intended and resolved action. Once Blue has
    # finished, later shared frames carry no stale Blue action or skid telemetry.
    assert blue["frames"][1]["blueAction"] == 0
    assert blue["frames"][1]["blueResolvedAction"] == 0
    for frame in red["frames"][2:]:
        assert frame.get("blueAction") is None
        assert frame.get("blueResolvedAction") is None
        assert not frame.get("blueSlipped", False)


def test_replay_freezes_masked_value_policy_and_q_fields(tmp_path):
    match = Match(seed=7, round_id=2, checkpoint_dir=tmp_path)
    full = match.env.star_full
    replay_state = (match.env.cell_index[(1, 9)], full)
    match.blue.Q[replay_state] = [0.8, -0.2, -0.3, -0.4]
    _place_match_agent(match, "blue", (1, 9), tomato_mask=full, action=0)

    assert not match.tick()
    _place_match_agent(match, "red", (1, 9), tomato_mask=full, action=0)
    assert match.tick()

    replay = match.replay("top", "blue", 0)
    fields = replay["replayFields"]
    assert fields["epsilon"] >= 0
    assert str(full) in fields["masks"]
    assert fields["masks"]["7"]["q"][1][9] == [0.8, -0.2, -0.3, -0.4]
    assert fields["masks"]["7"]["value"][1][9] == 0.8
    assert fields["masks"]["7"]["policy"][1][9] == 0

    # Later learning cannot mutate the historical overlay stored with the run.
    match.blue.Q[replay_state][0] = -99
    replay_again = match.replay(
        "top", "blue", rank=99, episode=replay["episode"]
    )
    assert replay_again["available"]
    assert replay_again["replayFields"]["masks"]["7"]["q"][1][9][0] == 0.8


def test_mc_exploring_starts_cover_later_sections_but_not_top_replays(tmp_path):
    match = Match(seed=7, round_id=2, checkpoint_dir=tmp_path)
    stages = []
    full_course = 0
    expected_masks = {3: 1, 4: 3, 5: 7}
    row_bands = {3: (13, 18), 4: (6, 10), 5: (0, 3)}

    for episode in range(10):
        match.episode = episode
        match._new_episode()
        stage = match._curriculum_stage
        stages.append(stage)
        if stage == 0:
            full_course += 1
            assert match._full_course_episode
            assert match.env.blue_pos == (18, 0)
            assert match.env.red_pos == (18, 18)
            assert match.env.stars_collected == {"red": 0, "blue": 0}
            continue

        assert not match._full_course_episode
        assert match.env.stars_collected == {
            "red": expected_masks[stage],
            "blue": expected_masks[stage],
        }
        assert match.env.red_pos == city._mirror(match.env.blue_pos)
        r0, r1 = row_bands[stage]
        assert r0 <= match.env.blue_pos[0] <= r1
        blocked = (
            set(match.env.plant_cells)
            | set(match.env.plant_lethal)
            | set(match.env.pipe_map)
            | set(match.env.goal_set)
        )
        assert match.env.blue_pos not in blocked
        assert match.env.red_pos not in blocked

    assert stages == [0, 0, 0, 0, 0, 0, 0, 3, 4, 5]
    assert full_course == 7


def test_arena2_live_controls_and_mdp_contract(tmp_path):
    match = Match(seed=7, round_id=2, checkpoint_dir=tmp_path)
    params = match.params()
    assert params["r2SlipProb"] == 0.12
    assert params["r2TomatoReward"] == 0.35
    assert "r2Plants" not in params
    assert "r2Slip" not in params

    spec = match.mdp_spec()
    assert spec["observationTuple"] == "(cell, tomato mask)"
    assert spec["stateSize"] == match.env.n_cells * 8
    assert spec["slipProb"] == 0.12
    assert ["Collect a tomato (first time only)", 0.35] in spec["rewards"]
    assert ["Die in a plant attack zone", -1.0] in spec["rewards"]

    env_before = match.env
    world_version = match.world_version
    blue_before = match.blue
    match.episode = 12
    match._top["blue"].append({"steps": 99, "episode": 1, "frames": []})
    match.set_params({"r2SlipProb": 0.4, "r2TomatoReward": 0.7})
    assert match.env is env_before
    assert match.world_version == world_version
    # These controls change the MDP itself, so old MC returns, statistics, and
    # frozen replay fields must never be mixed with the new transition/reward law.
    assert match.blue is not blue_before
    assert match.episode == 0
    assert match._top == {"red": [], "blue": []}
    assert match.env.r2_slip_prob == 0.4
    assert match.env.star_reward == 0.7
    assert match.params()["r2SlipProb"] == 0.4
    assert match.params()["r2TomatoReward"] == 0.7
    assert match.mdp_spec()["slipProb"] == 0.4
    assert ["Collect a tomato (first time only)", 0.7] in match.mdp_spec()["rewards"]


def test_arena2_cpu_profiles_are_variant_monotonic_and_reset_per_round(tmp_path):
    every = [red_params(i, 2) for i in range(0, 10, 2)]
    first = [red_params(i, 2) for i in range(1, 10, 2)]
    for family in (every, first):
        assert [p["alpha"] for p in family] == sorted(
            p["alpha"] for p in family
        )
        assert [p["eps_end"] for p in family] == sorted(
            (p["eps_end"] for p in family), reverse=True
        )
        assert [p["eps_episodes"] for p in family] == sorted(
            (p["eps_episodes"] for p in family), reverse=True
        )
        assert all(p["gamma"] == 0.98 for p in family)

    # Arena 3 (Fossil Falls) has its own ladder: one monotonic list 0..9 (no MC families).
    r3 = [red_params(i, 3) for i in range(10)]
    assert [p["alpha"] for p in r3] == sorted(p["alpha"] for p in r3)
    assert [p["eps_end"] for p in r3] == sorted((p["eps_end"] for p in r3), reverse=True)
    assert [p["eps_episodes"] for p in r3] == sorted((p["eps_episodes"] for p in r3), reverse=True)
    assert all(p["gamma"] == 0.98 for p in r3)

    match = Match(seed=7, round_id=1, checkpoint_dir=tmp_path)
    match.set_cpu_tier(5, 9)
    assert match.red_alpha == 0.40
    assert match.red_eps_end == 0.01

    # Entering Arena 2 resolves the character's MC-specific block.
    match.set_round(2)
    assert match.red_alpha == 0.22
    assert match.red_gamma == 0.98
    assert match.red_eps_start == 0.86
    assert match.red_eps_end == 0.16
    assert match.red_eps_episodes == 6000

    # Manual overrides never leak into a later stage or a fresh return to Arena 2.
    match.set_red_params({"alpha": 0.99, "epsEnd": 0.01})
    assert match.red_alpha == 0.99
    match.set_round(3)                       # Arena 3 resolves the character's R3_LADDER block
    assert match.red_alpha == 0.40
    assert match.red_eps_end == 0.02
    assert match.red_eps_episodes == 550
    match.set_round(2)
    assert match.red_alpha == 0.22
    assert match.red_eps_end == 0.16
    assert match.red_eps_episodes == 6000


def test_arena2_rejects_algorithms_with_the_wrong_state_model(tmp_path):
    match = Match(seed=7, round_id=2, checkpoint_dir=tmp_path)
    assert (match.algo_red, match.algo_blue) == (
        "monte_carlo",
        "first_visit_mc",
    )

    red_agent = match.red
    blue_agent = match.blue
    match.set_side_algo("red", "value_iteration")
    match.set_side_algo("blue", "qlearning")
    assert match.red is red_agent
    assert match.blue is blue_agent
    assert (match.algo_red, match.algo_blue) == (
        "monte_carlo",
        "first_visit_mc",
    )

    match.set_side_algo("red", "first_visit_mc")
    match.set_side_algo("blue", "monte_carlo")
    assert (match.algo_red, match.algo_blue) == (
        "first_visit_mc",
        "monte_carlo",
    )

    # Invalid menu loadouts fall back to Arena 2's defaults as well.
    match.set_loadouts(
        cpu=[None, "qlearning"],
        player=[None, "value_iteration"],
    )
    assert (match.algo_red, match.algo_blue) == (
        "monte_carlo",
        "first_visit_mc",
    )


def test_arena2_value_diagnostics_ignore_blocked_action_q_values(tmp_path):
    match = Match(seed=7, round_id=2, checkpoint_dir=tmp_path)
    spawn = tuple(match.env.world.blue_spawn)
    state = match.env.full_state("blue", spawn)
    mask = match.env.effective_actions("blue", spawn)
    assert mask == [True, False, False, False]
    match.blue.Q[state] = [-0.5, 0.0, 0.0, 0.0]

    value = match.value_grid("blue")["grid"][spawn[0]][spawn[1]]
    assert value == -0.5
    match._record_probe()
    assert match.q_probe[-1]["blueV"] == -0.5

    policy = match.policy_grid("blue")["grid"][spawn[0]][spawn[1]]
    assert policy == 0
    inspected = match.q_at("blue", *spawn)
    assert inspected["best"] == 0
    assert inspected["ties"] == [0]


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
    env.reset()
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
