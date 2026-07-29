"""Round-4 DQN checkpoint persistence (a Match mixin).

The deep survival round trains slowly, so its learning is periodically saved to
``checkpoints/round4_dqn.pt`` and restored on the next visit. A checkpoint is
validated against the schema version, the TRAINING REVISION (bumped whenever
the meaning of Round-4 experience changes, e.g. a new observation layout), the
env dimensions and the algorithm matchup; anything incompatible is rejected and
the agents simply retrain from scratch. File I/O lives with the torch code in
``arenas/r4_ruined_kingdom/dqn.py`` and is imported lazily here.
"""

import os

from core.registry import is_dqn

DQN_CHECKPOINT_SCHEMA = 2

DQN_CHECKPOINT_INTERVAL = 25

DQN_CHECKPOINT_NAME = "round4_dqn.pt"

# This revision tracks the meaning of Round 4's experience, independently of the
# on-disk container format. Revision 6 adds ENDLESS ESCALATION (missiles + pickups
# grow with survival time, no 3-cap) and a wider observation (6 nearest missiles +
# 3 nearest pickups + the mercy-invuln timer). The observation dimension changed, so
# an older checkpoint is rejected on both counts and agents retrain from scratch.
ROUND4_TRAINING_REVISION = 8


class CheckpointMixin:
    """Round-4 checkpoint save / load / delete, mixed into Match."""


    # ---------------------------------------------------------- DQN checkpoint
    def _checkpoint_eligible(self):
        return (
            self._is_round4_missile()
            and is_dqn(self.algo_red)
            and is_dqn(self.algo_blue)
            and hasattr(self.red, "checkpoint_state")
            and hasattr(self.blue, "checkpoint_state")
        )


    def _checkpoint_payload(self):
        return {
            "schemaVersion": DQN_CHECKPOINT_SCHEMA,
            "trainingRevision": ROUND4_TRAINING_REVISION,
            "roundId": 4,
            "obsDim": int(self.env.obs_dim),
            "nActions": int(self.env.n_actions),
            "algorithms": {"red": self.algo_red, "blue": self.algo_blue},
            "episode": int(self.episode),
            "totalSteps": int(self.total_steps),
            "agents": {
                "red": self.red.checkpoint_state(),
                "blue": self.blue.checkpoint_state(),
            },
        }


    def save_checkpoint(self, force=True):
        """Persist Round-4 DQN learning; return True only when a file was written."""
        with self.lock:
            if not self._checkpoint_eligible():
                self.checkpoint_status = "not-applicable"
                return False
            if not force and (
                self.episode <= 0
                or self.episode % DQN_CHECKPOINT_INTERVAL
                or self.episode == self._last_checkpoint_episode
            ):
                return False
            try:
                # lazy: the checkpoint I/O lives with the R4 torch code
                from arenas.r4_ruined_kingdom.dqn import save_checkpoint_file
                save_checkpoint_file(self.checkpoint_path, self._checkpoint_payload())
            except Exception as exc:
                self.checkpoint_status = "save-error"
                self.checkpoint_error = f"{type(exc).__name__}: {exc}"
                return False
            self._last_checkpoint_episode = int(self.episode)
            self.checkpoint_episode = int(self.episode)
            self.checkpoint_status = "saved"
            self.checkpoint_error = None
            return True


    def _load_checkpoint(self):
        """Load one compatible Round-4 checkpoint, leaving fresh agents on error."""
        if not self._checkpoint_eligible():
            self.checkpoint_status = "not-applicable"
            self.checkpoint_error = None
            return False

        from arenas.r4_ruined_kingdom.dqn import load_checkpoint_file
        payload, error = load_checkpoint_file(self.checkpoint_path)
        if error is not None:
            self.checkpoint_status = "missing" if error == "missing" else "corrupt"
            self.checkpoint_error = None if error == "missing" else error
            return False

        try:
            if int(payload.get("schemaVersion", -1)) != DQN_CHECKPOINT_SCHEMA:
                raise ValueError(
                    f"schemaVersion mismatch (expected {DQN_CHECKPOINT_SCHEMA})")
            if int(payload.get("trainingRevision", -1)) != ROUND4_TRAINING_REVISION:
                raise ValueError(
                    "trainingRevision mismatch "
                    f"(expected {ROUND4_TRAINING_REVISION})")
            if int(payload.get("roundId", -1)) != 4:
                raise ValueError("roundId mismatch")
            if int(payload.get("obsDim", -1)) != int(self.env.obs_dim):
                raise ValueError("obsDim mismatch")
            if int(payload.get("nActions", -1)) != int(self.env.n_actions):
                raise ValueError("nActions mismatch")
            expected_algos = {"red": self.algo_red, "blue": self.algo_blue}
            if payload.get("algorithms") != expected_algos:
                raise ValueError("algorithms mismatch")
            episode = int(payload["episode"])
            total_steps = int(payload.get("totalSteps", 0))
            if episode < 0 or total_steps < 0:
                raise ValueError("negative progress counter")
            agents = payload["agents"]
            if not isinstance(agents, dict):
                raise ValueError("agents is not a dict")
            # Prepare both sides before mutating either one.
            red_state = self.red.prepare_checkpoint_state(agents["red"])
            blue_state = self.blue.prepare_checkpoint_state(agents["blue"])
        except Exception as exc:
            self.checkpoint_status = "incompatible"
            self.checkpoint_error = f"{type(exc).__name__}: {exc}"
            return False

        self.red.apply_checkpoint_state(red_state)
        self.blue.apply_checkpoint_state(blue_state)
        self.episode = episode
        self.total_steps = total_steps
        self._last_checkpoint_episode = episode
        self.checkpoint_episode = episode
        self.checkpoint_status = "loaded"
        self.checkpoint_error = None
        return True


    def delete_checkpoint(self):
        """Delete saved Round-4 learning for an explicit wipe-learning control."""
        with self.lock:
            try:
                if os.path.exists(self.checkpoint_path):
                    os.remove(self.checkpoint_path)
            except OSError as exc:
                self.checkpoint_status = "delete-error"
                self.checkpoint_error = f"{type(exc).__name__}: {exc}"
                return False
            self._last_checkpoint_episode = -1
            self.checkpoint_episode = 0
            self.checkpoint_status = "deleted"
            self.checkpoint_error = None
            return True
