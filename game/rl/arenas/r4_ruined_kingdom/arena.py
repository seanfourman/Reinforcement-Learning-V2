"""Round 4's arena mechanics: the Banzai Bill survival duel.

On the shared continuous engine's circular tower, Banzai Bills enter through
the top opening, curve toward a target, and explode on a character or the
rim. Agents earn reward for every moment survived, for dodging Bills aimed at
them, and lose a HEART on a hit (with a brief mercy-invulnerability window);
the survivor wins when the rival runs out of hearts. Collectible pickups
(speed / shield / slow / freeze) litter the arena, and the barrage ESCALATES
with survival time, gated early in training by an episode curriculum.

Round-4 specifics that live here: the missile spawner/homing/impact pipeline
(swept-circle collision, event-time ordering), the pickup system, hearts +
mercy windows, the threat-sorted observation vector, the dodge shaping, the
chaos/curriculum schedule, and the panel's live game-feel dials
(``set_missile_dynamics``).

Movement follows the project spec: DISCRETE velocity chosen every 0.02 s with
NO momentum; stability comes from ACTION-REPEAT (the chosen heading is held
for several steps) - see the engine's ``_commit_action``.
"""

import math

import numpy as np

from core.continuous_arena import ContinuousArena, AGENT_R, N_ACTIONS

from .missiles import (MissilesMixin, MISSILE_R, MISSILE_SPAWN_Z,
                       MISSILE_MIN_SPEED, MISSILE_HARD_CAP, REWARD_DT_REF,
                       DODGE_SHAPING_CAP, REDIRECT_BONUS)
from .pickups import (PickupsMixin, PICKUP_TYPES, PICKUP_R, PICKUP_HARD_CAP,
                      PICKUP_FIRST_SECONDS, PICKUP_INTERVAL_SECONDS,
                      PICKUP_GROUND_LIFETIME, PICKUP_EFFECT_SECONDS,
                      SPEED_MULTIPLIER, SLOW_MULTIPLIER)

ROUND4_ARENA = 10.0   # Ruined Kingdom's playable room is exactly 10 x 10 metres
# EPISODE length cap (the agents' per-episode timeout, NOT anything about the
# missiles). Also the default the panel's Max-steps slider shows for R4.
# 3000 steps ~= 5 minutes: the agents lose their 3 hearts well before this, so it
# rarely bites; raise it from the slider if you want even longer runs.
SURVIVAL_MAX_STEPS = 3000
SURVIVAL_REWARD = 0.02   # per 0.1 s alive (-> 0.2 / second)
HIT_REWARD = 0.05        # small: this is a SURVIVAL game, not a "kill the rival" game
HIT_PENALTY = -2.0       # losing a heart hurts a lot: dodging is the whole task

# 3 lives (hearts).  A hit costs one heart and grants a brief invincibility IN
# PLACE (the character is NOT teleported back to spawn); the round ends only when
# a character runs OUT of hearts.  This is why episodes are long (both to watch AND
# to learn from): a single mistake no longer ends everything, so the agent keeps
# accumulating dodging experience.  The frontend blinks the character while the
# invincibility lasts (classic post-hit flicker).
HEARTS = 3
HIT_INVULN_SECONDS = 0.9

# The first training episodes deliberately expose only a fraction of Round 4's
# final pressure.  Match supplies the completed-episode count before every reset.
MISSILE_CURRICULUM_EPISODES = 1_000

# ---- Endless escalation: the arena gets more chaotic the longer you survive ----
# "chaos" grows with survival time WITHOUT an upper bound (gated by the training
# curriculum) and drives the missile + pickup COUNT. "sharpness" = chaos capped at
# 1 and drives how fast / how hard each missile homes. The ramp is deliberately
# gentler early than the old fixed cap (few slow missiles at first, so a run breathes
# before the storm), then keeps climbing: 3 Bills by ~500 steps, 4 by ~750, 5 by
# ~1000, up to the hard cap. So a good agent survives further AND meets real chaos.
CHAOS_RAMP_SECONDS = 22.0   # SECONDS for missile SHARPNESS (speed/homing) to peak
OBS_MISSILE_SLOTS = 3       # the net sees all 3 possible threats (sorted by imminence)
OBS_PICKUP_SLOTS = 3        # + the 3 nearest pickups (grab the good ones, dodge the bad)

