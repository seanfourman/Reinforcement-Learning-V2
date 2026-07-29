"""The per-round BRIEFING card (a Match mixin): ``mdp_spec``.

One large, deliberately explicit method that describes the CURRENT round as an
MDP for the browser's Challenge card: the state structure (with a visual factor
/ segment breakdown), the observation, the dynamics, every reward term, the win
condition, and both sides' live learning profiles. Values are read off the LIVE
env, so panel changes show up immediately. The text per round mirrors that
arena's env module; keep them in sync when a mechanic changes.
"""

from arenas.r2_new_donk_city.env import R2_SLIP_PROB, STAR_REWARD
from arenas.r4_ruined_kingdom.arena import (PICKUP_EFFECT_SECONDS,
                                            SPEED_MULTIPLIER, SLOW_MULTIPLIER)
from core.registry import is_dp


class BriefingMixin:
    """The /api/mdp Challenge-card payload."""


    def mdp_spec(self):
        """The round's MDP tuple (S, A, R, gamma) + win condition, for the BRIEFING
        card. Reward constants mirror env.py / continuous.py."""
        with self.lock:
            env = self.env
            arena = env.objective == "arena"
            meta = self._matchup()
            slip_prob = 0.0
            observation_tuple = "(state)"
            state_groups = None   # optional VISUAL breakdown of a continuous obs vector
            # optional VISUAL breakdown of a DISCRETE (tabular) state as MULTIPLIED
            # factors: |S| = n1 x n2 x ... - one chip per factor, so the grid rounds
            # get the same at-a-glance state teaching the continuous rounds do.
            state_factors = None
            pickups = None        # R4 only: the collectible power-ups, for a visual card
            reward_note = (
                "Only the listed rewards are used; there is no hidden "
                "closer-to-goal bonus."
            )
            if not arena and getattr(env, "rich", False):
                # Round 1's real game: a stochastic maze with optional coins + Mystery Blocks
                actions = ["North", "South", "West", "East"]
                nbits = env._n_coins["blue"] + len(env.block_cells["blue"])
                # floor cells carry all statuses; interior wall cells (ghost-only) carry
                # just the positive ghost statuses (see dp._enumerate_states)
                n_floor = env.n_cells
                n_wall = len(getattr(env, "pos_cells", [])) - n_floor
                # live (panel-tunable) mechanic values, so the briefing matches the game
                gl, fl = env.ghost_len, env.freeze_len
                gp = env.block_ghost_prob
                sp = env.slip_prob
                state_size = ((n_floor * (gl + fl + 1) + n_wall * gl) * (1 << nbits))
                state_factors = [
                    {"label": "Your tile", "n": n_floor + n_wall,
                     "detail": "the (row, col) cell you stand on", "color": "#3f7fe0"},
                    {"label": "Collected", "n": 1 << nbits,
                     "detail": f"{nbits}-bit mask of coins / Mystery Blocks claimed",
                     "color": "#8b5cf6"},
                    {"label": "Status", "n": gl + fl + 1,
                     "detail": "ghost or freeze countdown (0 = normal)",
                     "color": "#22a39f"},
                ]
                state_desc = ("your tile, which of your own coins/Mystery Blocks you have claimed, "
                              "and your power-up / frozen countdown")
                observation = ("Each model sees its own tile, its collected coins/Mystery Blocks, and "
                               "any active ghost or freeze timer - the rival stays invisible, so "
                               "it still plans as a single agent.")
                observation_tuple = "(cell, collected mask, status)"
                sees_opp = False
                opp_info = ("Nothing. There is no opponent term in the state; each model owns a "
                            "mirror-image set of coins/Mystery Blocks, so the race is fair but solo.")
                dynamics = (f"Deterministic on dry tiles. On ICE a move slips sideways "
                            f"({round((1 - sp) * 100)}% intended, {round(sp * 50)}% each "
                            f"perpendicular). A Mystery Block is a one-time gamble: {round(gp * 100)}% "
                            f"Ghost (phase through walls, up to {gl} floor tiles - the timer only "
                            f"counts tiles landed on, so you can never be trapped mid-wall) or "
                            f"{round((1 - gp) * 100)}% Freeze (stuck for {fl} turns).")
                rewards = [["Step", -0.01], ["Coin reward", round(env.coin_reward, 2)],
                           ["Mystery Block reward", round(env.block_reward, 2)],
                           ["Win (reach the Power Moon)", 1.0], ["Lose", -1.0]]
                win = ("First to the Power Moon wins; coins are optional value on the way. A "
                       "simultaneous arrival is a draw.")
                slip_prob = sp
            elif not arena and getattr(env, "hazardous", False) and not getattr(env, "goomba_mode", False):
                # Round 2 (New Donk City): the collect-three-tomatoes MC tour.
                actions = ["North", "South", "West", "East"]
                n_stars = getattr(env, "n_stars", 0)
                star_mode = getattr(env, "star_mode", False)
                n_floor = getattr(env, "n_cells", None)
                n_slip = len(getattr(env, "slip_cells", ()))
                n_plants = len(getattr(env, "plant_cells", ()))
                if star_mode:
                    state_desc = (f"your tile AND which of your {n_stars} tomatoes you already "
                                  f"hold - the cell index x a {n_stars}-bit tomato mask")
                    state_size = (n_floor * (1 << n_stars)) if n_floor else None
                    if n_floor:
                        state_factors = [
                            {"label": "Your tile", "n": n_floor,
                             "detail": "the floor cell you stand on", "color": "#3f7fe0"},
                            {"label": "Tomatoes held", "n": 1 << n_stars,
                             "detail": f"{n_stars}-bit mask (2^{n_stars} = {1 << n_stars} combos)",
                             "color": "#e0563f"},
                        ]
                else:
                    state_desc = "your tile only: the (row, column) cell index"
                    state_size = n_floor
                    if n_floor:
                        state_factors = [
                            {"label": "Your tile", "n": n_floor,
                             "detail": "the floor cell you stand on", "color": "#3f7fe0"},
                        ]
                observation = (f"Each model sees its own tile and its own {n_stars}-tomato progress - a "
                               "single-agent navigator. The maze walls and pipes are FIXED map "
                               "features, so (tile, tomatoes-held) stays Markov; the rival is invisible.")
                observation_tuple = "(cell, tomato mask)" if star_mode else "(cell)"
                sees_opp = False
                opp_info = ("Nothing. There is no opponent term in the state; each model races its "
                            "own mirror-image copy of the same tomato-collection course.")
                stage_pipes = len({
                    req for req in getattr(env, "pipe_req", {}).values()
                    if req is not None
                })
                skid = getattr(env, "r2_slip_prob", R2_SLIP_PROB)
                slip_prob = skid
                if star_mode:
                    dynamics = (
                        f"The generated bottom room offers a SHORT mandatory-puddle shortcut beside "
                        f"a PIRANHA PLANT and a longer hazard-free route into one shared centre Pipe. "
                        f"The second tomato has a short puddle approach and a longer dry approach; "
                        f"after collecting it, the room offers a separate puddle-and-plant shortcut "
                        f"or a longer safe route to each racer's side Pipe. The final tomato also "
                        f"offers wet-short versus dry-long approaches before seeded bush corridors, "
                        f"another plant, and the shared goal. "
                        f"Training keeps 70% full bottom-spawn races and 10% mirrored random "
                        f"post-tomato exploring starts in each collected-mask slice, so Monte "
                        f"Carlo continues to cover the whole long course. Only complete bottom-"
                        f"spawn races count in contest statistics or qualify for top replays. "
                        f"While standing on a puddle, movement skids perpendicular with probability "
                        f"{round(skid * 100)}% total. The 19x19 course contains {n_slip} puddles "
                        f"and {n_plants} plants. There are "
                        f"{stage_pipes} required deterministic WARP PIPE transfers per racer. "
                        f"Entering any of the eight cells around a plant eliminates that racer. "
                        f"Its MC trajectory ends there and it stays out until the next episode; "
                        f"the rival continues until it also resolves or the time limit expires."
                    )
                    rewards = [
                        ["Step", -0.01],
                        ["Collect a tomato (first time only)",
                         round(getattr(env, "star_reward", STAR_REWARD), 2)],
                        ["Win (all 3 tomatoes, then the goal)", 1.0],
                        ["Die in a plant attack zone", -1.0],
                    ]
                    win = (
                        f"Gather all {n_stars} tomatoes and reach the top goal first. "
                        "A racer eaten by a plant remains out until the next episode while "
                        "the other can finish; a simultaneous finish is a draw."
                    )
                    reward_note = (
                        "Each tomato pays its bonus once when collected. Step cost, "
                        "tomato bonuses, the goal reward, and plant-death penalty are "
                        "the complete reward function."
                    )
                else:
                    observation = ("Each model sees only its own tile. The seeded bush maze, "
                                   "puddle, plant attack zone, and Pipe are fixed map features.")
                    opp_info = ("Nothing. Both models receive exact mirrored copies of the same "
                                "bottom-section decision room.")
                    dynamics = (
                        f"The bottom section forks into a SHORT slippery route and a LONG safe "
                        f"route to a deterministic Pipe. On the puddle, movement skids sideways "
                        f"with probability {round(skid * 100)}% total; one skid enters one of the "
                        f"eight lethal cells surrounding the Piranha Plant. Death terminates only "
                        f"that racer's trajectory; it stays out and respawns only when the next "
                        f"episode begins, while the rival keeps moving."
                    )
                    rewards = [["Step", -0.01], ["Opponent dies", 1.0],
                               ["Die in a plant attack zone", -1.0]]
                    win = (
                        "This construction stage tests the bottom decision room. A plant death "
                        "eliminates that racer until the next episode while the rival continues."
                    )
            elif getattr(env, "goomba_mode", False):
                # Round 3 (Fossil Falls): a MIRROR-SYMMETRIC maze race. Both racers start in
                # opposite bottom corners and hunt the shared top-centre exit; 6 Goombas patrol
                # as sentries. A 5th action, STAY, lets a racer wait a beat to time the Goombas.
                actions = ["North", "South", "West", "East", "Stay"]
                has_puzzle = bool(getattr(env, "puzzle", {}) and any(env.puzzle.values()))
                door_n = 2 if has_puzzle else 1
                state_desc = (
                    f"your tile, the Goomba patrol PHASE (steps mod {env._phase_period}: the "
                    "shared cycle on which every Goomba's position repeats), a compact RIVAL "
                    "flag (ahead / level / behind, plus whether YOUR cage pickup is still ready)"
                    + (", and whether YOUR pressure-plate door is open yet" if has_puzzle else "")
                )
                n_cells_r3 = getattr(env, "n_cells", 0)
                phase_period = int(getattr(env, "_phase_period", 1))
                state_size = (n_cells_r3 * phase_period * 6 * door_n) or None
                if n_cells_r3:
                    state_factors = [
                        {"label": "Your tile", "n": n_cells_r3,
                         "detail": "the floor cell you stand on", "color": "#3f7fe0"},
                        {"label": "Patrol phase", "n": phase_period,
                         "detail": f"steps mod {phase_period}: all {len(env.goombas)} Goombas share this cycle",
                         "color": "#e0563f"},
                        {"label": "Rival flag", "n": 6,
                         "detail": "ahead / level / behind x cage-ready",
                         "color": "#8b5cf6"},
                    ]
                    if has_puzzle:
                        state_factors.append(
                            {"label": "Secret door", "n": 2,
                             "detail": "open? (boulder pushed onto your plate) - a permanent shortcut",
                             "color": "#c9862a"})
                observation = (
                    "Its own tile, the patrol phase (so it can TIME the moving Goombas), where the "
                    "rival is, and whether its own cage pickup is still there to grab."
                )
                observation_tuple = "(cell, phase, rival_flag, door)" if has_puzzle else "(cell, phase, rival_flag)"
                sees_opp = True
                opp_info = (
                    "The rival's RELATIVE position is in the state (ahead / level / behind), and a "
                    "bit for whether your CAGE pickup is still available - so a racer can learn to "
                    "detour for the cage and freeze the rival, especially when it is falling behind."
                )
                dynamics = (
                    "4-way moves PLUS a STAY (wait); walls block and the board edge is the outer "
                    "wall. Six GOOMBAS patrol as sentries, each guarding one route cell from a side "
                    "branch - a Goomba on your cell = DEATH, so wait for the gap and slip through. "
                    "WET puddles on the route can SKID your move sideways (the luck that lets one "
                    "racer fall behind). An OFF-route CAGE pickup per side: grab yours (worth it "
                    "when you're behind) to freeze the rival for several steps and catch up. Some "
                    "mazes add a PRESSURE-PLATE puzzle: shove a BOULDER onto your plate to open a "
                    "sealed SECRET-DOOR shortcut (held open for the rest of the episode). The maze "
                    "is MIRROR-SYMMETRIC: both racers face an identical route to the top exit."
                )
                rewards = [["Step", -0.01], ["Reach the goal first (win)", 1.0],
                           ["Grab your cage (freeze the rival)", round(getattr(env, "cage_reward", 0.2), 2)],
                           ["Caught by a Goomba (death)", -1.0],
                           ["Rival reaches the goal first (lose)", -1.0]]
                win = (
                    "First to the shared exit at top-centre wins; a dead heat draws. The maze is "
                    "MIRROR-SYMMETRIC, so both racers run an identical route from their bottom "
                    "corner - the edge comes from TIMING the Goomba sentries (wait for the gap, "
                    "slip through) and detouring to grab your CAGE pickup to freeze the rival."
                )
            elif not arena:
                # skeleton grid rounds: a bare navigate-to-goal ("cross") race
                actions = ["North", "South", "West", "East"]
                state_desc = "your tile only: the (row, column) cell index"
                state_size = getattr(env, "n_cells", None)
                if state_size:
                    state_factors = [
                        {"label": "Your tile", "n": state_size,
                         "detail": "the floor cell you stand on", "color": "#3f7fe0"},
                    ]
                observation = ("Each model sees ONLY its own tile. It learns as a single-agent "
                               "navigator: the maze is shared, but neither model perceives the other.")
                observation_tuple = "(cell)"
                sees_opp = False
                opp_info = ("Nothing. There is no opponent term in the state, so the rival is "
                            "invisible to the agent.")
                dynamics = ("Moves are deterministic. Walls and the map edge block movement "
                            "(you stay put).")
                rewards = [["Step", -0.01], ["Win (reach the Power Moon)", 1.0], ["Lose", -1.0]]
                win = "First to reach the Power Moon wins; a simultaneous arrival is a draw."
            elif getattr(env, "missile_game", False):
                actions = ["8 compass directions + stay (9)"]
                state_size = None
                sees_opp = False
                state_desc = (
                    f"continuous {env.obs_dim}-vector = "
                    "5 own kinematics (position x/z, velocity x/z, rim clearance) + "
                    "5 own effect timers (speed, shield, slow, freeze, post-hit mercy) + "
                    "3 nearest missiles x 8 (present, relative x/z, velocity x/z, "
                    "aimed-at-me, time-to-impact, predicted miss) + "
                    "3 nearest pickups x 7 (present, relative x/z, 4-way type one-hot)"
                )
                # a VISUAL segmented breakdown of the same vector (dims sum to obs_dim),
                # rendered as a stacked bar + legend instead of the run-on sentence above
                state_groups = [
                    {"label": "Self", "dim": 5, "color": "#3f7fe0",
                     "detail": "position x/z, velocity x/z, rim clearance"},
                    {"label": "Effects", "dim": 5, "color": "#22a39f",
                     "detail": "speed, shield, slow, freeze and post-hit mercy timers"},
                    {"label": "Missiles", "dim": 24, "count": 3, "each": 8, "color": "#e0563f",
                     "detail": "3 nearest x (present, rel x/z, vel x/z, aimed-at-me, "
                               "time-to-impact, predicted miss)"},
                    {"label": "Pickups", "dim": 21, "count": 3, "each": 7, "color": "#8b5cf6",
                     "detail": "3 nearest x (present, rel x/z, 4-way type one-hot)"},
                ]
                observation = (
                    "Each agent sees ONLY itself and its immediate surroundings: its own "
                    "position / velocity and clearance to the rim, its own power-up and "
                    "post-hit timers, the 3 nearest Banzai Bills SORTED by how soon they "
                    "reach it (each with a targets-me flag, a time-to-impact and a "
                    "predicted miss distance), and the 3 nearest pickups with their type."
                )
                observation_tuple = "(self, effects, missiles x3, pickups x3)"
                opp_info = (
                    "Nothing - the rival is not in the observation. Each agent just "
                    "survives its own share of the shared missiles; a targets-me flag "
                    "tells it which Bills are currently hunting it."
                )
                repeat = int(getattr(env, "action_repeat", 4))
                hearts = int(getattr(env, "hearts_max", 3))
                dynamics = (
                    "Movement follows the project spec: DISCRETE velocity (each axis -1/0/1) "
                    "chosen every 0.02 s, with NO momentum. The chosen direction is HELD for "
                    f"{repeat} steps (action-repeat) so the policy commits to a heading instead "
                    "of flip-flopping. Inside a circular tower, Banzai Bills enter from the "
                    "north and home in, exploding on a character or the rim. The barrage "
                    "escalates with survival time: 1 Bill at the start, 2 from 100 steps, 3 "
                    f"from 200 (capped at 3). Each character has {hearts} HEARTS - a hit costs "
                    "a heart and grants a brief mercy-invulnerability in place (no respawn); "
                    "the round ends only when a character loses them all. Pickups can speed "
                    "you up, shield you, slow you or briefly freeze you."
                )
                # the four collectible power-ups, as structured data for the Challenge
                # card: two to SEEK (speed, shield) and two to AVOID (slow, freeze).
                pickups = [
                    {"type": "speed", "label": "Speed", "good": True, "icon": "bolt",
                     "color": "#cc9016",   # darker yellow (the two good ones are a yellow pair)
                     "effect": f"Move x{SPEED_MULTIPLIER:g} faster",
                     "seconds": PICKUP_EFFECT_SECONDS["speed"],
                     "detail": "Zip around the tower - dodging the barrage gets much easier."},
                    {"type": "invincible", "label": "Shield", "good": True, "icon": "shield",
                     "color": "#f2b90a",   # yellow
                     "effect": "Immune to hits",
                     "seconds": PICKUP_EFFECT_SECONDS["invincible"],
                     "detail": "Bills pass right through you - plow through danger for a moment."},
                    {"type": "slow", "label": "Slow", "good": False, "icon": "snail",
                     "color": "#ef4136",   # red (matches the in-game red mushroom glow)
                     "effect": f"Move x{SLOW_MULTIPLIER:g} slower",
                     "seconds": PICKUP_EFFECT_SECONDS["slow"],
                     "detail": "Sluggish and easy to corner - steer clear of it."},
                    {"type": "freeze", "label": "Freeze", "good": False, "icon": "ice",
                     "color": "#22bfdd",   # cyan
                     "effect": "Frozen in place",
                     "seconds": PICKUP_EFFECT_SECONDS["freeze"],
                     "detail": "You cannot move at all - the worst thing to touch mid-barrage."},
                ]
                rewards = [
                    ["Stay alive", "+0.2 / second"],
                    ["Dodge a Bill aimed at you (it expires without a hit)", 0.15],
                    ["Change a closing missile's projected miss distance",
                     "up to +/-0.25 / second"],
                    ["Lose a heart (hit by a Banzai Bill)", -2.0],
                    ["Rival loses their last heart (you win)", 0.05],
                ]
                win = (
                    "Each character has 3 hearts; a Bill hit costs one. The round ends when "
                    "a character runs OUT of hearts - the survivor wins (both emptied on "
                    "the same instant is a draw)."
                )
            elif getattr(env, "ctf_game", False):
                actions = ["8 compass thrusts + coast + USE weapon (10)"]
                state_size = None
                sees_opp = True
                state_desc = (
                    f"continuous {env.obs_dim}-vector = "
                    "4 own kinematics (position x/z, velocity x/z) + "
                    "4 opponent terms (rival relative position x/z, velocity x/z) + "
                    "5 flag terms (relative x/z, and 3 flags: free / you-carry / "
                    "rival-carries) + 4 base vectors (to your base, to the rival's base) + "
                    "4 status terms (carrying, your + rival stun timers, capture lead) + "
                    "6 crate terms (2 nearest crates: present, relative x/z) + "
                    "5 held-weapon one-hot (chain / red shell / green shell / banana / "
                    "oil; all 0 = empty) + 1 rival-armed flag + "
                    "10 shell terms (2 nearest shells: present, relative x/z, velocity x/z) + "
                    "8 trap terms (2 nearest traps: present, relative x/z, is-oil) + "
                    "15 hazard terms (3 nearest thrown Bowser objects WITHIN sight: "
                    "present, relative x/z, velocity x/z)"
                )
                # segmented breakdown (dims sum to obs_dim = 66) for the stacked bar
                state_groups = [
                    {"label": "Self", "dim": 4, "color": "#3f7fe0",
                     "detail": "your position x/z and velocity x/z"},
                    {"label": "Opponent", "dim": 4, "color": "#e0563f",
                     "detail": "the RIVAL's relative position x/z and velocity x/z"},
                    {"label": "Flag", "dim": 5, "color": "#f5c542",
                     "detail": "flag relative x/z + who holds it (free / you / rival)"},
                    {"label": "Bases", "dim": 4, "color": "#22a39f",
                     "detail": "vector to YOUR base and to the rival's base"},
                    {"label": "Status", "dim": 4, "color": "#8b5cf6",
                     "detail": "carrying, your + rival stun timers, capture lead"},
                    {"label": "Crates", "dim": 6, "count": 2, "each": 3, "color": "#c98a3a",
                     "detail": "2 nearest crates (present, relative x/z)"},
                    {"label": "Weapon", "dim": 6, "color": "#d94f8a",
                     "detail": "your held weapon (5-way one-hot) + is the rival armed?"},
                    {"label": "Shells", "dim": 10, "count": 2, "each": 5, "color": "#e07b3f",
                     "detail": "2 nearest shells (present, relative x/z, velocity x/z)"},
                    {"label": "Traps", "dim": 8, "count": 2, "each": 4, "color": "#6b8e23",
                     "detail": "2 nearest traps (present, relative x/z, is-oil)"},
                    {"label": "Bowser objects", "dim": 15, "count": 3, "each": 5,
                     "color": "#3aa76d",
                     "detail": "3 nearest thrown objects within sight (present, rel x/z, "
                               "velocity x/z) - so it can DODGE them"},
                ]
                observation = (
                    "Each agent sees ITSELF AND ITS RIVAL: its own position/velocity, the "
                    "rival's relative position/velocity, where the flag is and who holds "
                    "it, the direction to both bases, the status terms (carrying, the two "
                    "stun timers, capture lead), the two nearest crates, WHICH weapon it is "
                    "holding (and whether the rival is armed), the two nearest incoming "
                    "shells and laid traps, and the nearest objects Bowser has thrown that "
                    "are within its sight range (to dodge)."
                )
                observation_tuple = (
                    "(self, opponent, flag + holder, bases, status, crates, weapon, "
                    "shells, traps, Bowser objects)")
                opp_info = (
                    "FULLY VISIBLE - this is the whole point of the round. The rival's "
                    "relative position and velocity are in every observation, so a good "
                    "policy learns to INTERCEPT the carrier when chasing and to JUKE away "
                    "from the chaser when carrying (and the best juke is unpredictable - "
                    "why a stochastic policy-gradient policy shines here)."
                )
                dynamics = (
                    "Continuous physics WITH momentum: a thrust accelerates the flyer (with "
                    "drag) up to a speed cap. One flag sits on the centre pole. GRAB it to "
                    "become the CARRIER (you move ~0.72x speed while carrying); the other "
                    "is the CHASER. Tag the carrier to INSTANTLY STEAL the flag - the "
                    "robbed carrier is briefly stunned. Deliver the flag to your own corner "
                    "base to CAPTURE it (+1); it then respawns on the pole. Breakable "
                    "CRATES spawn around the board: smash one to pick up a random Mario-Kart "
                    "WEAPON into a one-slot inventory, HELD until you fire it with the USE "
                    "action - Chain Chomp (yank the rival in + stun it), a homing Red shell "
                    "or a straight Green shell (both stun on hit; the green bounces off "
                    "walls), a Banana (a laid trap that stuns whoever drives over it) or "
                    "an Oil slick (throws the rival backwards + briefly dazes it). "
                    "Overhead, BOWSER'S AIRSHIP cruises the north edge and periodically "
                    "HURLS objects at random board spots (never aimed at anyone); an object "
                    "that flies into an agent stuns it, so both must DODGE. The number of "
                    "objects thrown, their speed, and how far ahead the agents see them are "
                    "all tunable from the World card."
                )
                rewards = [
                    ["Grab the loose flag", 0.15],
                    ["Steal it (tag the enemy carrier)", 0.40],
                    ["Lose it to a tag", -0.40],
                    ["Capture at your base", 1.0],
                    ["The rival captures one", -0.30],
                    ["Smash a crate (pick up a weapon)", 0.10],
                    ["Chain-yank the rival", 0.08],
                    ["Hit the rival with a shell", 0.30],
                    ["Snare the rival with a banana / oil", 0.25],
                    ["Hit by a shell / trap / Bowser object (stunned)", -0.05],
                    ["Win the round (first to 3 captures)", 2.0],
                    ["Step", -0.002],
                ]
                win = (
                    "First to CAPTURE 3 flags wins the round. If time runs out first, "
                    "whoever has captured more wins (equal captures is a draw)."
                )
            else:
                actions = ["8 compass thrusts + coast (9)"]
                state_size = None
                sees_opp = False
                state_desc = "continuous 6-vector: position, velocity, goal offset (all normalized)"
                observation = ("Its own position and velocity, and the vector to the goal - all "
                               "normalized to the arena size.")
                observation_tuple = "(x, z, vx, vz, goal dx, goal dz)"
                opp_info = ("Nothing. Each model flies its own copy of the physics; the opponent "
                            "is not part of the observation.")
                dynamics = ("Continuous physics: a thrust accelerates the flyer (with drag). Walls "
                            "clamp it back.")
                rewards = [["Step", -0.006], ["Win (reach goal)", 1.0], ["Lose", -1.0]]
                win = "First to reach the goal region wins; a tie is a draw."
            g, gr = self.gamma, self.red_gamma
            horizon = lambda x: (round(1.0 / (1.0 - x), 1) if x < 1 else None)
            # is the factor product the EXACT |S|? true only when every factor is
            # independent (R2 cell x mask); R1's wall cells carry fewer statuses and
            # R3's phase/rival flags are not all jointly reachable, so those are "~".
            factor_product = 1
            for f in (state_factors or []):
                factor_product *= f["n"]
            state_factors_exact = bool(
                state_factors and state_size and factor_product == state_size
            )
            learning = {
                "blue": {"alpha": round(self.alpha, 3), "gamma": round(g, 3),
                         "epsStart": round(self.eps_start, 2), "epsEnd": round(self.eps_end, 2),
                         "epsEpisodes": self._effective_blue_eps_episodes(),
                         "algo": meta["labelBlue"]},
                "red": {"alpha": round(self.red_alpha, 3), "gamma": round(gr, 3),
                        "epsStart": round(self.red_eps_start, 2), "epsEnd": round(self.red_eps_end, 2),
                        "epsEpisodes": self._effective_red_eps_episodes(),
                        "algo": meta["labelRed"]},
                "planning": bool(is_dp(self.algo_blue)),
            }
            return {
                "round": self.round_id, "title": meta["title"], "theme": meta["theme"],
                "objective": env.objective,
                "kind": "arena" if arena else env.objective,
                "missileGame": bool(getattr(env, "missile_game", False)),
                "matchup": meta["matchup"], "labelRed": meta["labelRed"], "labelBlue": meta["labelBlue"],
                "family": self._family(),
                "stateDesc": state_desc, "stateSize": state_size, "stateGroups": state_groups,
                "stateFactors": state_factors, "stateFactorsExact": state_factors_exact,
                "learning": learning,
                "observation": observation, "observationTuple": observation_tuple,
                "seesOpponent": sees_opp, "opponentInfo": opp_info,
                "dynamics": dynamics,
                "actions": actions, "nActions": env.n_actions,
                "maxSteps": env.max_steps,
                "slipProb": slip_prob,
                "gammaRed": round(gr, 3), "gammaBlue": round(g, 3),
                "horizonBlue": horizon(g), "horizonRed": horizon(gr),
                "horizon": horizon(g),
                "winCondition": win,
                "rewards": rewards,
                "rewardNote": reward_note,
                "pickups": pickups,
                # Round-5 Capture-the-Flag: the crate weapons, listed for the briefing
                "weapons": ([
                    {"name": "Chain Chomp", "icon": "chain",
                     "desc": "Throws a chomp head that flies to the rival, reels it in "
                             "point-blank, and stuns it."},
                    {"name": "Red shell", "icon": "red_shell",
                     "desc": "A homing shell that chases the rival and stuns on hit."},
                    {"name": "Green shell", "icon": "green_shell",
                     "desc": "Fires straight and bounces off walls; stuns whoever it hits."},
                    {"name": "Banana", "icon": "banana",
                     "desc": "A peel dropped behind you; whoever drives over it is stunned."},
                    {"name": "Oil slick", "icon": "oil",
                     "desc": "An oil pool that throws the rival backwards and briefly dazes it."},
                ] if getattr(env, "ctf_game", False) else None),
            }
