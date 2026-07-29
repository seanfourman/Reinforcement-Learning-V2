"""The tournament registry: every round -> module and algorithm name -> class
mapping in ONE place.

Two kinds of lookups live here:

  * the ROUND registry - round id -> world module (ROUND_MODULES), the running
    order (ROUNDS), each round's default matchup (ROUND_ALGOS), and the
    metadata helpers (make_world / round_algos / round_meta);
  * the ALGORITHM registry - algorithm string name -> class, plus the
    family predicates (is_dp / is_dqn / is_pg) and factories.

The browser selects rounds and algorithms by these STRING names (through
/api/control), so the names are part of the frozen serve.py <-> browser
contract:

    value_iteration, policy_iteration          (R1, Dynamic Programming)
    monte_carlo, first_visit_mc                (R2, Monte Carlo)
    sarsa, qlearning, expected_sarsa           (R3, Temporal Difference)
    dqn, double_dqn, dueling_dqn               (R4, deep value-based)
    reinforce, actor_critic, ppo               (R5, policy gradient)

The tabular and DP families are imported eagerly (standard library + numpy
only). The DEEP families (R4/R5) need PyTorch, so their factories import
lazily, inside the function body: the server still boots and runs the tabular
rounds on a Python without torch installed - only building a deep agent
requires it. The name TUPLES and predicates below are plain membership tests,
so validation / family labels also work without importing torch.
"""

from arenas.r1_peach_castle import world as r1_world
from arenas.r2_new_donk_city import world as r2_world
from arenas.r3_fossil_falls import world as r3_world
from arenas.r4_ruined_kingdom import world as r4_world
from arenas.r5_tostarena import world as r5_world
from arenas.r1_peach_castle.env import PeachCastleEnv
from arenas.r2_new_donk_city.env import NewDonkCityEnv
from arenas.r3_fossil_falls.env import FossilFallsEnv
from arenas.r4_ruined_kingdom.arena import MissileArena
from arenas.r5_tostarena.arena import CtfArena
from arenas.r1_peach_castle.value_iteration import ValueIteration
from arenas.r1_peach_castle.policy_iteration import PolicyIteration
from arenas.r2_new_donk_city.monte_carlo import MonteCarlo
from arenas.r2_new_donk_city.first_visit_mc import FirstVisitMonteCarlo
from arenas.r3_fossil_falls.qlearning import QLearning
from arenas.r3_fossil_falls.sarsa import Sarsa
from arenas.r3_fossil_falls.expected_sarsa import ExpectedSarsa

# ------------------------------------------------------------------- rounds
# round_id -> world module (must expose THEME / ROUND_ID / TITLE; grid rounds also
# expose generate(). A module flagged CONTINUOUS=True has no grid World - its
# env is continuous: the tournament builds the shared continuous arena directly.)
ROUND_MODULES = {
    1: r1_world,
    2: r2_world,
    3: r3_world,
    4: r4_world,
    5: r5_world,
}
# tournament running order
ROUNDS = [1, 2, 3, 4, 5]

# default head-to-head matchup per round (Red algo, Blue algo). Panel-overridable.
ROUND_ALGOS = {
    1: ("value_iteration", "policy_iteration"),  # castle: DP - the model-known maze race
    2: ("monte_carlo", "first_visit_mc"),   # city: every-visit vs first-visit MC
    3: ("sarsa", "qlearning"),         # falls: on-policy vs off-policy TD
    4: ("dqn", "double_dqn"),          # ruins: deep VALUE - function approximation
    5: ("actor_critic", "ppo"),        # desert rally: deep POLICY - policy gradient
}

# human-readable algorithm names (for the HUD matchup label)
ALGO_LABELS = {
    "value_iteration": "Value Iteration",
    "policy_iteration": "Policy Iteration",
    "qlearning": "Q-Learning",
    "sarsa": "SARSA",
    "expected_sarsa": "Expected-SARSA",
    "monte_carlo": "Every-visit MC",
    "first_visit_mc": "First-visit MC",
    "dqn": "DQN",
    "double_dqn": "Double-DQN",
    "dueling_dqn": "Dueling-DQN",
    "reinforce": "REINFORCE",
    "actor_critic": "Actor-Critic",
    "ppo": "PPO",
}


def make_world(round_id=1, seed=None, **cfg):
    """Build a grid round's ``World`` via its arena's generator."""
    mod = ROUND_MODULES.get(round_id, r1_world)
    return mod.generate(seed, **cfg)


# round id -> that grid round's env subclass (the continuous rounds 4/5 use the
# shared continuous arena instead; the tournament checks the module's CONTINUOUS flag)
GRID_ENVS = {
    1: PeachCastleEnv,
    2: NewDonkCityEnv,
    3: FossilFallsEnv,
}


