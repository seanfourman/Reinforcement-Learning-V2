"""Round 5's arena mechanics: CAPTURE THE FLAG on the Tostarena board.

A contested-carry CTF duel; both agents SEE each other. One flag sits on a pole
at CENTRE. GRAB it -> you are the CARRIER (haul it to your own corner base,
moving slower); the other is the CHASER (tag the carrier to INSTANTLY STEAL it -
the robbed carrier is briefly stunned). Delivering the flag to your base
CAPTURES it (+1); first to 3 captures wins (a timeout awards whoever captured
more). Breakable CRATES drop Mario-Kart WEAPONS held in a 1-slot inventory and
fired with a 10th USE action, and Bowser's airship hurls dodgeable objects at
the board (see ``weapons.py`` for that whole subsystem).

This is the POLICY round's showcase: the same agent must EVADE while carrying
and PURSUE while chasing, and the best evasion is unpredictable - exactly where
a stochastic (policy-gradient) policy beats a deterministic one.

Round-5 specifics that live here: the opponent-aware observation vector, the
grab / steal / capture state machine, the potential-based shaping toward the
current objective, the crate/weapon/airship step ordering, and the panel's
airship dials (``set_ctf_dynamics``).
"""

import math
import time

import numpy as np

from core.continuous_arena import ContinuousArena, AGENT_R, N_ACTIONS

from .weapons import (CtfWeaponsMixin, WEAPONS, SHELL_SPEED,
                      CRATE_R, SHELL_R, TRAP_R, STUN_SECONDS_WEAPON,
                      BOWSER_OBJ_R, BOWSER_FIRST_THROW, CRATE_FIRST_SECONDS)

# Per-episode cap. A TRAINED game resolves in ~300-900 steps, so a bigger cap gives no
# viewing benefit - it only matters for UNTRAINED / timeout episodes early in training.
# And a big cap HURTS the per-episode learners (REINFORCE, Actor-Critic update ONCE per
# episode, so a 3x-longer episode = 3x fewer updates per unit time, i.e. ~3x slower to
# learn in wall-clock; PPO is unaffected, it updates per horizon). 1500 covers close /
# learning-phase games with margin while keeping the MC learners quick. Live-tunable
# from the panel's Max-steps control (raise it for watching long trained games).
CTF_MAX_STEPS = 1500
FLAG_R = 0.75               # reach for grabbing the FREE flag at the pole
TAG_R = 0.95                # chaser's tag reach vs the carrier (the steal)
HOME_R = 1.5                # distance to your own base that CAPTURES (scores) the flag
CARRY_SLOW = 0.72           # the carrier is slowed, so a chase can actually resolve
# A robbed carrier is FROZEN this long. It must be long enough that the thief (who is
# now slowed by CARRY_SLOW) actually gets away, or the victim just re-steals the instant
# it recovers (a hot-potato). 1.5 s frees the thief by ~7 units before the chase resumes.
STUN_SECONDS = 1.5
CAPTURES_TO_WIN = 3
CTF_EVENT_HOLD_SECONDS = 0.9
# per-side reward structure (event rewards fire once; shaping telescopes)
CTF_STEP_COST = 0.002       # gentle nudge to finish rather than stall
GRAB_REWARD = 0.15          # first touch of the loose flag
STEAL_REWARD = 0.40         # tagging the enemy carrier and taking the flag
TAGGED_PENALTY = -0.40      # losing the flag to a tag
CAPTURE_REWARD = 1.00       # delivering a flag to your base
CONCEDE_PENALTY = -0.30     # the rival captured one
CTF_WIN, CTF_LOSE = 2.0, -2.0
# potential-based shaping toward the CURRENT relevant target (flag / base / carrier).
# PBRS (difference of potentials) telescopes over a segment, so it cannot be farmed.
CTF_SHAPE_COEF = 0.02

USE_ACTION = 9                          # the 10th action: fire the held weapon
CTF_N_ACTIONS = 10                      # 8 thrusts + coast + use

