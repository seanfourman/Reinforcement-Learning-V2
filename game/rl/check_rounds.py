"""Headless regression check for all 5 rounds - run after any engine change.

For each round it builds the match, runs the episode loop (so win / lose / draw /
timeout all fire), calls every read API the server exposes, exercises the live
control commands, and checks the T-award / navigation scoring rules. It asserts
nothing throws and the outputs are sane, then prints PASS / FAIL.

Run:  python check_rounds.py         (all 5 rounds)
Rounds 4-5 need PyTorch (the DQN rounds); if torch is missing they are SKIPPED
with a note rather than failing, so the tabular rounds still get checked.

Exit code 0 = all good, 1 = something broke. Pair with ``python train.py`` (which
checks that the tabular agents actually LEARN, not just that they run).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from match import Match   # noqa: E402


def read_all(m):
    """Call every read endpoint the server exposes; a throw here fails the check."""
    m.snapshot(); m.snapshot(include_world=True); m.world_json(); m.stats()
    m.history(); m.mdp_spec(); m.reward_decomp(); m.q_probe_series()
    m.policy_agreement(); m.all_worlds()
    for ag in ("red", "blue"):
        m.value_grid(ag); m.q_grid(ag); m.policy_grid(ag); m.visit_grid(ag)
        m.visit_stats(ag); m.replays_index(ag); m.arena_field(ag); m.va_probe(ag)
        m.dp_report(ag); m.dp_sweeps(ag)
        m.replay("last", ag, 0); m.replay("best", ag, 0)
    if getattr(m.env, "objective", "") != "arena":
        for (r, c) in ((0, 0), (m.env.H // 2, m.env.W // 2)):
            m.q_at("red", r, c); m.q_at("blue", r, c)


def controls(m):
    """Exercise the live control commands the panel sends."""
    m.set_params({"alpha": 0.3, "gamma": 0.95, "epsStart": 0.9, "epsEnd": 0.02,
                  "epsEpisodes": 1500, "maxSteps": 300})
    m.set_params({"slip": 0.3, "dpTheta": 1e-4, "dpMaxIters": 500})
    m.set_params({"dqnBatch": 32, "dqnWarmup": 200, "dqnTargetSync": 100,
                  "thrust": 14, "drag": 0.88, "speedCap": 8,
                  "obstacleCount": 6, "tornadoCount": 3, "quicksandCount": 4, "trainSeed": 7})
    m.set_red_params({"alpha": 0.25, "gamma": 0.9})
    m.set_cpu_tier(3)
    m.regenerate(); m.reset_models()


def scoring_rules(m, rid):
    """T awards a point to the recent leader; navigation must NEVER score."""
    # run until one side leads (or give up - a symmetric round may only ever draw)
    for _ in range(4000):
        m.tick()
        rr = m.stats()["recentRate"]
        if abs(rr["red"] - rr["blue"]) >= 0.15:
            break
    before = dict(m.stats()["score"])
    m.next_round(); m.prev_round()                    # navigate away and back
    after_nav = dict(m.stats()["score"])
    assert after_nav == before, f"R{rid}: navigation changed the score {before} -> {after_nav}"
    total_before = before["red"] + before["blue"]
    m.award_round()                                   # press T
    total_after = m.stats()["score"]["red"] + m.stats()["score"]["blue"]
    assert total_after - total_before in (0, 1), f"R{rid}: T changed score by {total_after - total_before}"


def check_round(rid):
    m = Match(seed=1, round_id=rid)
    grid = getattr(m.env, "objective", "") != "arena"
    for _ in range(2500 if grid else 400):
        m.tick()
    s = m.stats()
    matchup, outcomes = s["round"]["matchup"], dict(s["outcomes"])   # capture BEFORE resets
    read_all(m)
    controls(m)                       # regenerate / reset_models reset the stats
    for _ in range(300 if grid else 60):
        m.tick()
    read_all(m)
    scoring_rules(m, rid)             # navigation's set_round resets stats too
    print(f"  R{rid} PASS  {matchup:<32} episodes+outcomes(pre-reset)={outcomes}")


def main():
    ok, skipped = True, []
    for rid in (1, 2, 3, 4, 5):
        try:
            check_round(rid)
        except ImportError as e:               # torch missing -> DQN rounds skip
            skipped.append(rid)
            print(f"  R{rid} SKIP  (missing dependency: {e})")
        except Exception as e:                 # any real failure
            ok = False
            import traceback
            print(f"  R{rid} FAIL  {type(e).__name__}: {e}")
            traceback.print_exc()
    print()
    if ok:
        note = f" ({len(skipped)} skipped: {skipped})" if skipped else ""
        print(f"ALL ROUND CHECKS PASSED{note}")
    else:
        print("SOME CHECKS FAILED - see the traceback(s) above")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