def make_grid_env(round_id, seed):
    """Build a grid round's live environment (its arena env over the engine)."""
    cls = GRID_ENVS.get(round_id, PeachCastleEnv)
    return cls(seed, round_id=round_id)


# round id -> that continuous round's arena subclass
CONTINUOUS_ENVS = {
    4: MissileArena,
    5: CtfArena,
}


def make_continuous_env(round_id, seed, theme):
    """Build a continuous round's live arena (its subclass over the engine)."""
    cls = CONTINUOUS_ENVS.get(round_id, MissileArena)
    return cls(seed, round_id=round_id, theme=theme)


def round_algos(round_id):
    """The (red, blue) default algorithm names for a round."""
    return ROUND_ALGOS.get(round_id, ("qlearning", "qlearning"))


def round_meta(round_id):
    """Round metadata for the HUD / briefing: title, theme, matchup labels."""
    mod = ROUND_MODULES.get(round_id, r1_world)
    ar, ab = round_algos(round_id)
    return {
        "roundId": mod.ROUND_ID, "theme": mod.THEME, "title": mod.TITLE,
        "index": ROUNDS.index(round_id) if round_id in ROUNDS else 0,
        "total": len(ROUNDS),
        "algoRed": ar, "algoBlue": ab,
        "labelRed": ALGO_LABELS.get(ar, ar), "labelBlue": ALGO_LABELS.get(ab, ab),
        "matchup": f"{ALGO_LABELS.get(ar, ar)} vs {ALGO_LABELS.get(ab, ab)}",
    }


# ---------------------------------------------------------------- tabular (R2/R3)
ALGORITHMS = {
    "qlearning": QLearning,
    "sarsa": Sarsa,
    "expected_sarsa": ExpectedSarsa,
    "monte_carlo": MonteCarlo,
    "first_visit_mc": FirstVisitMonteCarlo,
}


def make_agent(algo="qlearning", **kwargs):
    """Build a tabular learner by name (defaults to Q-Learning)."""
    cls = ALGORITHMS.get(algo, QLearning)
    return cls(**kwargs)


# ---------------------------------------------------------- Dynamic Programming (R1)
DP_ALGORITHMS = {
    "value_iteration": ValueIteration,
    "policy_iteration": PolicyIteration,
}


def is_dp(algo):
    return algo in DP_ALGORITHMS


def make_dp(algo, env, agent, **kwargs):
    """Build a DP planner by name over the (model-known) env."""
    cls = DP_ALGORITHMS.get(algo, ValueIteration)
    return cls(env, agent, **kwargs)


# ------------------------------------------------------------------ deep (R4/R5)
DQN_ALGOS = ("dqn", "double_dqn", "dueling_dqn")
PG_ALGOS = ("reinforce", "actor_critic", "ppo")

# which algorithm names FIT each round's env kind (used to validate the panel's
# algorithm switches and the menu loadouts, so a mismatched pick can never
# build the wrong agent for the env)
ROUND_ALGO_FAMILIES = {
    1: {"value_iteration", "policy_iteration"},
    2: {"monte_carlo", "first_visit_mc"},
    3: {"qlearning", "sarsa", "expected_sarsa"},
    4: set(DQN_ALGOS),
    5: set(PG_ALGOS),
}


def is_dqn(algo):
    return algo in DQN_ALGOS


def is_pg(algo):
    return algo in PG_ALGOS


def is_deep(algo):
    return is_dqn(algo) or is_pg(algo)


def make_dqn(algo, obs_dim, n_actions, **kwargs):
    """Build a DQN-family agent by name. Imports torch lazily (first deep build)."""
    from arenas.r4_ruined_kingdom.dqn import DQNAgent
    from arenas.r4_ruined_kingdom.double_dqn import DoubleDQNAgent
    from arenas.r4_ruined_kingdom.dueling_dqn import DuelingDQNAgent
    classes = {"dqn": DQNAgent, "double_dqn": DoubleDQNAgent,
               "dueling_dqn": DuelingDQNAgent}
    cls = classes.get(algo, DQNAgent)
    return cls(obs_dim=obs_dim, n_actions=n_actions, **kwargs)


def make_pg(algo, obs_dim, n_actions, **kwargs):
    """Build a policy-gradient agent by name. Imports torch lazily."""
    from arenas.r5_tostarena.reinforce import REINFORCE
    from arenas.r5_tostarena.actor_critic import ActorCritic
    from arenas.r5_tostarena.ppo import PPO
    classes = {"reinforce": REINFORCE, "actor_critic": ActorCritic, "ppo": PPO}
    cls = classes.get(algo, REINFORCE)
    return cls(obs_dim=obs_dim, n_actions=n_actions, **kwargs)
