"""Self-play tabular Q-learning for the two competing agents.

Two independent Q-tables (one per agent) learn at the same time; from each
agent's point of view the rival is just part of the world. Pure standard
library — the Q-tables are plain dicts, saved with pickle. Both agents come
out PRE-TRAINED: training happens here, offline, and the demo later just loads
the frozen tables.

Run:  python3 train.py            (full training)
      python3 train.py --quick    (short run, to smoke-test)
"""

import os
import pickle
import json
import random
import sys

from env import GridWorld, N_ACTIONS, REGION_ARENA

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(HERE, "models")

# --- hyperparameters --------------------------------------------------------
EPISODES = 200_000
ALPHA = 0.2          # learning rate
GAMMA = 0.98         # discount (longer maze horizon needs reward to reach back further)
EPS_START = 1.0      # exploration: linear decay to EPS_END over EPS_FRAC
EPS_END = 0.08
EPS_FRAC = 0.8       # ...of training, then held at EPS_END
SEED = 12345         # fixed: training is reproducible run-to-run

# Self-play wobbles late (the two agents co-adapt and can drift into a
# lopsided, draw-prone equilibrium), so we don't ship the final snapshot.
# Every EVAL_EVERY episodes we score the current pair on a batch of near-greedy
# games and keep the checkpoint where the contest is best: few draws, evenly
# matched, and short. That frozen pair is what the demo plays back.
EVAL_EVERY = 3_000
EVAL_GAMES = 500
EVAL_EPS = 0.08


def make_q():
    return {}


def q_row(table, state):
    row = table.get(state)
    if row is None:
        row = [0.0] * N_ACTIONS
        table[state] = row
    return row


def greedy(table, state):
    row = q_row(table, state)
    best, best_a = row[0], 0
    for a in range(1, N_ACTIONS):
        if row[a] > best:
            best, best_a = row[a], a
    return best_a


def eps_greedy(table, state, eps, rng):
    if rng.random() < eps:
        return rng.randrange(N_ACTIONS)
    return greedy(table, state)


def epsilon(ep):
    frac = ep / (EPISODES * EPS_FRAC)
    if frac >= 1.0:
        return EPS_END
    return EPS_START + (EPS_END - EPS_START) * frac


def copy_q(table):
    return {k: v[:] for k, v in table.items()}


def evaluate(env, Q, games, eps, rng):
    """Play `games` near-greedy games WITHOUT learning; report contest stats."""
    res = {"red": 0, "blue": 0, "draw": 0}
    length = 0
    for _ in range(games):
        s_red, s_blue = env.reset()
        done = False
        while not done:
            a_red = eps_greedy(Q["red"], s_red, eps, rng)
            a_blue = eps_greedy(Q["blue"], s_blue, eps, rng)
            (s_red, s_blue), _, done, winner = env.step(a_red, a_blue)
        res[winner if winner else "draw"] += 1
        length += env.steps
    decided = res["red"] + res["blue"]
    draw_frac = res["draw"] / games
    imbalance = abs(res["red"] - res["blue"]) / decided if decided else 1.0
    return draw_frac, imbalance, length / games, res


def greedy_penalty(winner, info):
    """Score the SHIPPED greedy game (lower = better). A non-decisive game is
    ruled out hard; among decisive ones we want a short game where both agents
    were genuinely in the contest (both got keys, both reached the arena, and
    ideally the gold changed hands)."""
    p = 0.0
    if not winner:
        p += 5000              # a deadlock/timeout is never acceptable to ship
    p += info["length"]
    if not info["both_keys"]:
        p += 150               # one agent never even got its key -> not a contest
    if not info["both_arena"]:
        p += 150               # one agent never reached the shared arena
    if info["gold_changes"] == 0:
        p += 25                # a clean uncontested race is ok, but less fun
    return p


