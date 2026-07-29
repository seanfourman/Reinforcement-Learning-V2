"""The CPU difficulty ladders: 10 hyperparameter models per arena, one per
character (level 0 = Mario, easiest .. 9 = Parabones, hardest), plus Blue's
per-arena starting profiles.

Red (the CPU) is NOT tunable from the panel; its strength comes entirely from
the chosen character's row here. Stage 1 reads plan_speed (Bellman sweeps per
tick); the learning arenas read alpha / gamma / the epsilon schedule; the
policy-gradient arena reads alpha / gamma / entropy (it has no epsilon).
``red_params`` / ``blue_params`` resolve a level + round into one flat profile.
"""


# Red (the CPU) is NOT tunable from the panel; its strength comes from the chosen
# CPU character's tier (1 = easiest .. 5 = hardest). Stage 1 reads ONLY plan_speed.
# The learning rate and epsilon schedule are stored in the same cross-stage character
# profile for the later learning arenas, but DP never reads or applies them.
RED_GAMMA = 0.98



# 10 CPU hyperparameter MODELS, one PER CHARACTER (level 0 = Mario, easiest .. 9 =
# Parabones, hardest). Stage 1 reads plan_speed. The generic learning values remain
# the defaults for later TD/deep arenas. Arena 2 has its own empirically tuned MC
# block because long, full-return learning FAILS when epsilon is driven toward zero:
# Every-visit needs a floor around .20 and First-visit tolerates about .16. Rows are
# monotonic within each alternating MC family (even levels Every-visit, odd levels
# First-visit), and gamma=.98 won the long-course benchmark over .995.
RED_MODELS = [
    # Generic later arenas ------------------------------  Arena 2 MC -------------------------------------------
    # plan     alpha  eps0   eps1  decay                    alpha gamma eps0  eps1  decay
    {"plan_speed": .15, "alpha": .08, "eps_start": 1.00, "eps_end": .35, "eps_episodes": 9000,
     "r2": {"alpha": .14, "gamma": .98, "eps_start": 1.00, "eps_end": .40, "eps_episodes": 11000}},  # 0 Mario
    {"plan_speed": .30, "alpha": .12, "eps_start": .96, "eps_end": .30, "eps_episodes": 8000,
     "r2": {"alpha": .15, "gamma": .98, "eps_start": .98, "eps_end": .36, "eps_episodes": 10000}},  # 1 Luigi
    {"plan_speed": .50, "alpha": .16, "eps_start": .92, "eps_end": .26, "eps_episodes": 7000,
     "r2": {"alpha": .16, "gamma": .98, "eps_start": .96, "eps_end": .33, "eps_episodes": 9500}},   # 2 Yoshi
    {"plan_speed": .75, "alpha": .20, "eps_start": .88, "eps_end": .22, "eps_episodes": 6000,
     "r2": {"alpha": .17, "gamma": .98, "eps_start": .94, "eps_end": .29, "eps_episodes": 8500}},   # 3 Toadette
    {"plan_speed": 1.05, "alpha": .24, "eps_start": .84, "eps_end": .18, "eps_episodes": 5000,
     "r2": {"alpha": .18, "gamma": .98, "eps_start": .92, "eps_end": .27, "eps_episodes": 8000}},   # 4 Pauline
    {"plan_speed": 1.40, "alpha": .28, "eps_start": .80, "eps_end": .14, "eps_episodes": 4000,
     "r2": {"alpha": .19, "gamma": .98, "eps_start": .90, "eps_end": .23, "eps_episodes": 7200}},   # 5 Koopa
    {"plan_speed": 1.80, "alpha": .31, "eps_start": .75, "eps_end": .10, "eps_episodes": 3000,
     "r2": {"alpha": .20, "gamma": .98, "eps_start": .88, "eps_end": .23, "eps_episodes": 7000}},   # 6 Bowser
    {"plan_speed": 2.25, "alpha": .34, "eps_start": .70, "eps_end": .07, "eps_episodes": 2000,
     "r2": {"alpha": .21, "gamma": .98, "eps_start": .87, "eps_end": .19, "eps_episodes": 6500}},   # 7 Peach
    {"plan_speed": 2.80, "alpha": .37, "eps_start": .65, "eps_end": .04, "eps_episodes": 1000,
     "r2": {"alpha": .22, "gamma": .98, "eps_start": .86, "eps_end": .20, "eps_episodes": 6000}},   # 8 Toad
    {"plan_speed": 3.40, "alpha": .40, "eps_start": .60, "eps_end": .01, "eps_episodes": 400,
     "r2": {"alpha": .22, "gamma": .98, "eps_start": .86, "eps_end": .16, "eps_episodes": 6000}},   # 9 Parabones
]


