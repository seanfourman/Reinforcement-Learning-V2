"""Round 4's collectible pickups: spawn, pickup and effect machinery.

Split out of ``arena.py`` purely by size and concern; ``MissileArena`` mixes
this class in, so every method runs on the arena instance. Four pickup types
litter the tower - two to SEEK and two to AVOID:

    speed        move faster for a few seconds (dodging gets much easier)
    invincible   a shield: Bills pass right through you
    slow         move slower (sluggish and easy to corner)
    freeze       frozen in place (the worst thing to touch mid-barrage)

There is deliberately NO direct pickup reward: a good pickup helps only via
better survival, a bad one hurts only via getting hit - paying for the touch
itself was noise that competed with the dodging signal. Pickup timings are in
simulated seconds (converted to steps), so training is reproducible at any
playback speed, and the spawn rate escalates with the arena's chaos level.
"""

import math
import time

import numpy as np

from core.continuous_arena import AGENT_R


# Collectible pickups.  Timings are expressed in simulated seconds and converted
# to integral decision steps by the environment, so training remains
# reproducible at any wall-clock playback speed.
PICKUP_TYPES = ("speed", "invincible", "slow", "freeze")
PICKUP_R = 0.42
PICKUP_MAX_ACTIVE = 2
PICKUP_FIRST_SECONDS = 2.5
PICKUP_INTERVAL_SECONDS = (4.0, 6.0)
PICKUP_GROUND_LIFETIME = 12.0
PICKUP_EVENT_HOLD_SECONDS = 0.9
PICKUP_EFFECT_SECONDS = {
    "speed": 4.0,
    "invincible": 2.5,
    "slow": 3.0,
    "freeze": 1.1,
}
SPEED_MULTIPLIER = 1.7
SLOW_MULTIPLIER = 0.5
PICKUP_HARD_CAP = 6         # up from 2


