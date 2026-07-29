"""Tournament flow (a Match mixin): rounds, matchups, resets and the award.

Navigating rounds is FREE (prev/next/set_round never score); a round's point is
banked only by the explicit award (pressing T), which goes to whichever model
leads the recent contest - re-awarding can never double-score. Also here: the
menu loadouts (each side's per-round algorithm picks), the CPU character tier,
and the world/model reset controls.
"""

from core import registry
from core.registry import (ALGORITHMS, ROUND_ALGO_FAMILIES,
                           is_dp, is_deep, is_dqn, is_pg)


class RoundFlowMixin:
    """Round navigation, matchup resolution, awards, and contest resets."""

    # --------------------------------------------------------------- controls
    def regenerate(self, seed=None):
        """Install a newly-seeded world and wipe both models (New World control).

        With no explicit seed, advance the current training seed so repeated
        ``New World`` clicks produce different but reproducible layouts.  An
        explicit seed remains an exact replay mechanism.
        """
        with self.lock:
            if seed is None:
                seed = 1 if self.train_seed is None else int(self.train_seed) + 1
            else:
                seed = int(seed)
            self.train_seed = seed
            if self._is_round4_missile():
                self.delete_checkpoint()
                # Regeneration is also an explicit learning wipe.  This reset only
                # reseeds/clears the live arena before _new_episode resets it again,
                # so it must not briefly reuse the discarded model's curriculum.
                set_curriculum_episode = getattr(
                    self.env, "set_curriculum_episode", None)
                if set_curriculum_episode is not None:
                    set_curriculum_episode(0)
            self.env.reset(seed=seed, regenerate=True)
            self.world_version += 1
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def reset_models(self):
        """Wipe learning, KEEP the current world."""
        with self.lock:
            if self._is_round4_missile():
                self.delete_checkpoint()
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def reset_tournament(self):
        """Start a fresh tournament from round 1 and clear all stage points."""
        with self.lock:
            first = registry.ROUNDS[0] if registry.ROUNDS else self.round_id
            self.set_round(first, keep_score=False)

    def set_cpu_tier(self, tier, level=None, force=False):
        """Set the CPU (Red) difficulty from the chosen character. ``tier`` (1..5) is the
        display tier; ``level`` (0..9) picks the PER-CHARACTER hyperparameter model in
        RED_MODELS that actually drives Red's strength (defaults from the tier if not
        given). Rebuilds Red and restarts fresh; no-op if unchanged, so the frontend can
        send it freely on start. ``force`` deliberately restores the character's
        profile even when the same character was already selected (new tournament)."""
        with self.lock:
            t = max(1, min(5, int(tier)))
            lv = int(round((t - 1) / 4.0 * 9)) if level is None else max(0, min(9, int(round(level))))
            if not force and t == self.red_tier and lv == self.red_level:
                return
            self.red_tier = t
            self.red_level = lv
            self._red_from_tier()              # a new opponent resets any manual override
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def set_side_algo(self, side, algo):
        with self.lock:
            valid = algo in ALGORITHMS or is_dp(algo) or is_deep(algo)
            if not valid or algo not in ROUND_ALGO_FAMILIES.get(
                    self.round_id, set()):
                return
            if side == "red":
                self.algo_red = algo
            elif side == "blue":
                self.algo_blue = algo
            self._build_agents()
            self.finish_event = None
            self._reset_stats()
            self._new_episode()

    def _algo_for_env(self, algo, default):
        """Accept a per-round override only if it exists AND fits this round's env
        kind (deep on the continuous arenas; tabular / DP on the grids). Else
        fall back to the round default, so a mismatched pick can never build the
        wrong agent for the env."""
        if not algo:
            return default
        ok = algo in ROUND_ALGO_FAMILIES.get(self.round_id, set())
        return algo if ok else default

    def _round_matchup(self, round_id):
        """(red, blue) for a round: the menu loadouts if set + compatible, else the
        ROUND_ALGOS defaults. Red = CPU character's algo, Blue = player's card pick."""
        dr, db = registry.round_algos(round_id)
        return (self._algo_for_env(self.cpu_algos.get(round_id), dr),
                self._algo_for_env(self.player_algos.get(round_id), db))

    def set_loadouts(self, cpu=None, player=None):
        """Install the menu's per-round algorithm picks (lists in round order, index
        0 = first round): cpu = the chosen CPU character's algo per round (Red),
        player = the card picks per round (Blue). Re-applies to the current round."""
        with self.lock:
            order = registry.ROUNDS

            def build(lst):
                d = {}
                if isinstance(lst, (list, tuple)):
                    for i, key in enumerate(lst):
                        if i < len(order) and key:
                            d[order[i]] = key
                return d

            self.cpu_algos = build(cpu)
            self.player_algos = build(player)
            self.algo_red, self.algo_blue = self._round_matchup(self.round_id)
            self._build_agents()
            self._reset_stats()
            self._new_episode()

    def set_round(self, round_id, keep_score=True):
        """Switch to a round: install its world + its matchup + reset learning.
        Tournament score is preserved unless told otherwise."""
        with self.lock:
            # Preserve the model being left before replacing its env/agents.
            self.save_checkpoint(force=True)
            self.round_id = round_id
            self.env = self._make_env(round_id)   # rebuild: round may switch env class
            self._apply_env_config()              # carry dynamics/slip/step-cap across
            self.world_version += 1
            self.algo_red, self.algo_blue = self._round_matchup(round_id)
            # Manual tuning belongs to the arena where it was entered. Switching
            # arenas reinstalls each algorithm's validated starting profile.
            self._blue_from_round()
            self._red_from_tier()
            if not keep_score:
                self.score = {"red": 0, "blue": 0}
                self.awarded_rounds.clear()
                self.round_results = {}
                self.last_award = None
            self.finish_event = None
            self._build_agents()
            self._reset_stats()
            self._load_checkpoint()
            self._new_episode()

    def prev_round(self):
        """Step back to the previous round (navigation only; leaves the score as-is)."""
        with self.lock:
            order = registry.ROUNDS
            i = order.index(self.round_id) if self.round_id in order else 0
            self.set_round(order[(i - 1) % len(order)], keep_score=True)

    def next_round(self):
        """Advance to the next round (wraps). Navigation only: it does NOT score.

        A point is awarded ONLY when the stage is finished with T (award_round).
        Moving between stages is free and leaves the tournament score untouched -
        if the current round was resolved with T its point is already banked, and
        if it wasn't, skipping past it gives nobody a point."""
        with self.lock:
            order = registry.ROUNDS
            i = order.index(self.round_id) if self.round_id in order else 0
            self.set_round(order[(i + 1) % len(order)], keep_score=True)

    def award_round(self):
        """Finish the current stage INSTANTLY (no waiting for the next live finish).

        The point goes to whichever model has more RECENT wins; a tie is a genuine
        draw - no point, no winner, and the ceremony won't zoom on a character. The
        round is marked resolved either way so a following Next can never re-score it.
        """
        with self.lock:
            # already resolved this round? re-show the same result, never double-score.
            if self.round_id in self.awarded_rounds and self.last_award \
                    and self.last_award.get("roundId") == self.round_id:
                return dict(self.last_award)
            # nothing has been contested yet (no episode finished) -> don't lock the
            # round as a no-op draw; let the user press T again once there's a result.
            if not self.recent and self.round_id not in self.awarded_rounds:
                return {"winner": None, "awarded": False, "pending": True,
                        "roundId": self.round_id, "score": dict(self.score)}
            award = self._award_current_round()   # winner=recent leader (or the banked one), None on a tie
            self.awarded_rounds.add(self.round_id)                  # resolved (a draw counts as resolved too)
            focus = award.get("winner")
            frame = self._ceremony_frame(focus)                    # focus=None (draw) -> no character moved
            self.finish_serial += 1
            self.finish_event = {
                "serial": self.finish_serial,
                "awardSerial": award.get("serial"),
                "roundId": self.round_id,
                "roundIndex": award.get("roundIndex", 0),
                "roundTotal": award.get("roundTotal", len(registry.ROUNDS)),
                "title": award.get("title", ""),
                "winner": focus if focus in ("red", "blue") else None,
                "episodeWinner": None,
                "awarded": award.get("awarded", False),
                "score": dict(self.score),
                "award": dict(award),
                "frame": frame,
                "labelRed": award.get("labelRed", self.algo_red),
                "labelBlue": award.get("labelBlue", self.algo_blue),
            }
            return dict(award)

    def _award_current_round(self):
        recent = list(self.recent)
        red_wins = recent.count("red")
        blue_wins = recent.count("blue")
        draw_wins = recent.count("draw")
        meta = self._matchup()
        idx = meta.get("index", 0)
        already = self.round_id in self.awarded_rounds

        if already:
            # the round is banked - re-show the STORED winner (from round_results),
            # never recompute from the since-reset recent window and never re-score.
            # This is what stops a re-award (after navigating away and back) from
            # announcing a different winner than the one actually banked.
            banked = self.round_results.get(idx)
            winner = banked if banked in ("red", "blue") else None
        else:
            winner = ("red" if red_wins > blue_wins
                      else "blue" if blue_wins > red_wins
                      else None)
            if winner:
                self.score[winner] += 1
                self.awarded_rounds.add(self.round_id)
            # record who took THIS round (draw included) for the header dots
            self.round_results[idx] = winner if winner in ("red", "blue") else "draw"

        self.award_serial += 1
        self.last_award = {
            "serial": self.award_serial,
            "source": "official",
            "roundId": self.round_id,
            "roundIndex": idx,
            "roundTotal": meta.get("total", len(registry.ROUNDS)),
            "title": meta.get("title", ""),
            "winner": winner,
            "awarded": bool(winner and not already),
            "already": already,
            "pending": False,
            "recent": {"red": red_wins, "blue": blue_wins, "draw": draw_wins},
            "score": dict(self.score),
            "labelRed": meta.get("labelRed", self.algo_red),
            "labelBlue": meta.get("labelBlue", self.algo_blue),
        }
        return dict(self.last_award)

    # ------------------------------------------------------------- inspection
    def _matchup(self):
        # round_meta carries the ROUND_ALGOS DEFAULTS; overwrite the algo labels with
        # the LIVE agents so the briefing / HUD / award reflect the actual matchup
        # (the chosen character's algo for Red, the player's card pick for Blue), not
        # the round default. World identity (theme / title / index) stays from meta.
        m = dict(registry.round_meta(self.round_id))
        lr = registry.ALGO_LABELS.get(self.algo_red, self.algo_red)
        lb = registry.ALGO_LABELS.get(self.algo_blue, self.algo_blue)
        m["algoRed"], m["algoBlue"] = self.algo_red, self.algo_blue
        m["labelRed"], m["labelBlue"] = lr, lb
        # Blue (the player's model) reads on the LEFT, matching the HUD, the panel
        # header and the Head-to-head table (all Blue-left / Red-right).
        m["matchup"] = f"{lb} vs {lr}"
        return m

    def _family(self):
        a = self.algo_blue
        if is_dp(a):
            return "Dynamic Programming"
        if is_pg(a):
            return "Policy Gradient (policy-based)"
        if is_dqn(a):
            return "Deep RL (function approximation)"
        if a in ("monte_carlo", "first_visit_mc"):
            return "Monte-Carlo"
        return "Temporal-Difference"