# Slim, THREAT-SORTED survival observation:
#   5 own kinematics (pos, vel, rim clearance)
# + 4 own power-up timers + 1 post-hit mercy-invuln timer (altered motion / brief
#   immunity are explained, so the agent can exploit the window instead of fearing it)
# + OBS_MISSILE_SLOTS x 8, SORTED nearest-threat-first (not by spawn slot), each:
#   present, rel x, rel z, vel x, vel z, aimed-at-me, time-to-impact, predicted-miss
# + OBS_PICKUP_SLOTS x 7 nearest pickups: present, rel x, rel z, type one-hot(4)
MISSILE_OBS_DIM = 5 + 5 + OBS_MISSILE_SLOTS * 8 + OBS_PICKUP_SLOTS * 7   # 55
# Backwards-compatible module export used by the standalone Round-4 self-test.
OBS_DIM = MISSILE_OBS_DIM


class MissileArena(MissilesMixin, PickupsMixin, ContinuousArena):
    """Round 4: Banzai Bill survival on the circular tower."""

    missile_game = True
    arena = ROUND4_ARENA
    shape = "circle"
    # The spec's 0.02 s decision step, with DIRECT discrete velocity (no momentum);
    # the committed heading (action_repeat) is what keeps motion smooth + learnable.
    dt = 0.02
    momentum = False
    action_repeat = 4
    max_steps = SURVIVAL_MAX_STEPS
    obs_dim = MISSILE_OBS_DIM

    # game-feel dials, live-tunable from the panel's World card (class defaults;
    # the Bill speed/turn dials live on MissilesMixin beside their machinery)
    hearts_max = HEARTS
    hit_penalty = HIT_PENALTY

    def _init_round_state(self):
        self.missiles = []
        self.explosions = []
        self.pickups = []
        self.pickup_events = []
        self.effects = {
            side: {kind: 0 for kind in PICKUP_TYPES}
            for side in ("red", "blue")
        }
        self.hearts = {"red": self.hearts_max, "blue": self.hearts_max}
        # post-hit mercy invulnerability (steps), separate from the pickup shield so
        # the frontend can BLINK the character here but show the shield for the pickup.
        self.hit_flash = {"red": 0, "blue": 0}
        self._missile_serial = 0
        self._explosion_serial = 0
        self._pickup_serial = 0
        self._pickup_event_serial = 0
        # Standalone users retain the complete game. Match explicitly sets this to
        # the current training episode (zero for a fresh learner) before reset.
        self.curriculum_episode = MISSILE_CURRICULUM_EPISODES
        self.next_missile_step = self._seconds_to_steps(0.6)
        self.next_pickup_step = self._seconds_to_steps(PICKUP_FIRST_SECONDS)

    def _game_mode(self):
        return "missileSurvival"

    # ----------------------------------------------------------------- reset
    def _reset_round_state(self, regenerate):
        self.missiles = []
        self.next_missile_step = self._seconds_to_steps(0.6)
        self._next_target = self.rng.choice(("red", "blue"))
        self.pickups = []
        self.pickup_events = []
        self.effects = {
            side: {kind: 0 for kind in PICKUP_TYPES}
            for side in ("red", "blue")
        }
        self.hearts = {"red": self.hearts_max, "blue": self.hearts_max}
        self.hit_flash = {"red": 0, "blue": 0}
        self.next_pickup_step = self._seconds_to_steps(PICKUP_FIRST_SECONDS)
        # Keep recent explosions through the automatic episode reset long
        # enough for the browser to receive and animate the terminal blast.
        if regenerate:
            self.explosions = []
        else:
            for event in self.explosions:
                event["carryover"] = True

    # ---------------------------------------------------------- panel dials
    def set_missile_dynamics(self, missile_speed=None, missile_turn=None,
                             hearts=None, hit_penalty=None):
        """Live-tune the game feel from the panel (None = leave unchanged).
        A hearts change takes effect from the next episode (the caller resets)."""
        if missile_speed is not None:
            self.missile_max_speed = max(0.5, float(missile_speed))
        if missile_turn is not None:
            self.missile_turn = max(0.0, float(missile_turn))
        if hit_penalty is not None:
            self.hit_penalty = float(hit_penalty)
        if hearts is not None:
            self.hearts_max = max(1, int(hearts))

    # ------------------------------------------------- curriculum + escalation
    def set_curriculum_episode(self, episode):
        """Select one fixed training stage for the next episode."""
        if self.missile_game:
            self.curriculum_episode = max(0, int(episode))

    def _curriculum_progress(self):
        if not self.missile_game:
            return 1.0
        return min(
            1.0,
            self.curriculum_episode / float(MISSILE_CURRICULUM_EPISODES),
        )

    def _chaos(self):
        """UNBOUNDED escalation: how chaotic the arena is right now. Grows with
        survival TIME (no ceiling) and is gated by the training curriculum, so early
        training stays gentle. Time-based, so it is independent of the decision dt."""
        return (self.steps * self.dt / CHAOS_RAMP_SECONDS) * self._curriculum_progress()

    def _sharpness(self):
        """0..1: how fast and how hard each individual missile homes (chaos capped)."""
        return min(1.0, self._chaos())

    def _difficulty(self):
        """Back-compat 0..1 pressure reading for the snapshot / value heatmap /
        standalone callers. It is the bounded part of chaos (== sharpness)."""
        return self._sharpness()

    # snapshot still reports this; keep it meaning the bounded within-episode ramp.
    def _survival_difficulty(self):
        return self._sharpness()

    # ---------------------------------------------------------- observation
    def _missile_observe(self, which, pos, vel):
        centre = self.arena / 2
        centre_vec = np.array([centre, centre], dtype=np.float32)
        rim_clearance = max(
            0.0, centre - AGENT_R - float(np.linalg.norm(pos - centre_vec)))
        out = [
            (float(pos[0]) - centre) / centre,
            (float(pos[1]) - centre) / centre,
            float(vel[0]) / self.vmax,
            float(vel[1]) / self.vmax,
            rim_clearance / max(centre - AGENT_R, 1e-6),
        ]
        # own power-up timers only: they explain this agent's own altered speed /
        # freeze / shield.  Rival timers, pickup positions and difficulty/step
        # telemetry were pure distractors for a dodging policy and are dropped.
        for kind in PICKUP_TYPES:
            duration_steps = self._seconds_to_steps(PICKUP_EFFECT_SECONDS[kind])
            out.append(min(1.0, self.effects[which][kind] / max(1, duration_steps)))
        # post-hit mercy window: the agent is briefly immune here (used to be folded
        # into "invincible"); exposing it lets a good policy reposition fearlessly.
        out.append(min(
            1.0,
            self.hit_flash[which] / max(1, self._seconds_to_steps(HIT_INVULN_SECONDS)),
        ))

        # the OBS_MISSILE_SLOTS nearest threats, sorted NEAREST-THREAT-FIRST, each
        # carrying its time-to-impact and predicted miss distance.  Absent slots
        # are zeroed; if there are more Bills than slots, the least-imminent are
        # dropped (they are the least urgent to react to).
        threats = sorted(self.missiles, key=lambda m: self._threat_key(m, pos, vel))
        for i in range(OBS_MISSILE_SLOTS):
            if i < len(threats):
                missile = threats[i]
                rel = missile["pos"] - pos
                t, miss, closing = self._threat_metrics(
                    missile["pos"], missile["vel"], pos, vel)
                out.extend([
                    1.0,
                    float(np.clip(rel[0] / self.arena, -2, 2)),
                    float(np.clip(rel[1] / self.arena, -2, 2)),
                    float(missile["vel"][0]) / self.missile_max_speed,
                    float(missile["vel"][1]) / self.missile_max_speed,
                    1.0 if missile["target"] == which else -1.0,
                    min(1.0, t / 2.0) if closing else 1.0,   # time-to-impact
                    min(1.0, miss / 3.0),                    # predicted miss dist
                ])
            else:
                out.extend([0.0] * 8)

        # the OBS_PICKUP_SLOTS nearest pickups: so the agent can seek the good ones
        # (speed / invincible) and steer clear of the bad ones (slow / freeze) as
        # they multiply.  present, relative x/z, then a 4-way type one-hot.
        type_index = {kind: idx for idx, kind in enumerate(PICKUP_TYPES)}
        near_pickups = sorted(
            self.pickups, key=lambda p: float(np.linalg.norm(p["pos"] - pos)))
        for i in range(OBS_PICKUP_SLOTS):
            if i < len(near_pickups):
                pickup = near_pickups[i]
                rel = pickup["pos"] - pos
                one_hot = [0.0] * len(PICKUP_TYPES)
                one_hot[type_index[pickup["type"]]] = 1.0
                out.extend([
                    1.0,
                    float(np.clip(rel[0] / self.arena, -1, 1)),
                    float(np.clip(rel[1] / self.arena, -1, 1)),
                    *one_hot,
                ])
            else:
                out.extend([0.0] * (3 + len(PICKUP_TYPES)))
        assert len(out) == MISSILE_OBS_DIM
        return np.asarray(out, dtype=np.float32)

    def _observe(self, which, pos, vel):
        return self._missile_observe(which, pos, vel)

    def _grant_hit_invuln(self, side, invuln_steps):
        """After a non-fatal hit, leave the character exactly where it was struck
        (no teleport) and give it a brief mercy invulnerability so an in-flight Bill
        cannot instantly re-hit it. Tracked apart from the pickup shield so the
        frontend blinks the character here (rather than drawing the shield bubble)."""
        self.hit_flash[side] = max(self.hit_flash[side], invuln_steps)

    def _immune(self, side):
        """A character cannot be hit while shielded by the pickup OR during the
        brief post-hit mercy window."""
        return self.effects[side]["invincible"] > 0 or self.hit_flash[side] > 0

    # ------------------------------------------------------------------ step
    def step(self, a_red, a_blue):
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        # the committed heading (action-repeat) is what actually executes
        a_red = self._commit_action("red", a_red)
        a_blue = self._commit_action("blue", a_blue)
        return self._step_missile_game(a_red, a_blue)

    def _step_missile_game(self, a_red, a_blue):
        self._age_explosions()
        self._age_pickup_events()
        self._advance_pickup_spawns()
        # age the post-hit mercy window from prior steps (a fresh hit below re-arms it)
        for side in ("red", "blue"):
            self.hit_flash[side] = max(0, self.hit_flash[side] - 1)
        # per-step survival, scaled by dt so it is a constant reward PER SECOND (not
        # a giant per-tick bonus that would drown the per-event hit / evade rewards).
        survive = SURVIVAL_REWARD * (self.dt / REWARD_DT_REF)
        reward = {"red": survive, "blue": survive}
        old_red = self.red_pos.copy()
        old_blue = self.blue_pos.copy()
        old_red_vel = self.red_vel.copy()
        old_blue_vel = self.blue_vel.copy()
        red_speed, red_frozen = self._movement_effect("red")
        blue_speed, blue_frozen = self._movement_effect("blue")
        self.red_pos, self.red_vel = self._integrate(
            self.red_pos, self.red_vel, a_red, red_speed, red_frozen)
        self.blue_pos, self.blue_vel = self._integrate(
            self.blue_pos, self.blue_vel, a_blue, blue_speed, blue_frozen)
        dodge_shaping = self._dodge_shaping(
            {
                "red": (old_red, old_red_vel),
                "blue": (old_blue, old_blue_vel),
            },
            {
                "red": (self.red_pos, self.red_vel),
                "blue": (self.blue_pos, self.blue_vel),
            },
        )
        hits, redirects = self._advance_missiles(reward, old_red, old_blue)
        for side in ("red", "blue"):
            # A lethal transition is already explained by HIT_PENALTY. Do not let
            # an optimistic pre-impact projection soften that terminal signal.
            if side in hits:
                dodge_shaping[side] = 0.0
            reward[side] += dodge_shaping[side]
        fresh_effects = set()
        if not hits:
            # Missiles use only effects that were active at tick start. A collectible
            # reached during this movement becomes active on the following decision,
            # so a late shield can never retroactively cancel an earlier impact.
            fresh_effects = self._collect_pickups(reward, {
                "red": (old_red, self.red_pos),
                "blue": (old_blue, self.blue_pos),
            })
        self._tick_effects(fresh_effects)

        if hits:
            # Every hit costs the struck character a heart and hurts a lot. The
            # round only ENDS when someone runs out of hearts; otherwise the
            # victim respawns (briefly shielded) and the episode keeps going.
            for side in hits:
                reward[side] += self.hit_penalty
                self.hearts[side] = max(0, self.hearts[side] - 1)
            out = {side for side in hits if self.hearts[side] <= 0}
            if out:
                self.done = True
                if out == {"red"}:
                    self.winner = "blue"
                    reward["blue"] += HIT_REWARD
                elif out == {"blue"}:
                    self.winner = "red"
                    reward["red"] += HIT_REWARD
                else:                       # both emptied on the same instant
                    self.winner = None
                # tag THIS step's fatal blast(s) so the frontend plays the death /
                # win choreography only for a real death (non-fatal hits just blink).
                for event in reversed(self.explosions):
                    if event.get("step") != self.steps:
                        break               # older step (appended in order) -> stop
                    if event.get("hit") in ("red", "blue", "both"):
                        event["fatal"] = True
            else:
                invuln = self._seconds_to_steps(HIT_INVULN_SECONDS)
                for side in hits:
                    self._grant_hit_invuln(side, invuln)

        truncated = False
        if not self.done and self.steps >= self.max_steps:
            self.done = True
            truncated = True
            self.winner = None
        obs = (
            self._observe("red", self.red_pos, self.red_vel),
            self._observe("blue", self.blue_pos, self.blue_vel),
        )
        return obs, reward, self.done, truncated, {
            "winner": self.winner,
            "hit": next(iter(hits)) if len(hits) == 1 else ("both" if hits else None),
            "redirects": dict(redirects),
            "redirectBonus": {
                side: round(redirects[side] * REDIRECT_BONUS, 3)
                for side in ("red", "blue")
            },
            "dodgeShaping": {
                side: round(dodge_shaping[side], 5)
                for side in ("red", "blue")
            },
        }

    # --------------------------------------------------------------- viewer
    def to_json(self):
        out = super().to_json()
        # Round 4's art and camera were authored around world centre (10, 10).
        # Its 10 m simulation is rendered there rather than moving the whole
        # established composition to (5, 5); the round tower's usable top (30
        # scene units across) is filled by scaling the 10 m circle up 3x.
        out["sceneCenter"] = [10.0, 10.0]
        out["sceneScale"] = 3.0
        out["missile"] = {
            "radius": MISSILE_R,
            "entry": [self.arena / 2, MISSILE_SPAWN_Z],
            "minSpeed": MISSILE_MIN_SPEED,
            "maxSpeed": self.missile_max_speed,
            "maxConcurrent": MISSILE_HARD_CAP,
            "maxHearts": self.hearts_max,
            "curriculumEpisodes": MISSILE_CURRICULUM_EPISODES,
            "dodgeShapingCap": DODGE_SHAPING_CAP,
        }
        out["pickupConfig"] = {
            "types": list(PICKUP_TYPES),
            "radius": PICKUP_R,
            "maxActive": PICKUP_HARD_CAP,
            "firstSpawn": PICKUP_FIRST_SECONDS,
            "spawnInterval": list(PICKUP_INTERVAL_SECONDS),
            "groundLifetime": PICKUP_GROUND_LIFETIME,
            "durations": dict(PICKUP_EFFECT_SECONDS),
            "speedMultiplier": SPEED_MULTIPLIER,
            "slowMultiplier": SLOW_MULTIPLIER,
        }
        return out

    def snapshot(self):
        # Also expires live-only carryover while paused or after a target-episode
        # stop, where no further environment step would otherwise age events.
        self._age_explosions()
        self._age_pickup_events(advance=False)
        out = super().snapshot()
        rd = lambda v: [round(float(v[0]), 3), round(float(v[1]), 3)]  # noqa: E731
        out.update({
            "hearts": dict(self.hearts),
            "maxHearts": self.hearts_max,
            "survivalTime": round(self.steps * self.dt, 2),
            "difficulty": round(self._difficulty(), 3),
            # the escalation level (unbounded): drives how many Bills / pickups
            "chaos": round(self._chaos(), 3),
            "missileLimit": self._missile_limit(),
            "pickupLimit": self._pickup_max_active(),
            "survivalDifficulty": round(
                self._survival_difficulty(), 3),
            "curriculumEpisode": int(self.curriculum_episode),
            "curriculumProgress": round(
                self._curriculum_progress(), 3),
            "nextMissileIn": max(0, self.next_missile_step - self.steps),
            "nextPickupIn": round(
                max(0, self.next_pickup_step - self.steps) * self.dt, 2),
            "missiles": [
                {
                    "id": missile["id"],
                    "pos": rd(missile["pos"]),
                    "vel": rd(missile["vel"]),
                    "target": missile["target"],
                }
                for missile in self.missiles
            ],
            "explosions": [
                {
                    "id": event["id"],
                    "missileId": event["missileId"],
                    "pos": rd(event["pos"]),
                    "hit": event["hit"],
                    "fatal": bool(event.get("fatal", False)),
                    "blocked": event.get("blocked"),
                    "redirected": event.get("redirected"),
                    "carryover": bool(event.get("carryover", False)),
                    "survivalTime": event.get("survivalTime"),
                    "difficulty": event.get("difficulty"),
                }
                for event in self.explosions
            ],
            "pickups": [
                {
                    "id": pickup["id"],
                    "slot": pickup["slot"],
                    "type": pickup["type"],
                    "pos": rd(pickup["pos"]),
                    "radius": PICKUP_R,
                    "remaining": round(
                        max(0, pickup["expiresStep"] - self.steps) * self.dt,
                        2,
                    ),
                }
                for pickup in sorted(
                    self.pickups, key=lambda item: item["id"])
            ],
            "effects": {
                side: {
                    "speed": round(
                        self.effects[side]["speed"] * self.dt, 2),
                    "invincible": round(
                        self.effects[side]["invincible"] * self.dt, 2),
                    "slow": round(
                        self.effects[side]["slow"] * self.dt, 2),
                    "frozen": round(
                        self.effects[side]["freeze"] * self.dt, 2),
                    # post-hit blink window (seconds); the pickup shield uses
                    # "invincible" above, so the frontend can tell them apart.
                    "hitFlash": round(self.hit_flash[side] * self.dt, 2),
                    "speedMultiplier": round(
                        self._movement_effect(side)[0], 3),
                }
                for side in ("red", "blue")
            },
            "pickupEvents": [
                {
                    "id": event["id"],
                    "pickupId": event["pickupId"],
                    "type": event["type"],
                    "side": event["side"],
                    "collector": event["collector"],
                    "pos": rd(event["pos"]),
                }
                for event in self.pickup_events
            ],
        })
        return out




# --------------------------------------------------------------------- self-test
if __name__ == "__main__":
    # Random dodging sanity check: missiles spawn, rewards stay finite, episodes end.
    import os
    import sys

    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

    env = MissileArena(seed=0)
    print(f"Round 4: {env.arena}m {env.shape}, {N_ACTIONS} actions, "
          f"obs dim {env.obs_dim}, Banzai survival")
    wins, lens = {"red": 0, "blue": 0, None: 0}, []
    saw_missile = saw_blast = False
    for ep in range(100):
        env.reset(seed=ep, regenerate=True)
        done = False
        while not done:
            ar, ab = env.rng.randrange(N_ACTIONS), env.rng.randrange(N_ACTIONS)
            _, rew, done, trunc, info = env.step(ar, ab)
            assert all(math.isfinite(v) for v in rew.values())
            saw_missile |= bool(env.missiles)
            saw_blast |= bool(env.explosions)
        wins[info["winner"]] += 1
        lens.append(env.steps)
    assert saw_missile and saw_blast
    print(f"missiles: wins {wins}, avg survival {sum(lens) / len(lens):.0f} decisions")
