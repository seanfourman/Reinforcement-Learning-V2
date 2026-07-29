"""Round 4's Banzai Bill machinery: spawning, homing, impacts and dodge credit.

Split out of ``arena.py`` purely by size and concern; ``MissileArena`` mixes
this class in, so every method runs on the arena instance. Bills enter through
the tower's north opening, curve toward a target with a capped turn rate (so a
well-timed juke always makes a single Bill overshoot), and explode on a
character, the rim, or a 12-second safety fuse. Impacts are resolved in exact
EVENT-TIME order using the engine's swept-circle geometry, so a same-step
"hit vs wall" race is decided by which actually happens first along the path.

Also here: the threat metrics (time-to-impact + predicted miss distance) the
observation sorts by, and the potential-based DODGE SHAPING that pays for
actively changing a closing Bill's projected miss distance.
"""

import math
import time

import numpy as np

from core.continuous_arena import AGENT_R


# Banzai Bill flight parameters.
MISSILE_R = 0.30
MISSILE_SPAWN_Z = -2.0
MISSILE_MIN_SPEED = 3.2
# Below the agent's own top speed (VMAX 7.0) so a single Bill is always OUTRUNNABLE:
# the difficulty comes from facing MANY at once, not from one unavoidable missile.
MISSILE_MAX_SPEED = 5.4
MISSILE_TURN_RATE = 0.5   # max homing turn (rad/s) at full sharpness; panel-tunable
EXPLOSION_HOLD_SECONDS = 1.25
# Per-STEP rewards (survival + dodge shaping) are quoted per a 0.1 s reference step
# and scaled by dt/REF at runtime, so their per-SECOND value is constant no matter how
# fine the decision step is. The per-EVENT rewards below (hit / evade / win) are NOT
# scaled - they fire once per event and are already dt-independent.
REWARD_DT_REF = 0.1
EVADE_REWARD = 0.15      # a missile aimed at you expiring without a hit = you dodged it
REDIRECT_BONUS = 0.0     # baiting the rival is off: it only added variance/noise

# Threat-aware dodge shaping.  The comparison uses the same missile state before
# and after the character's movement, so reward comes from changing the projected
# miss distance rather than from a Bill naturally flying past.  The signed,
# aggregate cap prevents left/right oscillation from becoming a reward farm.
DODGE_SHAPING_CAP = 0.025
DODGE_THREAT_HORIZON = 1.4
DODGE_THREAT_MARGIN = 0.25
MISSILE_HARD_CAP = 3        # hard cap: never more than 3 Bills in the air at once


