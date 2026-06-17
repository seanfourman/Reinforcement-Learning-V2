"""Offline smoke-tester for the live RL stack (no longer the app's data source).

Proves the env + agents actually LEARN: across episodes the games become decisive
and shorter (random play times out; learned play escapes quickly). Run for each
algorithm so a regression in any update rule shows up.

Run:  python3 train.py            (all algorithms, a few worlds each)
      python3 train.py --quick    (one algorithm, one world)
"""

import sys

from match import Match
from agents import ALGORITHMS


def run(algo, seed, episodes):
    m = Match(seed=seed, round_id=1)
    m.algo_red = m.algo_blue = algo      # both sides run the algorithm under test
    m.reset_models()
    # measure a baseline window (still mostly exploring) vs a trained window
    early_lens, early_dec = [], 0
    late_lens, late_dec = [], 0
    target = episodes
    while m.episode < target:
        done = m.tick()
        if done:
            w = m.recent[-1]
            ln = m.ep_lengths[-1]
            if m.episode <= target * 0.1:
                early_lens.append(ln)
                early_dec += (w != "draw")
            elif m.episode >= target * 0.9:
                late_lens.append(ln)
                late_dec += (w != "draw")
    early_avg = sum(early_lens) / len(early_lens) if early_lens else 0
    late_avg = sum(late_lens) / len(late_lens) if late_lens else 0
    early_rate = early_dec / len(early_lens) if early_lens else 0
    late_rate = late_dec / len(late_lens) if late_lens else 0
    st = m.stats()
    print(f"  {algo:<15} seed {seed}: "
          f"len {early_avg:5.0f} -> {late_avg:5.0f}  "
          f"decisive {early_rate:4.0%} -> {late_rate:4.0%}  "
          f"qstates r/b {st['qStates']['red']}/{st['qStates']['blue']}  "
          f"wins {st['wins']}")
    return late_avg, late_rate


def main():
    quick = "--quick" in sys.argv
    if quick:
        print("quick smoke test (q-learning, 1 world, 4000 episodes):")
        run("qlearning", seed=1, episodes=4000)
        return
    print("learning smoke test — episode length should DROP and decisive% should RISE:\n")
    for algo in ALGORITHMS:
        for seed in (1, 2):
            run(algo, seed=seed, episodes=5000)
        print()


if __name__ == "__main__":
    main()