# Blue is user-tunable, but every arena starts from a profile that is actually
# suitable for that algorithm. The generic schedule remains the default for
# later one-step/deep arenas; Arena 2 needs sustained exploration because a
# Monte-Carlo update only arrives after a long three-room return.
BLUE_MODEL = {
    "alpha": .20, "gamma": .98,
    "eps_start": 1.00, "eps_end": .05, "eps_episodes": 3000,
    "r2": {
        "alpha": .19, "gamma": .98,
        "eps_start": .90, "eps_end": .05, "eps_episodes": 7200,
    },
}



# Arena 4 (Ruined Kingdom, DQN survival) CPU ladder: a stronger character plays closer
# to optimal (lower final epsilon => it DODGES instead of wandering into a Bill), learns
# faster (fewer decay episodes), and looks a little further ahead (higher gamma). dt=0.02
# discrete velocity + action-repeat make these learnable. Index = character level 0..9.
R4_LADDER = [
    {"alpha": .20, "gamma": .980, "eps_start": 1.00, "eps_end": .30, "eps_episodes": 4000},  # 0 Mario
    {"alpha": .22, "gamma": .980, "eps_start": 1.00, "eps_end": .26, "eps_episodes": 3600},  # 1 Luigi
    {"alpha": .24, "gamma": .982, "eps_start": 1.00, "eps_end": .22, "eps_episodes": 3200},  # 2 Yoshi
    {"alpha": .26, "gamma": .984, "eps_start": .98, "eps_end": .18, "eps_episodes": 2800},   # 3 Toadette
    {"alpha": .28, "gamma": .986, "eps_start": .96, "eps_end": .15, "eps_episodes": 2400},   # 4 Pauline
    {"alpha": .30, "gamma": .988, "eps_start": .94, "eps_end": .12, "eps_episodes": 2000},   # 5 Koopa
    {"alpha": .32, "gamma": .990, "eps_start": .92, "eps_end": .09, "eps_episodes": 1600},   # 6 Bowser
    {"alpha": .34, "gamma": .992, "eps_start": .90, "eps_end": .07, "eps_episodes": 1200},   # 7 Peach
    {"alpha": .36, "gamma": .994, "eps_start": .88, "eps_end": .05, "eps_episodes": 900},    # 8 Toad
    {"alpha": .38, "gamma": .995, "eps_start": .85, "eps_end": .03, "eps_episodes": 600},    # 9 Parabones
]

BLUE_R4 = {"alpha": .30, "gamma": .99, "eps_start": 1.00, "eps_end": .05, "eps_episodes": 2500}



