"""The algorithm registry: every name -> class mapping in ONE place.

The browser selects algorithms by their STRING names (through /api/control),
so these names are part of the frozen serve.py <-> browser contract:

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

from arenas.r1_peach_castle.value_iteration import ValueIteration
from arenas.r1_peach_castle.policy_iteration import PolicyIteration
from arenas.r2_new_donk_city.monte_carlo import MonteCarlo
from arenas.r2_new_donk_city.first_visit_mc import FirstVisitMonteCarlo
from arenas.r3_fossil_falls.qlearning import QLearning
from arenas.r3_fossil_falls.sarsa import Sarsa
from arenas.r3_fossil_falls.expected_sarsa import ExpectedSarsa

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
