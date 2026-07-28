#!/usr/bin/env python3
"""Live RL server + static host for the Rival Minds arena.

Run with:  python serve.py

Serves the game (static files) AND runs the two independent models live in a
background thread, streaming the match to the browser over a tiny JSON API:

    GET  /api/snapshot          -> {worldVersion, frame, stats}     (poll ~30Hz)
    GET  /api/world             -> {worldVersion, world}            (on regenerate)
    GET  /api/values?agent=red  -> value heatmap V(s) per tile
    GET  /api/values?agent=red&cell=r,c -> per-action Q for one tile
    POST /api/control           -> {cmd: regenerate|reset|resetTournament|pause|play|speed|algo|awardRound, ...}

Third-party deps: numpy + gymnasium (always), plus PyTorch (imported lazily, only
for the DQN rounds 4-5). The browser is a pure viewer: it polls the snapshot and
renders the 3D scene.
"""
import http.server
import json
import mimetypes
import os
import sys
import threading
import time
import traceback
import webbrowser
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)                      # static files are served from game/
sys.path.insert(0, os.path.join(HERE, "rl"))

from match import Match             # noqa: E402  (after sys.path tweak)

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

# ---------------------------------------------------------------- training loop
# These module globals are written by HTTP handler threads and read by the trainer
# thread. Each is a single scalar assigned/read atomically (no read-modify-write),
# so a missing lock only means staleness of at most one loop iteration - harmless.
# Match's OWN state is the shared data that matters, and every access to it goes
# through match.lock.
match = Match(seed=None, round_id=1)
_speed = 60.0          # target sim steps per second (set via /api/control)
_paused = False
_replay_restore_paused = None  # live pause state saved while a replay owns the screen
_alive = True
_sync_hold_until = 0.0 # frontend world-load sync hold; independent of user pause
SYNC_HOLD_FALLBACK = 30.0


def trainer():
    """Drive the match at the requested speed. Slow = watch the walk; fast = many
    episodes fly by and the heatmap fills in. Batches at high speed so the HTTP
    handler thread stays responsive.

    A transient error in one tick (a rare env/agent edge state) must NOT kill this
    daemon thread - that would silently freeze the sim forever while the server
    keeps serving a stale frame. So the loop body is guarded: log once and keep
    going (with a short backoff so a hard-looping error can't spin the CPU)."""
    global _paused
    while _alive:
        try:
            if _paused or time.monotonic() < _sync_hold_until:
                time.sleep(0.03)
                continue
            # The panel already scales the speed for Round 4's fine 0.02 s step (it
            # sends 5x the raw steps/sec), so the trainer just honours the value.
            sp = _speed
            if sp <= 120:
                match.tick()
                time.sleep(1.0 / sp)
            else:
                batch = min(2000, int(sp / 60))
                for _ in range(batch):
                    match.tick()
                time.sleep(1.0 / 60)
        except Exception:
            traceback.print_exc()
            time.sleep(0.1)


