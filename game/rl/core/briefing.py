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
                actions = ["Up", "Down", "Left", "Right"]
                # coins and Mystery Blocks are counted separately for the wording (the
                # collected mask is one bit per item, so nbits is still their sum)
                n_coins = env._n_coins["blue"]
                n_blocks = len(env.block_cells["blue"])
                nbits = n_coins + n_blocks
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
                     "detail": "the square of the castle floor you are standing on",
                     "color": "#3f7fe0"},
                    {"label": "Collected", "n": 1 << nbits,
                     "detail": f"every combination of which of your {n_coins} "
                               f"coin{'' if n_coins == 1 else 's'} and {n_blocks} "
                               f"Mystery Block{'' if n_blocks == 1 else 's'} you have "
                               f"already taken",
                     "color": "#8b5cf6"},
                    {"label": "Status", "n": gl + fl + 1,
                     "detail": f"normal, Ghost (up to {gl} tiles left) or Frozen "
                               f"(up to {fl} turns left)",
                     "color": "#22a39f"},
                ]
                state_desc = ("which tile you stand on, what you have collected so far, and "
                              "whether a Ghost or Freeze effect is running")
                observation = ("The racer knows three things: the tile it stands on, which of "
                               "its own coins and Mystery Blocks it has already taken, and "
                               "whether a Ghost or Freeze effect is currently ticking. That is "
                               "its whole picture of the world.")
                observation_tuple = "(tile, collected, status)"
                sees_opp = False
                opp_info = ("No - the rival appears nowhere in the snapshot. Each racer has "
                            "its own mirror-image coins and blocks, so the race is perfectly "
                            "fair, but each one plans as if it were alone in the castle.")
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
                actions = ["Up", "Down", "Left", "Right"]
                n_stars = getattr(env, "n_stars", 0)
                star_mode = getattr(env, "star_mode", False)
                n_floor = getattr(env, "n_cells", None)
                n_slip = len(getattr(env, "slip_cells", ()))
                n_plants = len(getattr(env, "plant_cells", ()))
                if star_mode:
                    state_desc = (f"which tile you stand on, plus which of your {n_stars} "
                                  f"tomatoes you have already picked up")
                    state_size = (n_floor * (1 << n_stars)) if n_floor else None
                    if n_floor:
                        state_factors = [
                            {"label": "Your tile", "n": n_floor,
                             "detail": "the square of the park you are standing on",
                             "color": "#3f7fe0"},
                            {"label": "Tomatoes held", "n": 1 << n_stars,
                             "detail": f"one yes/no per tomato - {1 << n_stars} possible "
                                       f"combinations of what you hold",
                             "color": "#e0563f"},
                        ]
                else:
                    state_desc = "which tile you stand on - nothing else"
                    state_size = n_floor
                    if n_floor:
                        state_factors = [
                            {"label": "Your tile", "n": n_floor,
                             "detail": "the square of the park you are standing on",
                             "color": "#3f7fe0"},
                        ]
                observation = (f"The racer knows exactly two things: the tile it stands on and "
                               f"which of its {n_stars} tomatoes it has picked up so far. The "
                               "walls, pipes and plants never move, so this tiny snapshot really "
                               "is the full picture - and the rival is invisible to it.")
                observation_tuple = "(tile, tomatoes)" if star_mode else "(tile)"
                sees_opp = False
                opp_info = ("No - the rival appears nowhere in the snapshot. Each racer runs "
                            "its own mirror-image copy of the same course, so the two never "
                            "even touch each other.")
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
                    observation = ("The racer knows only the tile it stands on. The maze, "
                                   "puddle, plant zone and Pipe are fixed parts of the map.")
                    opp_info = ("No - the rival appears nowhere in the snapshot. Both models "
                                "get exact mirrored copies of the same decision room.")
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
                actions = ["Up", "Down", "Left", "Right", "Stay"]
                has_puzzle = bool(getattr(env, "puzzle", {}) and any(env.puzzle.values()))
                door_n = 2 if has_puzzle else 1
                state_desc = (
                    "which tile you stand on, where the Goombas are in their repeating patrol "
                    "loop, how the race stands (ahead / level / behind, and whether your cage "
                    "pickup is still there)"
                    + (", and whether your shortcut door is open yet" if has_puzzle else "")
                )
                n_cells_r3 = getattr(env, "n_cells", 0)
                phase_period = int(getattr(env, "_phase_period", 1))
                state_size = (n_cells_r3 * phase_period * 6 * door_n) or None
                if n_cells_r3:
                    state_factors = [
                        {"label": "Your tile", "n": n_cells_r3,
                         "detail": "the maze square you are standing on", "color": "#3f7fe0"},
                        {"label": "Patrol tick", "n": phase_period,
                         "detail": f"where the {len(env.goombas)} Goombas are in their shared "
                                   f"{phase_period}-step patrol loop - knowing the tick means "
                                   "knowing where every Goomba is",
                         "color": "#e0563f"},
                        {"label": "Race + cage", "n": 6,
                         "detail": "ahead / level / behind in the race, combined with whether "
                                   "your cage pickup is still available",
                         "color": "#8b5cf6"},
                    ]
                    if has_puzzle:
                        state_factors.append(
                            {"label": "Secret door", "n": 2,
                             "detail": "whether your shortcut door has been opened (it stays "
                                       "open for the rest of the episode)",
                             "color": "#c9862a"})
                observation = (
                    "The racer knows the tile it stands on, the tick of the Goomba patrol loop "
                    "(so it can wait for a gap instead of walking into one), whether it is "
                    "ahead, level or behind in the race, and whether its cage pickup is still "
                    "on the board."
                )
                observation_tuple = ("(tile, patrol tick, race, door)" if has_puzzle
                                     else "(tile, patrol tick, race)")
                sees_opp = True
                opp_info = (
                    "Partly. It never sees the rival's exact tile - only whether it is ahead, "
                    "level or behind. That one hint is enough to learn the catch-up play: when "
                    "behind, detour to the cage pickup and freeze the rival."
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
                actions = ["Up", "Down", "Left", "Right"]
                state_desc = "which tile you stand on - nothing else"
                state_size = getattr(env, "n_cells", None)
                if state_size:
                    state_factors = [
                        {"label": "Your tile", "n": state_size,
                         "detail": "the floor square you are standing on", "color": "#3f7fe0"},
                    ]
                observation = ("The racer knows only the tile it stands on. The maze is shared, "
                               "but neither model perceives the other.")
                observation_tuple = "(tile)"
                sees_opp = False
                opp_info = ("No - the rival appears nowhere in the snapshot, so each model "
                            "races as if it were alone.")
                dynamics = ("Moves are deterministic. Walls and the map edge block movement "
                            "(you stay put).")
                rewards = [["Step", -0.01], ["Win (reach the Power Moon)", 1.0], ["Lose", -1.0]]
                win = "First to reach the Power Moon wins; a simultaneous arrival is a draw."
            elif getattr(env, "missile_game", False):
                actions = ["8 directions (incl. diagonals) + stay (9)"]
                state_size = None
                sees_opp = False
                state_desc = (f"a continuous {env.obs_dim}-vector: everything the flyer "
                              "senses, refreshed every step - see the breakdown below")
                # a VISUAL segmented breakdown of the vector (dims sum to obs_dim),
                # rendered as a stacked bar + legend. ``fields`` names the numbers
                # ONE BY ONE, in the exact order _missile_observe appends them (for a
                # repeated group it describes ONE slot); keep the two in sync.
                state_groups = [
                    {"label": "Self", "dim": 5, "color": "#3f7fe0",
                     "detail": "where it is, how fast it is moving, and the room left "
                               "before the arena rim",
                     "fields": [
                         "x position, measured from the arena centre "
                         "(0 = dead centre, ±1 = the rim)",
                         "z position, same scale",
                         "speed along x, as a share of top speed (-1 .. +1)",
                         "speed along z, same scale",
                         "room left before the rim (1 = dead centre, 0 = touching it)",
                     ]},
                    {"label": "Effects", "dim": 5, "color": "#22a39f",
                     "detail": "the time left on each effect: Speed, Shield, Slow, Freeze, "
                               "and the brief mercy after a hit",
                     "fields": [
                         "Speed boost left (1 = just picked up, 0 = not active)",
                         "Shield left, same scale",
                         "Slow left, same scale",
                         "Freeze left, same scale",
                         "mercy invulnerability left after a hit, same scale",
                     ]},
                    {"label": "Missiles", "dim": 24, "count": 3, "each": 8, "color": "#e0563f",
                     "detail": "the 3 closest Bills, soonest first: where each is, how it "
                               "moves, whether it hunts YOU, how soon it arrives, and how "
                               "far it would miss",
                     "eachLabel": "per Bill",
                     "fields": [
                         "is this slot filled? (1 = a Bill is here; 0 = empty, and the "
                         "other 7 numbers are all 0)",
                         "how far it sits from you along x (its x minus yours)",
                         "how far it sits from you along z",
                         "its speed along x, as a share of top Bill speed",
                         "its speed along z, same scale",
                         "who it hunts (+1 = YOU, -1 = the rival)",
                         "how soon it arrives (0 = impact now, 1 = two seconds away, or "
                         "not closing at all)",
                         "how far it would miss by (0 = dead on you, 1 = misses by 3 "
                         "units or more)",
                     ]},
                    {"label": "Pickups", "dim": 21, "count": 3, "each": 7, "color": "#8b5cf6",
                     "detail": "the 3 closest pickups: where each is and which of the 4 "
                               "types it is",
                     "eachLabel": "per pickup",
                     "fields": [
                         "is this slot filled? (1 = a pickup is here, 0 = empty)",
                         "how far it sits from you along x",
                         "how far it sits from you along z",
                         "is it Speed? (1 or 0)",
                         "is it Shield? (1 or 0)",
                         "is it Slow? (1 or 0)",
                         "is it Freeze? (1 or 0)",
                     ]},
                ]
                observation = (
                    "The flyer senses only its own bubble of the arena: its own motion, its "
                    "active effects, the 3 missiles closing in soonest and the 3 nearest "
                    f"pickups. All of it is packed into {env.obs_dim} numbers, refreshed "
                    "every step."
                )
                observation_tuple = "(self, effects, missiles x3, pickups x3)"
                opp_info = (
                    "No - the rival is not in the snapshot at all. Each flyer simply dodges "
                    "its own missiles; the hunts-YOU flag tells it which Bills are actually "
                    "after it."
                )
                repeat = int(getattr(env, "action_repeat", 4))
                hearts = int(getattr(env, "hearts_max", 3))
                dynamics = (
                    "Movement follows the project spec: DISCRETE velocity (each axis -1/0/1) "
                    "chosen every 0.02 s, with NO momentum. The chosen direction is HELD for "
                    f"{repeat} steps (action-repeat) so the policy commits to a heading instead "
                    "of flip-flopping. Inside a circular tower, Banzai Bills enter from the "
                    "top and home in, exploding on a character or the rim. The barrage "
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
                actions = ["8 thrust directions + coast + USE weapon (10)"]
                state_size = None
                sees_opp = True
                state_desc = (f"a continuous {env.obs_dim}-vector: everything the agent "
                              "senses, refreshed every step - see the breakdown below")
                # segmented breakdown (dims sum to obs_dim) for the stacked bar.
                # ``fields`` names the numbers ONE BY ONE, in the exact order
                # _observe_ctf appends them (for a repeated group it describes ONE
                # slot); keep the two in sync. Every relative offset below is
                # "theirs minus yours", divided by the arena width.
                state_groups = [
                    {"label": "Self", "dim": 4, "color": "#3f7fe0",
                     "detail": "where you are and how fast you are moving",
                     "fields": [
                         "your x on the board (0 = one edge, 1 = the other)",
                         "your z, same scale",
                         "your speed along x, as a share of top speed (-1 .. +1)",
                         "your speed along z, same scale",
                     ]},
                    {"label": "Opponent", "dim": 4, "color": "#e0563f",
                     "detail": "where the RIVAL is relative to you, and how fast it is moving",
                     "fields": [
                         "how far the rival sits from you along x",
                         "how far it sits from you along z",
                         "its speed along x, as a share of top speed",
                         "its speed along z, same scale",
                     ]},
                    {"label": "Flag", "dim": 5, "color": "#f5c542",
                     "detail": "where the flag is, and who has it: free / you / the rival",
                     "fields": [
                         "how far the flag is from you along x",
                         "how far it is from you along z",
                         "is it loose on the board? (1 or 0)",
                         "are YOU carrying it? (1 or 0)",
                         "is the RIVAL carrying it? (1 or 0)",
                     ]},
                    {"label": "Bases", "dim": 4, "color": "#22a39f",
                     "detail": "the direction to YOUR base and to the rival's",
                     "fields": [
                         "how far YOUR base is from you along x",
                         "how far YOUR base is from you along z",
                         "how far the RIVAL's base is from you along x",
                         "how far the RIVAL's base is from you along z",
                     ]},
                    {"label": "Status", "dim": 4, "color": "#8b5cf6",
                     "detail": "carrying the flag?, both stun timers, and who leads on captures",
                     "fields": [
                         "are you carrying the flag? (1 or 0; repeated here so the "
                         "carry / chase switch is unmissable)",
                         "how long YOU stay stunned (1 = just hit, 0 = free to move)",
                         "how long the RIVAL stays stunned, same scale",
                         "the capture lead (+1 = you need one more to win, -1 = the "
                         "rival does)",
                     ]},
                    {"label": "Crates", "dim": 6, "count": 2, "each": 3, "color": "#c98a3a",
                     "detail": "the 2 nearest weapon crates and where they are",
                     "eachLabel": "per crate",
                     "fields": [
                         "is this slot filled? (1 = a crate is here; 0 = empty, and the "
                         "other 2 numbers are 0)",
                         "how far it sits from you along x",
                         "how far it sits from you along z",
                     ]},
                    {"label": "Weapon", "dim": 6, "color": "#d94f8a",
                     "detail": "which weapon you are holding (if any), and whether the "
                               "rival is armed",
                     "fields": [
                         "holding a Chain Chomp? (1 or 0)",
                         "holding a red shell? (1 or 0)",
                         "holding a green shell? (1 or 0)",
                         "holding a banana? (1 or 0)",
                         "holding oil? (1 or 0; all five 0 = your slot is empty)",
                         "is the RIVAL holding something? (1 or 0)",
                     ]},
                    {"label": "Shells", "dim": 10, "count": 2, "each": 5, "color": "#e07b3f",
                     "detail": "the 2 nearest shells in flight: where each is and where "
                               "it is heading",
                     "eachLabel": "per shell",
                     "fields": [
                         "is this slot filled? (1 = a shell is in flight here, 0 = empty)",
                         "how far it sits from you along x",
                         "how far it sits from you along z",
                         "its speed along x, as a share of shell speed",
                         "its speed along z, same scale",
                     ]},
                    {"label": "Traps", "dim": 8, "count": 2, "each": 4, "color": "#6b8e23",
                     "detail": "the 2 nearest laid traps: where each is and whether it is oil",
                     "eachLabel": "per trap",
                     "fields": [
                         "is this slot filled? (1 = a trap is here, 0 = empty)",
                         "how far it sits from you along x",
                         "how far it sits from you along z",
                         "which kind (1 = oil slick, 0 = banana)",
                     ]},
                    {"label": "Bowser objects", "dim": 15, "count": 3, "each": 5,
                     "color": "#3aa76d",
                     "detail": "the 3 nearest falling objects within sight, so it can "
                               "DODGE them",
                     "eachLabel": "per object",
                     "fields": [
                         "is this slot filled? (1 = an object is in range, 0 = empty; "
                         "anything further than the sight radius never shows up)",
                         "how far it sits from you along x",
                         "how far it sits from you along z",
                         "its speed along x, as a share of throw speed",
                         "its speed along z, same scale",
                     ]},
                ]
                observation = (
                    "The agent sees the whole duel: itself, the rival, the flag and who "
                    "holds it, both bases, the stun and capture situation, nearby crates, "
                    "the weapon it holds, and every shell, trap and falling object close "
                    f"enough to matter. All of it is packed into {env.obs_dim} numbers, "
                    "refreshed every step."
                )
                observation_tuple = (
                    "(self, opponent, flag + holder, bases, status, crates, weapon, "
                    "shells, traps, Bowser objects)")
                opp_info = (
                    "Yes, fully - and that is the point of this round. The rival's position "
                    "and speed are in every snapshot, so a good policy learns to INTERCEPT "
                    "the carrier when chasing and to JUKE the chaser when carrying. The "
                    "best juke is unpredictable, which is exactly why a stochastic "
                    "policy-gradient player shines here."
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
                    "Overhead, BOWSER'S AIRSHIP cruises the top edge and periodically "
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
                actions = ["8 thrust directions + coast (9)"]
                state_size = None
                sees_opp = False
                state_desc = ("a continuous 6-vector: position, velocity and the offset "
                              "to the goal")
                observation = ("The flyer knows its own position and speed, plus the "
                               "direction to the goal - six numbers in total.")
                observation_tuple = "(x, z, vx, vz, goal dx, goal dz)"
                opp_info = ("No - the rival appears nowhere in the snapshot. Each model "
                            "flies its own copy of the physics.")
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
