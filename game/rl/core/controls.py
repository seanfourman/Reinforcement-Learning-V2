"""Live panel controls for the two models (a Match mixin).

``set_params`` is the M panel: Blue's learning knobs (alpha / gamma / epsilon
schedule), the global algorithm internals (DP theta + sweeps, the per-side DQN
internals, the PG knobs) and the world dynamics dials, each applied at the
right depth (live attribute push, agent rebuild, or full scene rebuild).
``set_red_params`` mirrors it for the locked CPU panel; ``params`` /
``red_view`` echo the current values back to the browser.
"""

from core.registry import is_dp, is_pg



def _int_or_none(v, lo=0, hi=10 ** 9):
    """Coerce a panel value to a clamped int, or None. The panel sends -1 (or an
    empty/None value) to mean 'use the built-in default' for the optional knobs
    (hazard counts, train seed)."""
    if v is None:
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return max(lo, min(hi, n))


class ControlsMixin:
    """Panel parameter controls + their read-back views."""

    def set_params(self, p):
        """Update tunable settings live from the panel. Three tiers:
          * per-side LEARNING (alpha / gamma / epsilon schedule) -> OUR model, Blue;
          * GLOBAL algorithm internals (DP theta+sweeps, DQN batch/buffer/warmup/
            sync/width) -> BOTH agents; buffer+width need an agent rebuild;
          * GLOBAL world dynamics (thrust/drag/speed cap/sand/slip) apply live, and
            structural world knobs (hazard counts, train seed) rebuild the scene.
        Learning knobs apply instantly. Structural changes restart the contest;
        Arena-2 MDP changes also reset its learners so returns are never mixed."""
        with self.lock:
            old_gamma = self.gamma
            need_env_rebuild = False   # scene layout moved (counts / seed)
            need_agent_rebuild = False  # network shape changed (buffer / width)
            replan = False              # GLOBAL DP change: BOTH planners must re-solve
            replan_blue = False         # per-side (Blue's discount / speed): only Blue re-solves
            r4_hearts_reset = False     # a heart-count change needs a fresh episode
            r2_mdp_reset = False        # changed Arena-2 transition/reward function

            # ---- per-side LEARNING (Blue) ----
            if "alpha" in p:
                self.alpha = max(0.0, min(1.0, float(p["alpha"])))
            if "gamma" in p:
                self.gamma = max(0.0, min(1.0, float(p["gamma"])))
            if "epsStart" in p:
                self.eps_start = max(0.0, min(1.0, float(p["epsStart"])))
            if "epsEnd" in p:
                self.eps_end = max(0.0, min(1.0, float(p["epsEnd"])))
            if "epsEpisodes" in p:
                eps_episodes = max(1, int(p["epsEpisodes"]))
                if self._is_round4_missile():
                    self.r4_eps_episodes = eps_episodes
                else:
                    self.eps_episodes = eps_episodes
            if "targetEpisodes" in p:
                t = int(p["targetEpisodes"])
                self.target_episodes = t if t > 0 else None
            if "maxSteps" in p:
                self.max_steps_override = max(50, min(10_000, int(p["maxSteps"])))
                self.env.max_steps = self.max_steps_override

            # ---- GLOBAL: DP internals (both planners re-solve) ----
            if "dpTheta" in p:
                self.dp_theta = max(1e-9, min(1.0, float(p["dpTheta"])))
                replan = True
            if "dpMaxIters" in p:
                self.dp_max_sweeps = max(1, min(100_000, int(p["dpMaxIters"])))
                replan = True

            # ---- Blue's DP planning speed (Bellman sweeps per tick, the race knob) ----
            # Per-side, exactly like set_red_params: it changes only HOW FAST Blue plans,
            # never the solution, so it restarts Blue's own race and leaves Red's untouched.
            if "dpPlanning" in p:
                self.dp_plan_speed = max(0.0, min(10.0, float(p["dpPlanning"])))
                replan_blue = True

            # ---- GLOBAL: Round-1 game mechanics (ice + "?" ghost/freeze blocks) ----
            # Each is pushed onto the env by _apply_env_config below; because the DP
            # planners precompute their transition model (and enumerate a status range),
            # ANY mechanic change means both planners must re-solve from scratch -> replan.
            if "slipProb" in p:
                self.slip_prob = max(0.0, min(0.9, float(p["slipProb"])))
                replan = True
            if "blockGhostProb" in p:
                self.block_ghost_prob = max(0.0, min(1.0, float(p["blockGhostProb"])))
                replan = True
            if "ghostLen" in p:
                self.ghost_len = max(1, min(8, int(p["ghostLen"])))
                replan = True
            if "freezeLen" in p:
                self.freeze_len = max(1, min(8, int(p["freezeLen"])))
                replan = True
            if "coinReward" in p:
                self.coin_reward = max(0.0, min(2.0, float(p["coinReward"])))
                replan = True
            if "blockReward" in p:
                self.block_reward = max(0.0, min(2.0, float(p["blockReward"])))
                replan = True

            # ---- GLOBAL: Round-2 dynamics (the validated seeded layout stays fixed) ----
            if "r2SlipProb" in p:
                value = max(0.0, min(0.9, float(p["r2SlipProb"])))
                r2_mdp_reset |= value != self.r2_slip_prob
                self.r2_slip_prob = value
            if "r3SlipProb" in p:                # Round-3 wet-cell skid chance
                self.r3_slip_prob = max(0.0, min(0.9, float(p["r3SlipProb"])))
                self._apply_env_config()
            if "r3CageReward" in p:              # Round-3 cage grab bonus (catch-up shaping)
                self.cage_reward = max(0.0, min(2.0, float(p["r3CageReward"])))
                self._apply_env_config()
            if "r3CageLen" in p:                 # Round-3 cage freeze duration (turns)
                self.cage_len = int(max(1, min(15, round(float(p["r3CageLen"])))))
                self._apply_env_config()
            if "r2TomatoReward" in p:
                value = max(0.0, min(2.0, float(p["r2TomatoReward"])))
                r2_mdp_reset |= value != self.r2_tomato_reward
                self.r2_tomato_reward = value

            # ---- Round-4 game feel (World card; applied live to the arena) ----
            if "r4MissileSpeed" in p:
                self.r4_missile_speed = max(2.0, min(10.0, float(p["r4MissileSpeed"])))
            if "r4MissileHoming" in p:
                self.r4_missile_homing = max(0.0, min(1.5, float(p["r4MissileHoming"])))
            if "r4HitPenalty" in p:
                self.r4_hit_penalty = max(-5.0, min(-0.1, float(p["r4HitPenalty"])))
            if "r4Hearts" in p:
                self.r4_hearts = max(1, min(9, int(p["r4Hearts"])))
                r4_hearts_reset = True
            if "r4ActionRepeat" in p:
                self.r4_action_repeat = max(1, min(8, int(p["r4ActionRepeat"])))
                if getattr(self.env, "missile_game", False):
                    self.env.action_repeat = self.r4_action_repeat

            # ---- Round-5 Bowser airship (World card; applied live to the arena) ----
            if "r5BowserCount" in p:
                self.r5_bowser_count = max(0, min(6, int(round(float(p["r5BowserCount"])))))
            if "r5BowserSpeed" in p:
                self.r5_bowser_speed = max(1.0, min(14.0, float(p["r5BowserSpeed"])))
            if "r5BowserInterval" in p:
                self.r5_bowser_interval = max(0.5, min(30.0, float(p["r5BowserInterval"])))
            if "r5AgentSight" in p:
                self.r5_agent_sight = max(1.0, min(20.0, float(p["r5AgentSight"])))

            # ---- Round-5 policy-gradient hyperparameters (both sides). Most apply
            # LIVE to the running agents; only the hidden width rebuilds the network. ----
            def _pg_live(attr, value):     # the panel tunes the USER's model (Blue) only
                if hasattr(self.blue, attr):
                    setattr(self.blue, attr, value)
            if "pgEntropy" in p:
                self.pg_entropy = max(0.0, min(0.2, float(p["pgEntropy"])))
                _pg_live("entropy_coef", self.pg_entropy)
            if "pgLambda" in p:
                self.pg_lam = max(0.0, min(1.0, float(p["pgLambda"])))
                _pg_live("lam", self.pg_lam)
            if "pgValueCoef" in p:
                self.pg_value_coef = max(0.0, min(2.0, float(p["pgValueCoef"])))
                _pg_live("value_coef", self.pg_value_coef)
            if "pgHorizon" in p:
                self.pg_horizon = max(8, min(2048, int(p["pgHorizon"])))
                _pg_live("horizon", self.pg_horizon)
            if "pgClip" in p:
                self.pg_clip = max(0.02, min(0.6, float(p["pgClip"])))
                _pg_live("clip", self.pg_clip)
            if "pgEpochs" in p:
                self.pg_epochs = max(1, min(20, int(p["pgEpochs"])))
                _pg_live("epochs", self.pg_epochs)
            if "pgMinibatch" in p:
                self.pg_minibatch = max(8, min(512, int(p["pgMinibatch"])))
                _pg_live("minibatch", self.pg_minibatch)
            if "pgHidden" in p:
                self.pg_hidden = max(16, min(1024, int(p["pgHidden"])))
                need_agent_rebuild = True

            # ---- BLUE's DQN internals (per-side; Red's are in set_red_params) ----
            if "dqnBatch" in p:
                self.dqn_batch = max(1, min(1024, int(p["dqnBatch"])))
            if "dqnWarmup" in p:
                self.dqn_warmup = max(0, int(p["dqnWarmup"]))
            if "dqnTargetSync" in p:
                self.dqn_target_sync = max(1, int(p["dqnTargetSync"]))
            if "dqnBuffer" in p:
                self.dqn_buffer = max(1_000, min(2_000_000, int(p["dqnBuffer"])))
                need_agent_rebuild = True
            if "dqnHidden" in p:
                self.dqn_hidden = max(16, min(1024, int(p["dqnHidden"])))
                need_agent_rebuild = True
            if "dqnLayers" in p:
                self.dqn_layers = max(1, min(6, int(p["dqnLayers"])))
                need_agent_rebuild = True
            if "dqnNstep" in p:
                self.dqn_n_step = max(1, min(10, int(p["dqnNstep"])))
                need_agent_rebuild = True

            # ---- GLOBAL: structural world (rebuild the scene) ----
            if "trainSeed" in p:
                self.train_seed = _int_or_none(p["trainSeed"], lo=0, hi=1000)
                need_env_rebuild = True

            # push live learning-rate / discount onto OUR live agent (Blue) only
            if hasattr(self.blue, "alpha"):
                self.blue.alpha = self.alpha
            if hasattr(self.blue, "gamma"):
                self.blue.gamma = self.gamma
            if hasattr(self.blue, "plan_speed"):          # DP sweeps/tick (Blue), live
                self.blue.plan_speed = self.dp_plan_speed
            # live-settable DQN attrs on BLUE only (buffer/width handled by rebuild;
            # Red's internals are applied in set_red_params)
            if hasattr(self.blue, "batch"):
                self.blue.batch = self.dqn_batch
            if hasattr(self.blue, "warmup"):
                self.blue.warmup = self.dqn_warmup
            if hasattr(self.blue, "target_sync"):
                self.blue.target_sync = self.dqn_target_sync

            if need_env_rebuild:
                self._rebuild_world()
            elif need_agent_rebuild:
                self._apply_env_config()   # keep live env dynamics unchanged
                self._build_agents()
                self._reset_stats()
                self._new_episode()
            elif r2_mdp_reset and self.round_id == 2:
                # Slip probability changes P(s'|s,a), and tomato reward changes
                # R(s,a,s'). Mixing either with old returns/Q fields/replays would
                # no longer describe one MDP, so restart both MC learners cleanly.
                self._apply_env_config()
                self._build_agents()
                self.finish_event = None
                self._reset_stats()
                self._new_episode()
            else:
                space_moved = self._apply_env_config()
                # A ghost/freeze LENGTH change re-sizes the DP state space (the planners
                # re-enumerate below). Without a scene rebuild the episode keeps running, so
                # the in-flight env.status can now sit OUTSIDE the new range (e.g. status 8
                # while ghost_len just dropped to 3) - a state the re-enumerated planner has
                # no V/policy for. Pull each agent's live status back into the new bounds so
                # it stays on a planned state (else policy_action's masked fallback / the Q
                # inspector would hit an un-enumerated successor). Only fires on a genuine
                # length change; slip/coin/prob edits leave the status range untouched.
                if space_moved and hasattr(self.env, "status"):
                    gl, fl = self.env.ghost_len, self.env.freeze_len
                    for a in ("red", "blue"):
                        self.env.status[a] = max(-fl, min(gl, self.env.status[a]))
                # A GLOBAL DP change (theta / max-sweeps / a shared world mechanic) forces
                # BOTH planners to re-solve. A change to Blue's OWN discount or planning
                # speed restarts ONLY Blue's plan (Red's race keeps running), mirroring
                # set_red_params, so tuning one side never disturbs the other's contest.
                if replan:
                    for ag in (self.red, self.blue):
                        if hasattr(ag, "plan_speed"):     # a DP planner
                            ag.theta = self.dp_theta
                            ag.max_sweeps = self.dp_max_sweeps
                            ag.reset_learning()
                elif (replan_blue or self.gamma != old_gamma) and is_dp(self.algo_blue) \
                        and hasattr(self.blue, "plan_speed"):
                    self.blue.reset_learning()
                self._apply_epsilon()
            # A Round-4 heart-count change needs a fresh episode to take effect (the
            # rebuild paths already restart; only the pure-live path needs this).
            if r4_hearts_reset and not need_env_rebuild and not need_agent_rebuild:
                self._new_episode()
            return self.params()

    def params(self):
        # Round-5 policy-gradient hyperparameters: report the values the LIVE Blue
        # agent is actually using (each algo defaults the ones it doesn't use).
        _pg = self.blue if is_pg(self.algo_blue) else None

        def _pgv(attr, default):
            return getattr(_pg, attr, default) if _pg is not None else default
        return {
            "alpha": round(self.alpha, 4),
            "gamma": round(self.gamma, 4),
            "pgHidden": int(_pgv("hidden", self.pg_hidden)),
            "pgEntropy": round(float(_pgv("entropy_coef", 0.01)), 4),
            "pgLambda": round(float(_pgv("lam", 0.95)), 3),
            "pgValueCoef": round(float(_pgv("value_coef", 0.5)), 3),
            "pgHorizon": int(_pgv("horizon", 64)),
            "pgClip": round(float(_pgv("clip", 0.2)), 3),
            "pgEpochs": int(_pgv("epochs", 4)),
            "pgMinibatch": int(_pgv("minibatch", 128)),
            "epsStart": round(self.eps_start, 3),
            "epsEnd": round(self.eps_end, 3),
            "epsEpisodes": self._effective_blue_eps_episodes(),
            "maxSteps": self.env.max_steps,
            "targetEpisodes": self.target_episodes or 0,
            # global algorithm internals
            "dpTheta": self.dp_theta,
            "dpMaxIters": self.dp_max_sweeps,
            "dpPlanning": self.dp_plan_speed,
            # round-1 game mechanics (Peach's Castle)
            "slipProb": round(self.slip_prob, 2),
            "blockGhostProb": round(self.block_ghost_prob, 2),
            "ghostLen": self.ghost_len,
            "freezeLen": self.freeze_len,
            "coinReward": round(self.coin_reward, 2),
            "blockReward": round(self.block_reward, 2),
            "r2SlipProb": round(self.r2_slip_prob, 2),
            "r3SlipProb": round(self.r3_slip_prob, 2),
            "r2TomatoReward": round(self.r2_tomato_reward, 2),
            "r3CageReward": round(self.cage_reward, 2),
            "r3CageLen": int(self.cage_len),
            # round-4 game feel (only shown on R4; safe defaults on other rounds)
            "r4MissileSpeed": round(getattr(self.env, "missile_max_speed", 5.4), 2),
            "r4MissileHoming": round(getattr(self.env, "missile_turn", 0.5), 2),
            "r4Hearts": int(getattr(self.env, "hearts_max", 3)),
            "r4HitPenalty": round(getattr(self.env, "hit_penalty", -2.0), 2),
            "r4ActionRepeat": int(getattr(self.env, "action_repeat", 4)),
            # round-5 airship (only shown on R5; safe defaults on other rounds)
            "r5BowserCount": int(getattr(self.env, "bowser_throw_count", 1)),
            "r5BowserInterval": round(getattr(self.env, "bowser_interval", 2.5), 2),
            "r5BowserSpeed": round(getattr(self.env, "bowser_obj_speed", 10.0), 2),
            "r5AgentSight": round(getattr(self.env, "agent_sight", 6.0), 2),
            "dqnBatch": self.dqn_batch,
            "dqnBuffer": self.dqn_buffer,
            "dqnWarmup": self.dqn_warmup,
            "dqnTargetSync": self.dqn_target_sync,
            "dqnNstep": self.dqn_n_step,
            "dqnHidden": self.dqn_hidden,
            "dqnLayers": self.dqn_layers,
            # reproducibility
            "trainSeed": self.train_seed if self.train_seed is not None else -1,
        }

    def set_red_params(self, p):
        """Manually override the CPU (Red) hyperparameters from the locked N panel.
        Mirrors set_params but targets Red; the shared step cap / episode target are
        NOT here (they go through set_params). Lasts until the tier changes."""
        with self.lock:
            old_gamma = self.red_gamma
            old_plan_speed = self.red_plan_speed
            if "alpha" in p:
                self.red_alpha = max(0.0, min(1.0, float(p["alpha"])))
            if "gamma" in p:
                self.red_gamma = max(0.0, min(1.0, float(p["gamma"])))
            if "epsStart" in p:
                self.red_eps_start = max(0.0, min(1.0, float(p["epsStart"])))
            if "epsEnd" in p:
                self.red_eps_end = max(0.0, min(1.0, float(p["epsEnd"])))
            if "epsEpisodes" in p:
                eps_episodes = max(1, int(p["epsEpisodes"]))
                if self._is_round4_missile():
                    self.r4_red_eps_episodes = eps_episodes
                else:
                    self.red_eps_episodes = eps_episodes
            # Red's PER-SIDE DQN internals. batch/warmup/target-sync apply live;
            # buffer/width/depth need fresh weights -> rebuild.
            if "dqnBatch" in p:
                self.red_dqn_batch = max(1, min(1024, int(p["dqnBatch"])))
            if "dqnWarmup" in p:
                self.red_dqn_warmup = max(0, int(p["dqnWarmup"]))
            if "dqnTargetSync" in p:
                self.red_dqn_target_sync = max(1, int(p["dqnTargetSync"]))
            if hasattr(self.red, "batch"):
                self.red.batch = self.red_dqn_batch
            if hasattr(self.red, "warmup"):
                self.red.warmup = self.red_dqn_warmup
            if hasattr(self.red, "target_sync"):
                self.red.target_sync = self.red_dqn_target_sync
            red_net_change = False
            if "dqnBuffer" in p:
                self.red_dqn_buffer = max(1_000, min(2_000_000, int(p["dqnBuffer"])))
                red_net_change = True
            if "dqnHidden" in p:
                self.red_dqn_hidden = max(16, min(1024, int(p["dqnHidden"])))
                red_net_change = True
            if "dqnLayers" in p:
                self.red_dqn_layers = max(1, min(6, int(p["dqnLayers"])))
                red_net_change = True
            if "dqnNstep" in p:
                self.red_dqn_n_step = max(1, min(10, int(p["dqnNstep"])))
                red_net_change = True
            if red_net_change:
                # a new architecture / buffer needs fresh weights: rebuild both sides
                # and restart the contest (mirrors set_params' width/buffer rebuild).
                self._build_agents()
                self._reset_stats()
                self._new_episode()
                return self.red_view()
            if "dpPlanning" in p:
                self.red_plan_speed = max(0.0, min(10.0, float(p["dpPlanning"])))
                if hasattr(self.red, "plan_speed"):
                    self.red.plan_speed = self.red_plan_speed
            if hasattr(self.red, "alpha"):
                self.red.alpha = self.red_alpha
            if hasattr(self.red, "gamma"):
                self.red.gamma = self.red_gamma
            if ((self.red_gamma != old_gamma or self.red_plan_speed != old_plan_speed)
                    and is_dp(self.algo_red) and hasattr(self.red, "reset_learning")):
                self.red.reset_learning()   # replay the DP race with the new CPU setting
            self._apply_epsilon()
            return self.red_view()

    def red_view(self):
        """Red's current params (for the locked CPU panel). Step cap / episode
        target are the shared globals, shown for parity with the Blue panel."""
        return {
            "alpha": round(self.red_alpha, 4),
            "gamma": round(self.red_gamma, 4),
            "epsStart": round(self.red_eps_start, 3),
            "epsEnd": round(self.red_eps_end, 3),
            "epsEpisodes": self._effective_red_eps_episodes(),
            "dpPlanning": round(self.red_plan_speed, 3),
            "dqnBatch": self.red_dqn_batch,
            "dqnBuffer": self.red_dqn_buffer,
            "dqnWarmup": self.red_dqn_warmup,
            "dqnTargetSync": self.red_dqn_target_sync,
            "dqnNstep": self.red_dqn_n_step,
            "dqnHidden": self.red_dqn_hidden,
            "dqnLayers": self.red_dqn_layers,
            "maxSteps": self.env.max_steps,
            "targetEpisodes": self.target_episodes or 0,
        }