# ------------------------------------------------------------------- HTTP layer
class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # --------------------------------------------------------------------- GET
    def do_GET(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()
        q = parse_qs(parsed.query)
        route = parsed.path

        if route == "/api/snapshot":
            snap = match.snapshot()
            snap.setdefault("stats", {})["paused"] = _paused
            return self._json(snap)
        if route == "/api/world":
            # locked accessor: version + world read atomically (never torn apart by
            # a concurrent round switch)
            return self._json(match.world_json())
        if route == "/api/worlds":
            # every round's world, so the client can prebuild + cache all arena
            # scenes during the start menu (instant transitions)
            return self._json({"worlds": match.all_worlds()})
        if route == "/api/values":
            agent = q.get("agent", ["red"])[0]
            if "cell" in q:
                try:
                    r, c = (int(x) for x in q["cell"][0].split(","))
                except (ValueError, IndexError):
                    return self._json({"error": "bad cell"}, 400)
                return self._json(match.q_at(agent, r, c) or {})
            mode = q.get("mode", [""])[0]
            if mode == "visits":
                return self._json(match.visit_grid(agent))
            if mode == "q":
                return self._json(match.q_grid(agent))
            if mode == "policy":
                return self._json(match.policy_grid(agent))
            return self._json(match.value_grid(agent))
        if route == "/api/vstats":
            return self._json(match.visit_stats(q.get("agent", ["red"])[0]))
        if route == "/api/mdp":
            return self._json(match.mdp_spec())
        if route == "/api/field":
            return self._json(match.arena_field(
                q.get("agent", ["blue"])[0],
                mode=q.get("mode", ["value"])[0],
            ))
        if route == "/api/va":
            return self._json(match.va_probe(q.get("agent", ["blue"])[0]))
        if route == "/api/reward":
            return self._json(match.reward_decomp())
        if route == "/api/qprobe":
            return self._json(match.q_probe_series())
        if route == "/api/polagree":
            return self._json(match.policy_agreement())
        if route == "/api/dpsweeps":
            return self._json(match.dp_sweeps(q.get("agent", ["red"])[0]))
        if route == "/api/history":
            return self._json(match.history())
        if route == "/api/replay":
            which = q.get("which", ["last"])[0]
            agent = q.get("agent", [None])[0]
            try:
                rank = int(q.get("rank", ["0"])[0])
            except ValueError:
                rank = 0
            try:
                episode = (
                    int(q["episode"][0]) if "episode" in q else None
                )
            except (ValueError, IndexError):
                episode = None
            return self._json(match.replay(which, agent, rank, episode))
        if route == "/api/replays":
            return self._json(match.replays_index(q.get("agent", ["red"])[0]))
        if route == "/api/dp":
            return self._json(match.dp_report(q.get("agent", ["red"])[0]))
        return self._json({"error": "unknown route"}, 404)

    # -------------------------------------------------------------------- POST
    MAX_BODY = 1 << 20   # 1 MB cap on a control payload

    def do_POST(self):
        if urlparse(self.path).path != "/api/control":
            return self._json({"error": "unknown route"}, 404)
        # a malformed / negative Content-Length must not crash the handler or make
        # rfile.read(-1) block until the client hangs up
        try:
            n = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            return self._json({"error": "bad content-length"}, 400)
        n = max(0, min(n, self.MAX_BODY))
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "bad json"}, 400)
        # a bad numeric value in the body (e.g. speed="fast") must return 400, not
        # 500 the handler with no response
        try:
            return self._json(self._control(body))
        except (TypeError, ValueError) as e:
            return self._json({"error": f"bad control value: {e}"}, 400)

    def _control(self, body):
        global _speed, _paused, _replay_restore_paused, _sync_hold_until
        cmd = body.get("cmd")
        extra = {}
        if cmd == "regenerate":
            match.regenerate(seed=body.get("seed"))
            _sync_hold_until = time.monotonic() + SYNC_HOLD_FALLBACK
        elif cmd == "reset":
            match.reset_models()
            _sync_hold_until = time.monotonic() + SYNC_HOLD_FALLBACK
        elif cmd == "resetTournament":
            match.reset_tournament()
            _sync_hold_until = time.monotonic() + SYNC_HOLD_FALLBACK
        elif cmd == "pause":
            _paused = True
            _replay_restore_paused = None
        elif cmd == "play":
            _paused = False
            _replay_restore_paused = None
        elif cmd == "replayEnter":
            # Capture the live state only on the first replay. Loading a different
            # recorded run while Replay is already open must not overwrite the
            # original state with the temporary pause.
            if _replay_restore_paused is None:
                _replay_restore_paused = _paused
            _paused = True
        elif cmd == "replayExit":
            if _replay_restore_paused is not None:
                _paused = _replay_restore_paused
                _replay_restore_paused = None
        elif cmd == "speed":
            _speed = max(1.0, min(15000.0, float(body.get("value", 60))))
        elif cmd == "sideAlgo":
            match.set_side_algo(body.get("side", "red"), body.get("value", "qlearning"))
        elif cmd == "setParams":
            match.set_params(body.get("params", {}))
        elif cmd == "setRedParams":
            match.set_red_params(body.get("params", {}))
        elif cmd == "cpuTier":
            match.set_cpu_tier(
                body.get("value", 1), body.get("level"),
                force=bool(body.get("force", False)),
            )
        elif cmd == "loadouts":
            match.set_loadouts(body.get("cpu"), body.get("player"))
            _sync_hold_until = time.monotonic() + SYNC_HOLD_FALLBACK
        elif cmd == "awardRound":
            extra["award"] = match.award_round()
        elif cmd == "prevRound":
            match.prev_round()
            _sync_hold_until = time.monotonic() + SYNC_HOLD_FALLBACK
        elif cmd == "nextRound":
            match.next_round()
            _sync_hold_until = time.monotonic() + SYNC_HOLD_FALLBACK
        elif cmd == "setRound":
            match.set_round(int(body.get("value", 1)))
            _sync_hold_until = time.monotonic() + SYNC_HOLD_FALLBACK
        elif cmd == "syncHold":
            _sync_hold_until = time.monotonic() + SYNC_HOLD_FALLBACK
        elif cmd == "syncRelease":
            delay = max(0.0, min(10000.0, float(body.get("delayMs", 0)))) / 1000.0
            _sync_hold_until = time.monotonic() + delay
        else:
            return {"error": f"unknown cmd {cmd!r}"}
        return {"ok": True, "speed": _speed, "paused": _paused,
                "worldVersion": match.world_version, "roundId": match.round_id,
                "algoRed": match.algo_red, "algoBlue": match.algo_blue, **extra}


class Server(http.server.ThreadingHTTPServer):
    """ThreadingHTTPServer that ignores the client hanging up mid-response.

    The browser polls /api/snapshot ~30x/s and fires control POSTs on keypress;
    when it refreshes, navigates away, or cancels an in-flight request the socket
    is torn down while we're still writing the reply, so wfile.write raises
    ConnectionAbortedError / ConnectionResetError / BrokenPipeError (WinError
    10053 / 10054). That is normal and harmless - swallow it instead of printing
    a full traceback for every dropped request. Real errors still surface."""

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], ConnectionError):
            return
        super().handle_error(request, client_address)


def main():
    global _alive
    httpd = None
    for port in range(8008, 8028):          # 8000-8007 are left for other apps
        try:
            httpd = Server(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        raise SystemExit("Could not find a free port between 8008 and 8027.")

    t = threading.Thread(target=trainer, daemon=True)
    t.start()

    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    print("Rival Minds - live self-play RL arena")
    print(f"Running at {url}")
    print("Two models are training live. R = reset models, C = control panel.")
    print("Keep this window open. Press Ctrl+C to stop.")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        _alive = False
        match.save_checkpoint(force=True)
        httpd.server_close()
        t.join(timeout=2.0)


if __name__ == "__main__":
    main()