class MissilesMixin:
    """Bill spawning, homing, impact resolution and dodge shaping."""

    # Bill flight dials, live-tunable from the panel (class defaults; see the
    # arena's ``set_missile_dynamics``)
    missile_max_speed = MISSILE_MAX_SPEED
    missile_turn = MISSILE_TURN_RATE

    @staticmethod
    def _threat_metrics(m_pos, m_vel, a_pos, a_vel):
        """Straight-line closest approach of a missile to an agent.

        Returns (time_to_closest, miss_distance, closing).  ``closing`` is False
        for a receding / relatively-stationary missile, where the time is
        meaningless and the current distance is reported instead.  This is the
        single most decision-relevant quantity for dodging, so it is handed to
        the network directly instead of left to be rediscovered from raw vectors.
        """
        rel_pos = np.asarray(m_pos, dtype=np.float32) - np.asarray(a_pos, dtype=np.float32)
        rel_vel = np.asarray(m_vel, dtype=np.float32) - np.asarray(a_vel, dtype=np.float32)
        dist = float(np.linalg.norm(rel_pos))
        speed_sq = float(np.dot(rel_vel, rel_vel))
        if speed_sq < 1e-8:
            return 999.0, dist, False
        approach = float(np.dot(rel_pos, rel_vel))
        if approach >= 0.0:                 # already moving apart
            return 999.0, dist, False
        t = -approach / speed_sq
        closest = rel_pos + rel_vel * t
        return t, float(np.linalg.norm(closest)), True

    def _threat_key(self, missile, pos, vel):
        """Sort key: genuinely closing missiles first (soonest impact), then the
        rest by raw distance.  Slot 0 of the observation is therefore ALWAYS the
        most imminent threat, which is what makes the vector learnable (the old
        layout keyed missiles by arbitrary spawn slot)."""
        t, miss, closing = self._threat_metrics(
            missile["pos"], missile["vel"], pos, vel)
        return (0, t, miss) if closing else (1, miss, 0.0)

    # --------------------------------------------------------------- missiles
    def _missile_interval(self):
        # Gap between launches in SECONDS -> steps: ~1.2 s early, tightening to ~0.4 s
        # as it sharpens (time-based, so dt does not change the launch cadence).
        seconds = 1.2 - 0.8 * self._sharpness()
        return max(1, self._seconds_to_steps(seconds))

    def _missile_limit(self):
        # Fixed TIME schedule, hard-capped at 3: 1 Bill to start, 2 from 10 s survived,
        # 3 from 20 s on. Time-based, so the 0.02 s step does not change the pacing.
        t = self.steps * self.dt
        if t < 10.0:
            return 1
        if t < 20.0:
            return 2
        return 3

    def _spawn_missile(self):
        target = self._next_target
        self._next_target = "blue" if target == "red" else "red"
        target_pos = self.red_pos if target == "red" else self.blue_pos
        target_vel = self.red_vel if target == "red" else self.blue_vel
        difficulty = self._difficulty()
        spawn = np.array([
            self.arena / 2 + self.rng.uniform(-0.45, 0.45),
            MISSILE_SPAWN_Z,
        ], dtype=np.float32)
        # Early shots lead only a little and are almost straight. Later shots predict
        # the target more aggressively; bounded random aim makes every curve distinct.
        lead = 0.15 + difficulty * 0.55
        aim = target_pos + target_vel * lead
        aim[0] += self.rng.uniform(-0.8, 0.8) * (1.0 - difficulty * 0.55)
        direction = aim - spawn
        direction /= max(float(np.linalg.norm(direction)), 1e-6)
        speed = MISSILE_MIN_SPEED + (self.missile_max_speed - MISSILE_MIN_SPEED) * difficulty
        occupied = {missile["slot"] for missile in self.missiles}
        slot = next(slot for slot in range(MISSILE_HARD_CAP) if slot not in occupied)
        self._missile_serial += 1
        self.missiles.append({
            "id": self._missile_serial,
            "slot": slot,
            "pos": spawn,
            "vel": direction.astype(np.float32) * speed,
            "target": target,
            "entered": False,
            "age": 0,
        })

    def _add_explosion(self, pos, hit=None, missile_id=None, blocked=None,
                       redirected=None):
        self._explosion_serial += 1
        event = {
            "id": self._explosion_serial,
            "missileId": missile_id,
            "pos": np.asarray(pos, dtype=np.float32).copy(),
            "hit": hit,
            "blocked": blocked,
            "redirected": redirected,
            # fatal = this blast took a character's LAST heart (round over). Set
            # afterwards, once hearts are resolved; a non-fatal hit stays False so
            # the frontend blinks the victim instead of playing the death pose.
            "fatal": False,
            "step": self.steps,
            "expiresAt": time.monotonic() + EXPLOSION_HOLD_SECONDS,
            "carryover": False,
            "survivalTime": round(self.steps * self.dt, 2),
            "difficulty": round(self._difficulty(), 3),
        }
        self.explosions.append(event)
        self.explosions = self.explosions[-16:]

    def _age_explosions(self):
        now = time.monotonic()
        self.explosions = [
            event for event in self.explosions
            if event.get("expiresAt", now + 1) > now
        ]

    @staticmethod
    def _dodge_potential(missile_pos, missile_vel, agent_pos, agent_vel):
        """0..1 projected safety for a genuinely closing near-term threat.

        A value of 1 means the current straight-line closest approach is safely
        outside the collision corridor (or the missile is receding / too far into
        the future). Lower values mean a more direct projected collision.
        """
        rel_pos = np.asarray(missile_pos, dtype=np.float32) - np.asarray(
            agent_pos, dtype=np.float32)
        rel_vel = np.asarray(missile_vel, dtype=np.float32) - np.asarray(
            agent_vel, dtype=np.float32)
        speed_sq = float(np.dot(rel_vel, rel_vel))
        if speed_sq < 1e-8:
            return 1.0
        approach = float(np.dot(rel_pos, rel_vel))
        if approach >= 0.0:
            return 1.0
        closest_t = -approach / speed_sq
        if closest_t <= 0.0 or closest_t > DODGE_THREAT_HORIZON:
            return 1.0
        closest = rel_pos + rel_vel * closest_t
        miss_distance = float(np.linalg.norm(closest))
        danger_radius = MISSILE_R + AGENT_R + DODGE_THREAT_MARGIN
        return min(1.0, max(0.0, miss_distance / danger_radius))

    def _dodge_shaping(self, old_paths, new_paths):
        """Signed, bounded action credit for improving projected miss distance."""
        shaping = {"red": 0.0, "blue": 0.0}
        # per-step shaping, scaled by dt like the survival reward (constant per second)
        cap = DODGE_SHAPING_CAP * (self.dt / REWARD_DT_REF)
        for side in ("red", "blue"):
            # An immune character (shield or post-hit mercy window) is not under a
            # lethal threat, so it cannot collect avoidance credit just by moving.
            if self._immune(side):
                continue
            old_pos, old_vel = old_paths[side]
            new_pos, new_vel = new_paths[side]
            potential_delta = 0.0
            for missile in self.missiles:
                # Only credit dodging the missiles actually aimed at THIS agent;
                # reacting to a Bill hunting the rival was noise.
                if missile["target"] != side:
                    continue
                before = self._dodge_potential(
                    missile["pos"], missile["vel"], old_pos, old_vel)
                after = self._dodge_potential(
                    missile["pos"], missile["vel"], new_pos, new_vel)
                potential_delta += after - before
            shaping[side] = max(-cap, min(cap, potential_delta * cap))
        return shaping

    def _advance_missiles(self, reward, old_red, old_blue):
        """Advance missiles in event-time order; return the first character hit(s)."""
        difficulty = self._difficulty()
        if (self.steps >= self.next_missile_step
                and len(self.missiles) < self._missile_limit()):
            self._spawn_missile()
            # Refill the arena FAST toward the current limit (a quick top-up every few
            # steps) so there is never dead air; only pause a full interval once the
            # limit is met. This kills the "long time with no missile" gaps.
            if len(self.missiles) < self._missile_limit():
                self.next_missile_step = self.steps + max(1, self._seconds_to_steps(0.3))
            else:
                self.next_missile_step = self.steps + self._missile_interval()

        centre = np.array([self.arena / 2, self.arena / 2], dtype=np.float32)
        rim = self.arena / 2 - MISSILE_R
        new_red, new_blue = self.red_pos.copy(), self.blue_pos.copy()
        paths = {
            "red": (old_red, new_red),
            "blue": (old_blue, new_blue),
        }
        plans = []
        for missile in self.missiles:
            target_pos = new_red if missile["target"] == "red" else new_blue
            target_vel = self.red_vel if missile["target"] == "red" else self.blue_vel
            missile["age"] += 1

            # Rotate toward a short prediction of the target, with a strict angular
            # speed cap. This produces readable curved arcs instead of aim snapping.
            lead = 0.12 + difficulty * 0.42
            desired = target_pos + target_vel * lead - missile["pos"]
            desired_angle = math.atan2(float(desired[1]), float(desired[0]))
            current_angle = math.atan2(float(missile["vel"][1]), float(missile["vel"][0]))
            delta = math.atan2(
                math.sin(desired_angle - current_angle),
                math.cos(desired_angle - current_angle),
            )
            # Straight at the start, widening to a gentle 0.5 rad/s home. Its turn
            # radius stays larger than the arena, so a well-timed juke always makes
            # a single Bill overshoot - surviving many at once is the real skill.
            turn_rate = self.missile_turn * difficulty
            turn = max(-turn_rate * self.dt, min(turn_rate * self.dt, delta))
            angle = current_angle + turn
            speed = MISSILE_MIN_SPEED + (
                self.missile_max_speed - MISSILE_MIN_SPEED) * difficulty
            old_missile = missile["pos"].copy()
            missile["vel"] = np.array(
                [math.cos(angle) * speed, math.sin(angle) * speed],
                dtype=np.float32,
            )
            next_missile = missile["pos"] + missile["vel"] * self.dt

            candidates = []
            for side, (old_agent, new_agent) in paths.items():
                hit_time = self._swept_hit_time(
                    old_missile, next_missile, old_agent, new_agent,
                    MISSILE_R + AGENT_R,
                )
                if hit_time is not None:
                    candidates.append((hit_time, 0, "hit", side))

            old_dist = float(np.linalg.norm(old_missile - centre))
            new_dist = float(np.linalg.norm(next_missile - centre))
            entered_before = bool(missile["entered"]) or old_dist <= rim
            if old_dist <= rim or new_dist <= rim:
                missile["entered"] = True
            if entered_before and new_dist > rim:
                wall_time = self._circle_exit_time(
                    old_missile, next_missile, centre, rim)
                if wall_time is not None:
                    candidates.append((wall_time, 1, "wall", None))
            if missile["age"] * self.dt > 12.0:  # safety fuse (12 s) vs an endless orbit
                candidates.append((1.0, 2, "fuse", None))

            event = None
            if candidates:
                first_time, _, first_kind, first_side = min(candidates)
                if first_kind == "hit":
                    contact_sides = {
                        side for t, _, kind, side in candidates
                        if kind == "hit" and abs(t - first_time) <= 1e-5
                    }
                    blocked_sides = {
                        side for side in contact_sides
                        if self._immune(side)
                    }
                    sides = contact_sides - blocked_sides
                    first_kind = "hit" if sides else "shield"
                else:
                    sides = set()
                    blocked_sides = set()
                event = {
                    "time": first_time,
                    "kind": first_kind,
                    "sides": sides,
                    "blockedSides": blocked_sides,
                    "pos": old_missile + (next_missile - old_missile) * first_time,
                }
            plans.append({
                "missile": missile,
                "old": old_missile,
                "new": next_missile,
                "event": event,
            })

        hit_events = [
            plan["event"] for plan in plans
            if plan["event"] and plan["event"]["kind"] == "hit"
        ]
        terminal_time = min(
            (event["time"] for event in hit_events), default=None)
        hits = set()
        if terminal_time is not None:
            for event in hit_events:
                if abs(event["time"] - terminal_time) <= 1e-5:
                    hits.update(event["sides"])

        redirects = {"red": 0, "blue": 0}
        cutoff = terminal_time if terminal_time is not None else 1.0
        survivors = []
        for plan in plans:
            missile = plan["missile"]
            event = plan["event"]
            if event is not None and event["time"] <= cutoff + 1e-5:
                hit_label = None
                if event["kind"] == "hit":
                    hit_label = (
                        next(iter(event["sides"]))
                        if len(event["sides"]) == 1 else "both"
                    )
                elif event["kind"] == "shield":
                    # A truthy non-character hit asks the theme for the full contact
                    # explosion without triggering live.js's victim animation.
                    hit_label = "shield"
                blocked_label = None
                if event["blockedSides"]:
                    blocked_label = (
                        next(iter(event["blockedSides"]))
                        if len(event["blockedSides"]) == 1 else "both"
                    )
                redirected_side = None
                if (event["kind"] == "hit"
                        and terminal_time is not None
                        and abs(event["time"] - terminal_time) <= 1e-5):
                    target = missile["target"]
                    other = "blue" if target == "red" else "red"
                    # Reward a genuine bait only when this target's missile kills
                    # the rival and the baiting target survives the entire terminal
                    # instant. This excludes shields, self-hits, multi-hit draws and
                    # a simultaneous second Bill that kills the would-be recipient.
                    if (target not in hits
                            and target not in event["blockedSides"]
                            and other in event["sides"]):
                        redirected_side = target
                        redirects[target] += 1
                        reward[target] += REDIRECT_BONUS
                self._add_explosion(
                    event["pos"], hit_label, missile["id"], blocked_label,
                    redirected_side)
                # A missile aimed at someone that expires on the rim or fuses out
                # without a kill means that target genuinely DODGED it: pay the
                # evade bonus (unless they were hit by something else this step).
                if event["kind"] in ("wall", "fuse"):
                    tgt = missile["target"]
                    if tgt not in hits:
                        reward[tgt] += EVADE_REWARD
                continue
            missile["pos"] = plan["old"] + (
                plan["new"] - plan["old"]) * cutoff
            survivors.append(missile)

        if terminal_time is not None:
            self.red_pos = old_red + (new_red - old_red) * terminal_time
            self.blue_pos = old_blue + (new_blue - old_blue) * terminal_time
        self.missiles = survivors
        return hits, redirects
