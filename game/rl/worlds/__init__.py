"""Per-round themed worlds.

Each round module exposes ``generate(seed=None) -> World`` and the metadata
constants ``THEME`` / ``ROUND_ID`` / ``TITLE``. ``ROUNDS`` is the tournament
running order; the tournament manager walks it. All five rounds are registered.
"""

from .grid import (  # re-exported for convenience / back-compat
    World, validate, SIZE, ORTHO,
    WALL, FLOOR, ESCAPE, RED_KEY, BLUE_KEY, RED_DOOR, BLUE_DOOR,
    GOLD_HOME, RED_SPAWN, BLUE_SPAWN, GOLD_TRAP,
)
from . import peach
from . import city
from . import fossilfalls
from . import ruined
from . import tostarena

# round_id -> module (must expose THEME / ROUND_ID / TITLE; grid rounds also
# expose generate(). A module flagged CONTINUOUS=True has no grid World - its
# env is continuous: match.py calls the module's make_env() if it defines one,
# else builds rl/continuous.ContinuousArena directly.)
ROUND_MODULES = {
    1: peach,
    2: city,
    3: fossilfalls,
    4: ruined,
    5: tostarena,
}
# tournament running order
ROUNDS = [1, 2, 3, 4, 5]

# default head-to-head matchup per round (Red algo, Blue algo). Panel-overridable.
ROUND_ALGOS = {
    1: ("value_iteration", "policy_iteration"),
    2: ("sarsa", "qlearning"),         # the hedge maze: on-policy vs off-policy
    3: ("qlearning", "monte_carlo"),   # falls: TD bootstrapping vs episodic returns
    4: ("dqn", "double_dqn"),          # ruins: function approximation, off-policy NN
    5: ("dqn", "dueling_dqn"),         # desert rally: the value/advantage head split
}

# human-readable algorithm names (for the HUD matchup label)
ALGO_LABELS = {
    "value_iteration": "Value Iteration",
    "policy_iteration": "Policy Iteration",
    "qlearning": "Q-Learning",
    "sarsa": "SARSA",
    "expected_sarsa": "Expected-SARSA",
    "monte_carlo": "Monte-Carlo",
    "dqn": "DQN",
    "double_dqn": "Double-DQN",
    "dueling_dqn": "Dueling-DQN",
}


def make_world(round_id=1, seed=None):
    mod = ROUND_MODULES.get(round_id, peach)
    return mod.generate(seed)


def round_algos(round_id):
    return ROUND_ALGOS.get(round_id, ("qlearning", "qlearning"))


def round_meta(round_id):
    mod = ROUND_MODULES.get(round_id, peach)
    ar, ab = round_algos(round_id)
    return {
        "roundId": mod.ROUND_ID, "theme": mod.THEME, "title": mod.TITLE,
        "index": ROUNDS.index(round_id) if round_id in ROUNDS else 0,
        "total": len(ROUNDS),
        "algoRed": ar, "algoBlue": ab,
        "labelRed": ALGO_LABELS.get(ar, ar), "labelBlue": ALGO_LABELS.get(ab, ab),
        "matchup": f"{ALGO_LABELS.get(ar, ar)} vs {ALGO_LABELS.get(ab, ab)}",
    }
