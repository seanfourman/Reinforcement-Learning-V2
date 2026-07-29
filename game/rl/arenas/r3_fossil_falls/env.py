"""Round 3's environment mechanics: the Goomba-patrolled maze race.

On top of the shared grid engine, Fossil Falls adds the moving-hazard timing
game that makes it a TEMPORAL-DIFFERENCE problem:

  * GOOMBAS patrol their cell lists back and forth DETERMINISTICALLY, so each
    Goomba's position is a pure function of the step count. Sharing a Goomba's
    cell (or swapping straight through one) is death. The state carries
    ``steps % phase_period`` so avoiding the MOVING hazard stays Markov;
  * a 5th action, STAY, lets a racer wait a beat to time a patrol;
  * WET cells (shared ``slip`` cells) can skid a move sideways with
    ``r3_slip_prob`` - the variance that lets one racer fall behind;
  * an off-route CAGE pickup per side: grab YOURS to freeze the rival for
    ``cage_len`` steps (a catch-up tool; the bonus is paid only when BEHIND);
  * an optional PRESSURE-PLATE puzzle per side: shove your boulder onto your
    plate to open a sealed SECRET-DOOR shortcut for the rest of the episode.

Death/finish resolution reuses the engine's independent-racer machinery
(``hazardous``), exactly like Round 2.
"""

from core.grid_env import GridWorld, ACTIONS, MOVE_ACTIONS, N_ACTIONS, PERP

from . import world

# --- Round-3 game mechanics (defaults; live-tunable from the panel) ----------
R3_SLIP_PROB = 0.20    # WET-cell skid chance (variance so one racer falls behind)
CAGE_LEN = 6           # steps the RIVAL is frozen after you grab your cage pickup
CAGE_REWARD = 0.2      # shaping bonus for grabbing your cage, ONLY paid when you are
                       # BEHIND (rival closer to the goal). Position-gating the reward is what
                       # makes the agent learn the CONDITIONAL policy - detour for the cage to
                       # catch up when behind, skip it when ahead - instead of always grabbing.