class PickupsMixin:
    """Pickup spawning, collection and effect timers, mixed into MissileArena."""

    # ---------------------------------------------------------------- pickups
    def _next_pickup_type(self):
        """Draw IID so the visible state fully describes the transition process."""
        return self.rng.choice(PICKUP_TYPES)

    def _pickup_position_is_valid(self, pos):
        centre = self.arena / 2
        radial_limit = centre - AGENT_R - PICKUP_R - 0.25
        if float(np.linalg.norm(pos - centre)) > radial_limit:
            return False
        # Keep the north opening readable and avoid putting a reward directly in
        # the launch lane through which every Banzai Bill initially travels.
        if pos[1] < centre - 2.35 and abs(float(pos[0]) - centre) < 1.25:
            return False
        for agent_pos in (self.red_pos, self.blue_pos):
            if float(np.linalg.norm(pos - agent_pos)) < 1.50:
                return False
        for pickup in self.pickups:
            if float(np.linalg.norm(pos - pickup["pos"])) < 1.25:
                return False
        return True

    def _spawn_pickup(self):
        centre = self.arena / 2
        usable_radius = centre - AGENT_R - PICKUP_R - 0.25
        pos = None
        # sqrt(U) gives uniform area density instead of crowding the centre.
        for _ in range(64):
            angle = self.rng.random() * math.tau
            radius = math.sqrt(self.rng.random()) * usable_radius
            candidate = np.array([
                centre + math.cos(angle) * radius,
                centre + math.sin(angle) * radius,
            ], dtype=np.float32)
            if self._pickup_position_is_valid(candidate):
                pos = candidate
                break
        if pos is None:
            return False
        occupied = {pickup["slot"] for pickup in self.pickups}
        slot = next(
            slot for slot in range(PICKUP_HARD_CAP)
            if slot not in occupied
        )
        self._pickup_serial += 1
        self.pickups.append({
            "id": self._pickup_serial,
            "slot": slot,
            "type": self._next_pickup_type(),
            "pos": pos,
            "spawnStep": self.steps,
            "expiresStep": (
                self.steps + self._seconds_to_steps(PICKUP_GROUND_LIFETIME)
            ),
        })
        return True

    def _pickup_max_active(self):
        """More pickups can litter the arena the more chaotic it gets (up to a cap)."""
        return min(PICKUP_HARD_CAP, PICKUP_MAX_ACTIVE + int(self._chaos()))

    def _advance_pickup_spawns(self):
        self.pickups = [
            pickup for pickup in self.pickups
            if pickup["expiresStep"] > self.steps
        ]
        if (self.steps < self.next_pickup_step
                or len(self.pickups) >= self._pickup_max_active()):
            return
        if self._spawn_pickup():
            # gaps between drops shrink as chaos climbs, so pickups also multiply
            factor = 1.0 / (1.0 + 0.4 * self._chaos())
            lo = max(1, int(self._seconds_to_steps(PICKUP_INTERVAL_SECONDS[0]) * factor))
            hi = max(lo, int(self._seconds_to_steps(PICKUP_INTERVAL_SECONDS[1]) * factor))
            self.next_pickup_step = self.steps + self.rng.randint(lo, hi)
        else:
            # A crowded instant retries soon rather than placing an invalid pickup.
            self.next_pickup_step = self.steps + self._seconds_to_steps(1.0)

    def _add_pickup_event(self, pickup, side):
        self._pickup_event_serial += 1
        self.pickup_events.append({
            "id": self._pickup_event_serial,
            "pickupId": pickup["id"],
            "type": pickup["type"],
            "side": side,
            # ``collector`` is a harmless compatibility alias for early viewers.
            "collector": side,
            "pos": pickup["pos"].copy(),
            "stepsLeft": self._seconds_to_steps(PICKUP_EVENT_HOLD_SECONDS),
            "expiresAt": time.monotonic() + PICKUP_EVENT_HOLD_SECONDS,
        })
        self.pickup_events = self.pickup_events[-16:]

    def _age_pickup_events(self, advance=True):
        now = time.monotonic()
        if advance:
            for event in self.pickup_events:
                event["stepsLeft"] = max(0, event.get("stepsLeft", 0) - 1)
            self.pickup_events = [
                event for event in self.pickup_events
                if event.get("stepsLeft", 0) > 0
                or event.get("expiresAt", 0.0) > now
            ]
        else:
            # A paused simulation has no step aging, so wall time prevents a stale
            # collection burst from living forever in the live snapshot.
            self.pickup_events = [
                event for event in self.pickup_events
                if event.get("expiresAt", 0.0) > now
            ]

    def _collect_pickups(self, reward, paths):
        """Resolve each collectible once; the first swept-circle contact wins."""
        collected_ids = set()
        fresh_effects = set()
        reach = AGENT_R + PICKUP_R
        for pickup in sorted(self.pickups, key=lambda item: item["id"]):
            candidates = []
            preferred = "red" if pickup["slot"] % 2 == 0 else "blue"
            for side, (old_pos, new_pos) in paths.items():
                contact_time = self._segment_circle_entry_time(
                    old_pos, new_pos, pickup["pos"], reach)
                if contact_time is not None:
                    # Slot parity is used only for an exact contact-time tie.
                    tie = 0 if side == preferred else 1
                    candidates.append((contact_time, tie, side))
            if not candidates:
                continue
            _, _, side = min(candidates)
            kind = pickup["type"]
            self.effects[side][kind] = self._seconds_to_steps(
                PICKUP_EFFECT_SECONDS[kind])
            fresh_effects.add((side, kind))
            if kind == "freeze":
                if side == "red":
                    self.red_vel = np.zeros(2, dtype=np.float32)
                else:
                    self.blue_vel = np.zeros(2, dtype=np.float32)
            # No direct pickup reward: a good pickup helps only via better survival
            # (a bad one hurts only via getting hit).  Paying for the touch itself
            # was noise that competed with the dodging signal.
            self._add_pickup_event(pickup, side)
            collected_ids.add(pickup["id"])
        if collected_ids:
            self.pickups = [
                pickup for pickup in self.pickups
                if pickup["id"] not in collected_ids
            ]
        return fresh_effects

    def _movement_effect(self, side):
        multiplier = 1.0
        if self.effects[side]["speed"] > 0:
            multiplier *= SPEED_MULTIPLIER
        if self.effects[side]["slow"] > 0:
            multiplier *= SLOW_MULTIPLIER
        return multiplier, self.effects[side]["freeze"] > 0

    def _tick_effects(self, fresh_effects=()):
        fresh_effects = set(fresh_effects)
        for side in ("red", "blue"):
            for kind in PICKUP_TYPES:
                if (side, kind) not in fresh_effects:
                    self.effects[side][kind] = max(
                        0, self.effects[side][kind] - 1)