# Arena 3 (Fossil Falls, SARSA vs Q-Learning) CPU ladder. Retuned 2026-07-29 after the round
# grew richer (patrolling Goombas + a WET-skid + an off-route CAGE + a boulder/pressure-plate
# SECRET-DOOR, and a bigger state). The old generic RED_MODELS schedules (ε decaying over up to
# 9000 episodes) left the easy characters non-functional at any realistic training budget - they
# never even reached the exit. Here EVERY character learns a working policy within ~2k episodes
# (ε_start=1.0, short decay, α high enough); the DIFFICULTY comes from the held final ε (the
# random-move rate each character keeps playing at forever): Mario ~0.32 = a weak, dithering
# opponent that mostly loses, down to Parabones ~0.02 = near-optimal. α also ramps up so the
# stronger characters converge sooner. Monotonic; the player's default Blue holds ε=0.05, so it
# out-plays everyone up to ~Koopa and must be tuned to beat Peach/Toad/Parabones. Index = level 0..9.
R3_LADDER = [
    {"alpha": .24, "gamma": .98, "eps_start": 1.00, "eps_end": .40, "eps_episodes": 2200},  # 0 Mario
    {"alpha": .26, "gamma": .98, "eps_start": 1.00, "eps_end": .35, "eps_episodes": 2000},  # 1 Luigi
    {"alpha": .28, "gamma": .98, "eps_start": 1.00, "eps_end": .30, "eps_episodes": 1800},  # 2 Yoshi
    {"alpha": .30, "gamma": .98, "eps_start": 1.00, "eps_end": .25, "eps_episodes": 1600},  # 3 Toadette
    {"alpha": .32, "gamma": .98, "eps_start": 1.00, "eps_end": .20, "eps_episodes": 1400},  # 4 Pauline
    {"alpha": .34, "gamma": .98, "eps_start": 1.00, "eps_end": .15, "eps_episodes": 1200},  # 5 Koopa
    {"alpha": .36, "gamma": .98, "eps_start": 1.00, "eps_end": .11, "eps_episodes": 1000},  # 6 Bowser
    {"alpha": .38, "gamma": .98, "eps_start": 1.00, "eps_end": .08, "eps_episodes": 850},   # 7 Peach
    {"alpha": .39, "gamma": .98, "eps_start": 1.00, "eps_end": .05, "eps_episodes": 700},   # 8 Toad
    {"alpha": .40, "gamma": .98, "eps_start": 1.00, "eps_end": .02, "eps_episodes": 550},   # 9 Parabones
]


# Arena 5 (Tostarena, Capture the Flag, POLICY GRADIENT) CPU ladder. Policy gradients
# don't use epsilon (they explore via policy ENTROPY), so difficulty is driven by the
# LEARNING RATE (alpha -> Adam lr, see pg.PGAgent._lr) and the discount gamma: a weak
# character learns slowly and short-sighted (barely improves within a match); a strong
# one learns fast + plans further, so it out-grabs/steals/dodges the player. The
# per-character ENTROPY drops with difficulty too (weak = stays random/dithers forever;
# strong = commits to a sharp policy). eps_* are carried for the shared consumer but
# unused by PG. Monotonic easy->hard. Index = character level 0..9.
R5_LADDER = [
    {"alpha": .10, "gamma": .970, "entropy": .050, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 0 Mario
    {"alpha": .14, "gamma": .972, "entropy": .042, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 1 Luigi
    {"alpha": .18, "gamma": .974, "entropy": .035, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 2 Yoshi
    {"alpha": .22, "gamma": .976, "entropy": .028, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 3 Toadette
    {"alpha": .26, "gamma": .978, "entropy": .022, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 4 Pauline
    {"alpha": .30, "gamma": .980, "entropy": .017, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 5 Koopa
    {"alpha": .34, "gamma": .983, "entropy": .013, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 6 Bowser
    {"alpha": .38, "gamma": .986, "entropy": .009, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 7 Peach
    {"alpha": .42, "gamma": .988, "entropy": .006, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 8 Toad
    {"alpha": .46, "gamma": .990, "entropy": .004, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000},  # 9 Parabones
]

BLUE_R5 = {"alpha": .20, "gamma": .98, "eps_start": 0, "eps_end": 0, "eps_episodes": 4000}



def red_params(level, round_id=None):
    """Resolved CPU profile for a character and arena.

    Arena-specific values override the generic learning profile without leaking
    into the other rounds.
    """
    idx = max(0, min(len(RED_MODELS) - 1, int(round(level))))
    raw = RED_MODELS[idx]
    resolved = {k: v for k, v in raw.items() if k != "r2"}
    if round_id == 2:
        resolved.update(raw["r2"])
    elif round_id == 3:
        resolved.update(R3_LADDER[idx])
    elif round_id == 4:
        resolved.update(R4_LADDER[idx])
    elif round_id == 5:
        resolved.update(R5_LADDER[idx])
    return resolved



def blue_params(round_id=None):
    """Resolve the user model's safe per-arena starting profile."""
    resolved = {k: v for k, v in BLUE_MODEL.items() if k != "r2"}
    if round_id == 2:
        resolved.update(BLUE_MODEL["r2"])
    elif round_id == 4:
        resolved.update(BLUE_R4)
    elif round_id == 5:
        resolved.update(BLUE_R5)
    return resolved