class FossilFallsEnv(GridWorld):
    """The Goomba maze: patrols + wet skids + cages + plate puzzles on the engine."""

    r3_slip_prob = R3_SLIP_PROB   # live-tunable skid chance (module constant default)
    cage_reward = CAGE_REWARD     # live-tunable cage grab bonus
    cage_len = CAGE_LEN           # live-tunable cage freeze duration (turns)

    def _generate(self, seed):
        return world.generate(seed, **self.gen_cfg)

    # ---------------------------------------------------------------- install
    def _install_features(self, w):
        """Parse the patrols, the bridge choke, the per-agent cage pickups and the
        pressure-plate puzzles; expose the extra STAY action."""
        self.goombas = [{"cells": [tuple(c) for c in gb["cells"]],
                         "phase0": int(gb.get("phase0", 0))}
                        for gb in getattr(w, "goombas", [])]
        self.bridge = {tuple(b) for b in getattr(w, "bridge", [])}
        # cage pickups: each agent's OWN cell (grabbing it cages the RIVAL).
        rc = getattr(w, "red_cage", []) or []
        bc = getattr(w, "blue_cage", []) or []
        self.cage_cell = {"red": tuple(rc[0]) if rc else None,
                          "blue": tuple(bc[0]) if bc else None}
        # PRESSURE-PLATE puzzles (mirror pair). The LEFT puzzle (door col < MID) is
        # BLUE's, the right is RED's. Push YOUR boulder onto YOUR plate to unlock YOUR
        # secret door (a sealed shortcut), held open the rest of the episode. Boulder
        # position lives in the state as ONE bit (door open?), so it stays tabular-Markov.
        self.puzzle = {"red": None, "blue": None}
        for p in (getattr(w, "plate_puzzles", []) or []):
            door, plate = tuple(p["door"]), tuple(p["plate"])
            boulder = tuple(p["boulder"])
            side = "blue" if door[1] < self.W // 2 else "red"
            self.puzzle[side] = {"door": door, "plate": plate, "boulder_start": boulder}
        self.boulder_pos = {a: (self.puzzle[a]["boulder_start"] if self.puzzle[a] else None)
                            for a in ("red", "blue")}
        self.door_open = {"red": False, "blue": False}
        self.goomba_mode = bool(self.goombas)
        # expose the extra STAY action so agents can wait out a patrol (the engine
        # finalizes the action space from n_actions after this hook returns)
        self.n_actions = N_ACTIONS + (1 if self.goomba_mode else 0)
        if self.goomba_mode:
            self.hazardous = True     # reuse the independent-racer death/finish path

            def _gcd(a, b):
                while b:
                    a, b = b, a % b
                return a
            # the shared patrol cycle: every Goomba's position repeats on the LCM
            # of the individual back-and-forth periods (this is the state's phase)
            periods = [2 * (len(gb["cells"]) - 1) if len(gb["cells"]) > 1 else 1
                       for gb in self.goombas] or [1]
            lcm = 1
            for p in periods:
                lcm = lcm * p // _gcd(lcm, p)
            self._phase_period = max(1, lcm)

    def _goomba_positions(self, step):
        """Deterministic Goomba cells at ``step`` - a triangle wave along each patrol."""
        out = []
        for gb in self.goombas:
            cells = gb["cells"]
            n = len(cells)
            if n <= 1:
                out.append(cells[0] if cells else None)
                continue
            period = 2 * (n - 1)
            t = (step + gb["phase0"]) % period
            out.append(cells[t if t < n else period - t])
        return out

    # ------------------------------------------------------------------ reset
    def _reset_round_state(self):
        # cages: has each agent still got its pickup to grab, and how many more
        # steps each is frozen inside a dropped cage (0 = free). Reset every episode.
        self.cage_taken = {"red": False, "blue": False}
        self.caged = {"red": 0, "blue": 0}
        # pressure-plate puzzles: boulder back to its start, doors sealed again.
        self.boulder_pos = {a: (self.puzzle[a]["boulder_start"] if self.puzzle[a] else None)
                            for a in ("red", "blue")}
        self.door_open = {"red": False, "blue": False}

    # -------------------------------------------------------- tunable dynamics
    def _set_round_dynamics(self, *, cage_reward=None, cage_len=None, **_unused):
        self.cage_reward = self._pick(self.cage_reward, cage_reward, 0.0, 2.0)
        self.cage_len = int(self._pick(self.cage_len, cage_len, 1, 15))
        return False

    # ------------------------------------------------------------ observation
    def full_state(self, agent, cell):
        # (cell, patrol phase, rival flag, door bit): the phase makes the moving
        # Goombas predictable, the rival flag enables the conditional cage policy,
        # and the door bit tracks the (permanent) secret-door unlock.
        if not self.goomba_mode:
            return super().full_state(agent, cell)
        return (self.pos_index[cell], self.steps % self._phase_period,
                self._rival_flag(agent, cell),
                1 if self.door_open.get(agent) else 0)

    def _rival_flag(self, agent, cell):
        """Compact state factor (0..5) = rival PROGRESS x my CAGE readiness.
        Progress: is the rival ahead / level / behind me toward the goal (row proxy).
        Cage: is my cage pickup still available to grab. Together they let the agent
        learn to detour for the cage when it is behind, and rush once it is ahead."""
        rival = "blue" if agent == "red" else "red"
        rv_row = self._pos(rival)[0]
        ahead = 2 if rv_row < cell[0] else (0 if rv_row > cell[0] else 1)  # lower row = closer
        cage_ready = 0 if self.cage_taken.get(agent, True) else 1
        return ahead * 2 + cage_ready

    # ------------------------------------------------------------------- step
    def _resolve_order(self, a_red, a_blue):
        """A fair resolve order for the bridge choke: the racer nearer the goal
        moves first (alternating on ties). Also freezes this tick's Goomba cells
        (current + previous, for swap-through deaths) for _advance_agent."""
        if not self.goomba_mode:
            return super()._resolve_order(a_red, a_blue)
        self._g_now_list = self._goomba_positions(self.steps)
        self._g_now = {p for p in self._g_now_list if p is not None}
        self._g_prev = self._goomba_positions(self.steps - 1)
        if self._pos("blue")[0] < self._pos("red")[0] or (
                self._pos("blue")[0] == self._pos("red")[0] and self.steps % 2 == 0):
            return (("blue", a_blue), ("red", a_red))
        return (("red", a_red), ("blue", a_blue))

    def _advance_agent(self, agent, act, reward, shape, dead, warped, dead_at,
                       warp_from):
        if not self.goomba_mode:
            return super()._advance_agent(agent, act, reward, shape, dead,
                                          warped, dead_at, warp_from)
        old = self._pos(agent)
        rival = "blue" if agent == "red" else "red"
        frozen = self.caged[agent] > 0         # locked in a dropped cage this tick
        self._slipped[agent] = False
        if frozen:
            nxt = old                          # cannot move while caged
        else:
            move = act
            # WET cell: a move may SKID to a perpendicular tile (like R1 ice / R2
            # puddles). This is the ROUND-3 variance that lets one racer fall behind.
            if act in MOVE_ACTIONS and old in self.slip_cells:
                r = self.rng.random()
                if r < self.r3_slip_prob:
                    p1, p2 = PERP[act]
                    move = p1 if r < self.r3_slip_prob * 0.5 else p2
                    self._slipped[agent] = True
            nxt = self._resolve(agent, old, move)  # walls block
            # PRESSURE-PLATE: shoving into YOUR boulder pushes it one cell onto the
            # plate, which unlocks YOUR secret door for the rest of the episode.
            bpos = self.boulder_pos.get(agent)
            if bpos is not None and nxt == bpos:
                pz = self.puzzle[agent]
                dr, dc = ACTIONS[move] if move in MOVE_ACTIONS else (0, 0)
                if move in MOVE_ACTIONS and (bpos[0] + dr, bpos[1] + dc) == pz["plate"]:
                    self.boulder_pos[agent] = pz["plate"]   # seat it -> door opens (permanent)
                    self.door_open[agent] = True
                else:
                    nxt = old                               # the boulder won't budge
            # a SEALED secret door blocks entry until this agent's plate is pressed
            pz = self.puzzle.get(agent)
            if pz is not None and nxt == pz["door"] and not self.door_open[agent]:
                nxt = old
            if not self._agent_done.get(rival, False) and nxt == self._pos(rival):
                nxt = old                      # can't enter the live rival's cell (bridge block)
        self._set_pos(agent, nxt)
        # grab YOUR OWN cage pickup on entry -> drop a cage on the rival
        if (not frozen and nxt == self.cage_cell.get(agent)
                and not self.cage_taken[agent]):
            self.cage_taken[agent] = True
            self.caged[rival] = self.cage_len
            # Pay the shaping bonus ONLY when you are BEHIND (rival closer to
            # the exit = lower row), so the detour is learned as a CATCH-UP move, not an
            # always-grab. Grabbing while ahead earns nothing (and wastes steps).
            if self._pos(rival)[0] < nxt[0]:
                reward[agent] += self.cage_reward
                shape[agent] += self.cage_reward
        # Goomba death - but a caged agent is SHIELDED (the cage protects it)
        die = (not frozen) and (nxt in self._g_now)
        if not die and not frozen:
            for gi, gp in enumerate(self._g_prev):   # swapped straight through a Goomba
                if gp is not None and nxt == gp and old == self._g_now_list[gi]:
                    die = True
                    break
        dead[agent] = "goomba" if die else None
        if die:
            dead_at[agent] = nxt
        if frozen:
            self.caged[agent] -= 1             # count the cage down

    # --------------------------------------------------------------- snapshot
    def snapshot(self):
        """Base frame + hazard FX cues (from the engine) + the live Goomba cells,
        cage state, and pressure-plate puzzle state."""
        snap = super().snapshot()
        if self.goomba_mode:
            # the live Goomba cells this tick (deterministic from steps), so the
            # theme can render + lerp them, and the bridge choke for a highlight.
            snap["goombas"] = [list(p) for p in self._goomba_positions(self.steps)
                               if p is not None]
            snap["bridge"] = [list(b) for b in self.bridge]
            # Cage pickups still on the board (drop out once grabbed), and who is caged
            # right now + for how many more ticks (drives the cage-drop FX + freeze hold).
            for a in ("red", "blue"):
                cell = self.cage_cell.get(a)
                snap[a + "Cage"] = ([list(cell)] if cell and not self.cage_taken[a] else [])
            snap["caged"] = {"red": int(self.caged["red"]), "blue": int(self.caged["blue"])}
            # Pressure-plate puzzles: static door/plate cells + the live boulder positions and
            # which doors are currently unlocked, so the theme can render the push + reveal.
            snap["platePuzzles"] = [
                {"side": a, "door": list(self.puzzle[a]["door"]),
                 "plate": list(self.puzzle[a]["plate"]),
                 "boulder": list(self.boulder_pos[a]), "open": bool(self.door_open[a])}
                for a in ("red", "blue") if self.puzzle[a]]
        return snap