def train(episodes=EPISODES, verbose=True):
    rng = random.Random(SEED)
    eval_rng = random.Random(SEED ^ 0xA5A5)
    env = GridWorld()
    Q = {"red": make_q(), "blue": make_q()}

    best = None  # (penalty, Q snapshot, frames, winner, info)

    for ep in range(episodes):
        s_red, s_blue = env.reset()
        eps = epsilon(ep)
        done = False
        while not done:
            a_red = eps_greedy(Q["red"], s_red, eps, rng)
            a_blue = eps_greedy(Q["blue"], s_blue, eps, rng)
            (n_red, n_blue), reward, done, winner = env.step(a_red, a_blue)

            # off-policy Q-learning update for both agents
            for agent, s, a, ns in (("red", s_red, a_red, n_red),
                                    ("blue", s_blue, a_blue, n_blue)):
                row = q_row(Q[agent], s)
                target = reward[agent]
                if not done:
                    nrow = q_row(Q[agent], ns)
                    target += GAMMA * max(nrow)
                row[a] += ALPHA * (target - row[a])

            s_red, s_blue = n_red, n_blue

        if (ep + 1) % EVAL_EVERY == 0:
            # population stats (near-greedy) — for the log only
            draw_frac, imbalance, avg_len, res = evaluate(env, Q, EVAL_GAMES, EVAL_EPS, eval_rng)
            # the actual artifact we'd ship: the pure-greedy game
            frames, gw, info = greedy_rollout(env, Q)
            pen = greedy_penalty(gw, info)
            star = ""
            if best is None or pen < best[0]:
                best = (pen, {"red": copy_q(Q["red"]), "blue": copy_q(Q["blue"])}, frames, gw, info)
                star = "  <- best"
            if verbose:
                tot = EVAL_GAMES
                print(f"ep {ep+1:>7}  eps {eps:4.2f} | pop red {res['red']/tot:4.0%} "
                      f"blue {res['blue']/tot:4.0%} draw {draw_frac:4.0%} | "
                      f"greedy: {gw or 'DRAW':>4} {info['length']:>3}st "
                      f"keys={int(info['both_keys'])} arena={int(info['both_arena'])} "
                      f"steals={info['gold_changes']} pen {pen:6.1f}{star}")

    if verbose and best:
        _, _, _, gw, info = best
        print(f"\nbest greedy game: winner={gw}, {info['length']} steps, "
              f"both_keys={info['both_keys']}, both_arena={info['both_arena']}, "
              f"gold_changes={info['gold_changes']}")
    return env, best


def greedy_rollout(env, Q):
    """Play one fully-greedy episode; record frames + engagement stats."""
    s_red, s_blue = env.reset()
    frames = [snapshot(env)]
    red_arena = blue_arena = False
    gold_changes = 0
    prev_holder = env.gold_holder
    done = False
    winner = None
    while not done:
        a_red = greedy(Q["red"], s_red)
        a_blue = greedy(Q["blue"], s_blue)
        (s_red, s_blue), _, done, winner = env.step(a_red, a_blue)
        frames.append(snapshot(env))
        if env.region_of(*env.red_pos) == REGION_ARENA:
            red_arena = True
        if env.region_of(*env.blue_pos) == REGION_ARENA:
            blue_arena = True
        if env.gold_holder != prev_holder:
            gold_changes += 1
            prev_holder = env.gold_holder
    info = {
        "length": env.steps,
        "both_keys": env.red_key and env.blue_key,
        "both_arena": red_arena and blue_arena,
        "gold_changes": gold_changes,
    }
    return frames, winner, info


def snapshot(env):
    if env.gold_holder is None:
        gold = {"holder": None, "pos": list(env.gold_pos)}
    else:
        gold = {"holder": env.gold_holder, "pos": None}
    return {
        "red": list(env.red_pos),
        "blue": list(env.blue_pos),
        "redKey": env.red_key,
        "blueKey": env.blue_key,
        "gold": gold,
    }


def save(env, Q, frames, winner):
    os.makedirs(MODELS_DIR, exist_ok=True)
    for agent in ("red", "blue"):
        with open(os.path.join(MODELS_DIR, f"qtable_{agent}.pkl"), "wb") as f:
            pickle.dump(Q[agent], f)
    traj = {
        "world": ["".join(row) for row in env.grid],
        "winner": winner,
        "frames": frames,
    }
    with open(os.path.join(HERE, "trajectory.json"), "w") as f:
        json.dump(traj, f)
    print(f"\nsaved: models/qtable_red.pkl, models/qtable_blue.pkl "
          f"({len(Q['red'])}/{len(Q['blue'])} states), trajectory.json")


def main():
    quick = "--quick" in sys.argv
    episodes = 4_000 if quick else EPISODES
    print(f"training self-play Q-learning for {episodes} episodes...")
    env, best = train(episodes)
    _, Q, frames, winner, info = best
    print(f"\nshipping greedy game: winner = {winner}, {len(frames)-1} steps")
    save(env, Q, frames, winner)


if __name__ == "__main__":
    main()