# obs: self kin 4 + opp rel pos/vel 4 + flag rel 2 + flag flags 3 + base vecs 4
# + carrying 1 + my/opp stun 2 + capture diff 1 + 2 crates x(present,rel x/z) 6
# + my weapon one-hot(5) + opp-armed 1 + 2 shells x(present,rel x/z,vel x/z) 10
# + 2 traps x(present,rel x/z,is-oil) 8 + 3 hazards x(present,rel x/z,vel x/z) 15
OBS_CRATE_SLOTS = 2
OBS_SHELL_SLOTS = 2
OBS_TRAP_SLOTS = 2
OBS_HAZARD_SLOTS = 3                    # nearest thrown Bowser objects fed to the policy
CTF_OBS_DIM = (4 + 4 + 2 + 3 + 4 + 1 + 2 + 1 + OBS_CRATE_SLOTS * 3
               + len(WEAPONS) + 1 + OBS_SHELL_SLOTS * 5 + OBS_TRAP_SLOTS * 4
               + OBS_HAZARD_SLOTS * 5)   # 66


class CtfArena(CtfWeaponsMixin, ContinuousArena):
    """Round 5: Capture the Flag with crate weapons and Bowser's airship."""

    ctf_game = True
    max_steps = CTF_MAX_STEPS
    n_actions = CTF_N_ACTIONS   # 8 thrusts + coast + USE the held weapon
    obs_dim = CTF_OBS_DIM

    def _init_round_state(self):
        # bases at OPPOSITE corners (a diagonal contest); each agent spawns on its
        # own base and the flag spawns dead centre.
        self.red_base = np.array(
            [self.arena - 2.5, self.arena - 2.5], dtype=np.float32)   # bottom-right
        self.blue_base = np.array([2.5, 2.5], dtype=np.float32)       # top-left
        self.red_spawn = (float(self.red_base[0]), float(self.red_base[1]))
        self.blue_spawn = (float(self.blue_base[0]), float(self.blue_base[1]))
        self.flag_pos = np.array(
            [self.arena / 2, self.arena / 2], dtype=np.float32)
        self.flag_holder = None
        self.captures = {"red": 0, "blue": 0}
        self.stun = {"red": 0, "blue": 0}
        self.weapon = {"red": None, "blue": None}    # held weapon (1-slot inventory)
        self.facing = {"red": math.pi, "blue": math.pi}  # last heading (shell aim)
        self.chains = []                             # in-flight / reeling chain-chomps
        self.shells = []                             # in-flight projectiles
        self.traps = []                              # laid bananas / oil
        self.hazards = []                            # objects Bowser has thrown
        self.crates = []
        self.ctf_events = []
        self._crate_serial = 0
        self._shell_serial = 0
        self._trap_serial = 0
        self._chain_serial = 0
        self._hazard_serial = 0
        # Bowser's ship slides side to side at the north edge; ship_x is the throw
        # origin (and drives the frontend airship). ship_phase advances each step.
        self.ship_phase = 0.0
        self.ship_x = self.arena / 2
        self.next_throw_step = self._seconds_to_steps(BOWSER_FIRST_THROW)
        self._ctf_event_serial = 0
        self.next_crate_step = self._seconds_to_steps(CRATE_FIRST_SECONDS)

    def _game_mode(self):
        return "captureFlag"

    # ----------------------------------------------------------------- reset
    def _reset_round_state(self, regenerate):
        self.flag_pos = np.array(
            [self.arena / 2, self.arena / 2], dtype=np.float32)
        self.flag_holder = None
        self.captures = {"red": 0, "blue": 0}
        self.stun = {"red": 0, "blue": 0}
        self.weapon = {"red": None, "blue": None}
        self.facing = {"red": math.pi, "blue": math.pi}
        self.chains = []
        self.shells = []
        self.traps = []
        self.hazards = []
        self.crates = []
        self.ctf_events = []
        self._chain_serial = 0
        self._hazard_serial = 0
        self.ship_phase = 0.0
        self.ship_x = self.arena / 2
        self.next_throw_step = self._seconds_to_steps(BOWSER_FIRST_THROW)
        self.next_crate_step = self._seconds_to_steps(CRATE_FIRST_SECONDS)

    # ---------------------------------------------------------- panel dials
    def set_ctf_dynamics(self, bowser_throw_count=None, bowser_obj_speed=None,
                         agent_sight=None, bowser_interval=None):
        """Live-tune Bowser's airship from the panel (None = unchanged):
        how many objects it hurls per throw, how fast they fly, how OFTEN it fires, and
        how far ahead the agents can SEE incoming objects. throw_count = 0 turns it off."""
        if bowser_throw_count is not None:
            self.bowser_throw_count = max(0, min(6, int(bowser_throw_count)))
        if bowser_obj_speed is not None:
            self.bowser_obj_speed = max(0.5, float(bowser_obj_speed))
        if bowser_interval is not None:
            self.bowser_interval = max(0.5, float(bowser_interval))
            # feel it immediately: never wait longer than the NEW interval for the
            # next shot (so dragging the slider down fires sooner right away)
            if self.ctf_game:
                self.next_throw_step = min(
                    self.next_throw_step,
                    self.steps + self._seconds_to_steps(self.bowser_interval))
        if agent_sight is not None:
            self.agent_sight = max(1.0, float(agent_sight))

    # --------------------------------------------------------------- helpers
    def _base(self, which):
        return self.red_base if which == "red" else self.blue_base

    def _flag_world_pos(self):
        """Where the flag physically IS: on its carrier, else at the pole."""
        if self.flag_holder == "red":
            return self.red_pos
        if self.flag_holder == "blue":
            return self.blue_pos
        return self.flag_pos

    def _movement_mult(self, side):
        """Speed multiplier + frozen flag: carrying slows you; a stun freezes you
        in place."""
        mult = CARRY_SLOW if self.flag_holder == side else 1.0
        return mult, self.stun[side] > 0

    def _ctf_potential(self, side, posmap, holder0, flag0):
        """PBRS potential = -distance to this side's relevant target, evaluated with
        the possession state as it was at the START of the step (holder0) so a step
        that CHANGES possession does not create a spurious shaping spike."""
        if holder0 == side:
            target = self._base(side)                     # deliver it home
        elif holder0 is None:
            target = flag0                                # race for the loose flag
        else:
            target = posmap[holder0]                      # chase the enemy carrier
        return -float(np.linalg.norm(posmap[side] - target))

    def _add_ctf_event(self, kind, side, pos, extra=None):
        self._ctf_event_serial += 1
        event = {
            "id": self._ctf_event_serial,
            "type": kind,                                 # grab|steal|capture|crate|chain|bomb
            "side": side,
            "pos": np.asarray(pos, dtype=np.float32).copy(),
            "expiresAt": time.monotonic() + CTF_EVENT_HOLD_SECONDS,
        }
        if extra:
            event.update(extra)
        self.ctf_events.append(event)
        self.ctf_events = self.ctf_events[-16:]

    def _age_ctf_events(self):
        now = time.monotonic()
        self.ctf_events = [
            e for e in self.ctf_events if e.get("expiresAt", 0.0) > now
        ]

    # ---------------------------------------------------------- observation
    def _observe_ctf(self, which, pos, vel):
        """Egocentric, opponent-aware observation. Exposes the rival, flag, bases and
        nearest crates, PLUS the held weapon, whether the rival is armed, and the
        nearest in-flight shells + laid traps to dodge."""
        A = self.arena
        opp = "blue" if which == "red" else "red"
        opp_pos = self.blue_pos if opp == "blue" else self.red_pos
        opp_vel = self.blue_vel if opp == "blue" else self.red_vel
        flag = self._flag_world_pos()
        my_base = self._base(which)
        opp_base = self._base(opp)
        free = 1.0 if self.flag_holder is None else 0.0
        mine = 1.0 if self.flag_holder == which else 0.0
        theirs = 1.0 if self.flag_holder == opp else 0.0
        stun_ref = max(1, self._seconds_to_steps(STUN_SECONDS))
        cap_diff = (self.captures[which] - self.captures[opp]) / float(CAPTURES_TO_WIN)
        out = [
            float(pos[0]) / A, float(pos[1]) / A,
            float(vel[0]) / self.vmax, float(vel[1]) / self.vmax,
            (float(opp_pos[0]) - float(pos[0])) / A,
            (float(opp_pos[1]) - float(pos[1])) / A,
            float(opp_vel[0]) / self.vmax, float(opp_vel[1]) / self.vmax,
            (float(flag[0]) - float(pos[0])) / A,
            (float(flag[1]) - float(pos[1])) / A,
            free, mine, theirs,
            (float(my_base[0]) - float(pos[0])) / A,
            (float(my_base[1]) - float(pos[1])) / A,
            (float(opp_base[0]) - float(pos[0])) / A,
            (float(opp_base[1]) - float(pos[1])) / A,
            mine,                                     # explicit "am I carrying?"
            min(1.0, self.stun[which] / stun_ref),
            min(1.0, self.stun[opp] / stun_ref),
            float(np.clip(cap_diff, -1.0, 1.0)),
        ]
        # the OBS_CRATE_SLOTS nearest crates (present, relative x/z)
        near = sorted(self.crates,
                      key=lambda c: float(np.linalg.norm(c["pos"] - pos)))
        for i in range(OBS_CRATE_SLOTS):
            if i < len(near):
                rel = near[i]["pos"] - pos
                out.extend([1.0,
                            float(np.clip(rel[0] / A, -1, 1)),
                            float(np.clip(rel[1] / A, -1, 1))])
            else:
                out.extend([0.0, 0.0, 0.0])
        # my held weapon (one-hot over WEAPONS; all 0 = empty) + is the rival armed?
        held = self.weapon[which]
        out.extend([1.0 if held == w else 0.0 for w in WEAPONS])
        out.append(1.0 if self.weapon[opp] is not None else 0.0)
        # nearest in-flight shells (present, rel x/z, vel x/z) - to dodge
        shells = sorted(self.shells,
                        key=lambda s: float(np.linalg.norm(s["pos"] - pos)))
        for i in range(OBS_SHELL_SLOTS):
            if i < len(shells):
                s = shells[i]
                rel = s["pos"] - pos
                out.extend([1.0,
                            float(np.clip(rel[0] / A, -1, 1)),
                            float(np.clip(rel[1] / A, -1, 1)),
                            float(s["vel"][0]) / SHELL_SPEED,
                            float(s["vel"][1]) / SHELL_SPEED])
            else:
                out.extend([0.0, 0.0, 0.0, 0.0, 0.0])
        # nearest laid traps (present, rel x/z, is-oil) - to avoid
        traps = sorted(self.traps,
                       key=lambda tr: float(np.linalg.norm(tr["pos"] - pos)))
        for i in range(OBS_TRAP_SLOTS):
            if i < len(traps):
                tr = traps[i]
                rel = tr["pos"] - pos
                out.extend([1.0,
                            float(np.clip(rel[0] / A, -1, 1)),
                            float(np.clip(rel[1] / A, -1, 1)),
                            1.0 if tr["kind"] == "oil" else 0.0])
            else:
                out.extend([0.0, 0.0, 0.0, 0.0])
        # nearest thrown Bowser objects WITHIN agent_sight (present, rel x/z, vel x/z),
        # so the agent can SEE incoming objects up to `agent_sight` metres away + dodge
        near_haz = sorted(
            (h for h in self.hazards
             if float(np.linalg.norm(h["pos"] - pos)) <= self.agent_sight),
            key=lambda h: float(np.linalg.norm(h["pos"] - pos)))
        for i in range(OBS_HAZARD_SLOTS):
            if i < len(near_haz):
                h = near_haz[i]
                rel = h["pos"] - pos
                out.extend([1.0,
                            float(np.clip(rel[0] / A, -1, 1)),
                            float(np.clip(rel[1] / A, -1, 1)),
                            float(h["vel"][0]) / max(1e-3, self.bowser_obj_speed),
                            float(h["vel"][1]) / max(1e-3, self.bowser_obj_speed)])
            else:
                out.extend([0.0, 0.0, 0.0, 0.0, 0.0])
        assert len(out) == CTF_OBS_DIM
        return np.asarray(out, dtype=np.float32)

    def _observe(self, which, pos, vel):
        return self._observe_ctf(which, pos, vel)

    # ------------------------------------------------------------------ step
    def step(self, a_red, a_blue):
        if self.done:
            raise RuntimeError("step() on a finished episode")
        self.steps += 1
        return self._step_ctf_game(a_red, a_blue)

    def _step_ctf_game(self, a_red, a_blue):
        """One CTF decision step. Order: age timers -> spawn crates -> USE weapons ->
        move (carrier slowed / stunned frozen) -> resolve grab/capture/steal -> pick up
        crates -> advance shells + traps (resolve hits) -> shape -> check win/timeout.
        Instant-steal + first-to-3-captures."""
        self._age_ctf_events()
        for side in ("red", "blue"):
            self.stun[side] = max(0, self.stun[side] - 1)
        self._advance_crate_spawns()
        reward = {"red": -CTF_STEP_COST, "blue": -CTF_STEP_COST}

        # the 10th action (USE_ACTION) fires the held weapon; that agent coasts this
        # step and cannot fire while stunned.
        acts = {"red": a_red, "blue": a_blue}
        for side in ("red", "blue"):
            if acts[side] == USE_ACTION:
                if self.stun[side] <= 0:
                    self._use_weapon(side, reward)
                acts[side] = N_ACTIONS - 1               # coast while firing

        # possession + free-flag position as they were at the START of the step, so
        # PBRS shaping uses one consistent target basis across the move.
        holder0 = self.flag_holder
        flag0 = self.flag_pos.copy()
        old = {"red": self.red_pos.copy(), "blue": self.blue_pos.copy()}
        old_pot = {
            side: self._ctf_potential(side, old, holder0, flag0)
            for side in ("red", "blue")
        }

        # integrate: the carrier is slowed; a stunned agent is frozen in place
        red_mult, red_frozen = self._movement_mult("red")
        blue_mult, blue_frozen = self._movement_mult("blue")
        self.red_pos, self.red_vel = self._integrate(
            self.red_pos, self.red_vel, acts["red"], red_mult, red_frozen)
        self.blue_pos, self.blue_vel = self._integrate(
            self.blue_pos, self.blue_vel, acts["blue"], blue_mult, blue_frozen)
        # remember each heading (for aiming green shells / dropping traps behind)
        for side, v in (("red", self.red_vel), ("blue", self.blue_vel)):
            if float(np.linalg.norm(v)) > 0.05:
                self.facing[side] = math.atan2(float(v[1]), float(v[0]))
        # advance any thrown chain-chomps: fly the head out, then (on contact) reel the
        # rival in - overrides its frozen position so snapshots show it sliding in
        self._advance_chains(reward)

        winner_side = None
        if self.flag_holder is None:
            # GRAB: the nearer un-stunned agent within reach of the loose flag takes it.
            contenders = []
            for side, p in (("red", self.red_pos), ("blue", self.blue_pos)):
                if self.stun[side] > 0:
                    continue
                d = float(np.linalg.norm(p - self.flag_pos))
                if d <= FLAG_R + AGENT_R:
                    contenders.append((d, side))
            if contenders:
                contenders.sort()
                if (len(contenders) > 1
                        and abs(contenders[0][0] - contenders[1][0]) < 1e-6):
                    grabber = self.rng.choice([c[1] for c in contenders])
                else:
                    grabber = contenders[0][1]
                self.flag_holder = grabber
                reward[grabber] += GRAB_REWARD
                self._add_ctf_event("grab", grabber, self.flag_pos)
        else:
            holder = self.flag_holder
            other = "blue" if holder == "red" else "red"
            holder_pos = self.red_pos if holder == "red" else self.blue_pos
            other_pos = self.red_pos if other == "red" else self.blue_pos
            # CAPTURE has priority: reaching your own base scores + respawns the flag.
            if float(np.linalg.norm(holder_pos - self._base(holder))) <= HOME_R:
                self.captures[holder] += 1
                reward[holder] += CAPTURE_REWARD
                reward[other] += CONCEDE_PENALTY
                self._add_ctf_event("capture", holder, holder_pos)
                self.flag_holder = None
                self.flag_pos = np.array(
                    [self.arena / 2, self.arena / 2], dtype=np.float32)
                if self.captures[holder] >= CAPTURES_TO_WIN:
                    winner_side = holder
            elif (self.stun[other] <= 0
                    and float(np.linalg.norm(other_pos - holder_pos))
                    <= TAG_R + AGENT_R):
                # INSTANT STEAL: the chaser tags the carrier and takes the flag; the
                # robbed carrier is briefly stunned so it cannot instantly re-steal.
                self.flag_holder = other
                self.stun[holder] = self._seconds_to_steps(STUN_SECONDS)
                reward[other] += STEAL_REWARD
                reward[holder] += TAGGED_PENALTY
                self._add_ctf_event("steal", other, holder_pos)

        # SMASH any crate an agent reached this step -> a random held weapon
        self._resolve_crates(reward)
        # advance in-flight shells + laid traps, resolving any hits (stun / knockback)
        self._advance_shells(reward)
        self._advance_traps(reward)
        # Bowser's airship: slide + throw objects at the board; stun on contact
        self._advance_bowser(reward)

        # dense potential-based shaping toward the step-start target (telescopes)
        new = {"red": self.red_pos, "blue": self.blue_pos}
        for side in ("red", "blue"):
            new_pot = self._ctf_potential(side, new, holder0, flag0)
            reward[side] += CTF_SHAPE_COEF * (new_pot - old_pot[side])

        truncated = False
        if winner_side is not None:
            self.done = True
            self.winner = winner_side
            loser = "blue" if winner_side == "red" else "red"
            reward[winner_side] += CTF_WIN
            reward[loser] += CTF_LOSE
        elif self.steps >= self.max_steps:
            self.done = True
            truncated = True
            if self.captures["red"] > self.captures["blue"]:
                self.winner = "red"
                reward["red"] += CTF_WIN
                reward["blue"] += CTF_LOSE
            elif self.captures["blue"] > self.captures["red"]:
                self.winner = "blue"
                reward["blue"] += CTF_WIN
                reward["red"] += CTF_LOSE
            else:
                self.winner = None

        obs = (self._observe("red", self.red_pos, self.red_vel),
               self._observe("blue", self.blue_pos, self.blue_vel))
        return obs, reward, self.done, truncated, {
            "winner": self.winner,
            "captures": dict(self.captures),
            "flagHolder": self.flag_holder,
        }

    # --------------------------------------------------------------- viewer
    def to_json(self):
        out = super().to_json()
        out["ctf"] = {
            "capturesToWin": CAPTURES_TO_WIN,
            "flagRadius": FLAG_R,
            "tagRadius": TAG_R,
            "homeRadius": HOME_R,
            "carrySlow": CARRY_SLOW,
            "stunSeconds": STUN_SECONDS,
            "flagSpawn": [self.arena / 2, self.arena / 2],
            "crateRadius": CRATE_R,
            "weapons": list(WEAPONS),
            "shellRadius": SHELL_R,
            "trapRadius": TRAP_R,
            "weaponStunSeconds": STUN_SECONDS_WEAPON,
            "bases": {
                "red": [float(self.red_base[0]), float(self.red_base[1])],
                "blue": [float(self.blue_base[0]), float(self.blue_base[1])],
            },
            "bowser": {
                "throwCount": int(self.bowser_throw_count),
                "objSpeed": round(float(self.bowser_obj_speed), 2),
                "objRadius": BOWSER_OBJ_R,
                "throwInterval": round(float(self.bowser_interval), 2),
                "shipZ": -2.0,
                "agentSight": round(float(self.agent_sight), 2),
            },
        }
        return out

    def snapshot(self):
        # Also expires live-only events while paused or after a target-episode
        # stop, where no environment step would otherwise age them.
        self._age_ctf_events()
        out = super().snapshot()
        rd = lambda v: [round(float(v[0]), 3), round(float(v[1]), 3)]  # noqa: E731
        out.update({
            "captures": dict(self.captures),
            "capturesToWin": CAPTURES_TO_WIN,
            "flag": {
                "pos": rd(self._flag_world_pos()),
                "holder": self.flag_holder,
                "radius": FLAG_R,
            },
            "bases": {"red": rd(self.red_base), "blue": rd(self.blue_base)},
            "homeR": HOME_R,
            "stun": {
                side: round(self.stun[side] * self.dt, 2)
                for side in ("red", "blue")
            },
            "weapons": {side: self.weapon[side] for side in ("red", "blue")},
            "crates": [
                {"id": c["id"], "pos": rd(c["pos"]), "radius": CRATE_R}
                for c in sorted(self.crates, key=lambda c: c["id"])
            ],
            "chains": [
                {"id": ch["id"], "owner": ch["owner"], "target": ch["target"],
                 "phase": ch["phase"], "head": rd(ch["head"])}
                for ch in sorted(self.chains, key=lambda ch: ch["id"])
            ],
            "ship": {"x": round(float(self.ship_x), 3), "z": -2.0},
            "hazards": [
                {"id": h["id"], "kind": h["kind"], "pos": rd(h["pos"]),
                 "vel": rd(h["vel"]), "radius": BOWSER_OBJ_R}
                for h in sorted(self.hazards, key=lambda h: h["id"])
            ],
            "shells": [
                {"id": s["id"], "owner": s["owner"], "kind": s["kind"],
                 "pos": rd(s["pos"]), "vel": rd(s["vel"]), "radius": SHELL_R}
                for s in sorted(self.shells, key=lambda s: s["id"])
            ],
            "traps": [
                {"id": t["id"], "owner": t["owner"], "kind": t["kind"],
                 "pos": rd(t["pos"]), "radius": TRAP_R}
                for t in sorted(self.traps, key=lambda t: t["id"])
            ],
            "ctfEvents": [
                {"id": e["id"], "type": e["type"], "side": e["side"],
                 "pos": rd(e["pos"]),
                 **({"weapon": e["weapon"]} if "weapon" in e else {}),
                 **({"kind": e["kind"]} if "kind" in e else {}),
                 **({"target": e["target"]} if "target" in e else {})}
                for e in self.ctf_events
            ],
        })
        return out
