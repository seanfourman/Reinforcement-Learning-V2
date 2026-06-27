#!/usr/bin/env python3
"""Live RL server + static host for the King-vs-Queen arena.

Run with:  python serve.py

Serves the game (static files) AND runs the two self-play models live in a
background thread, streaming the match to the browser over a tiny JSON API:

    GET  /api/snapshot          -> {worldVersion, frame, stats}     (poll ~30Hz)
    GET  /api/world             -> {worldVersion, world}            (on regenerate)
    GET  /api/values?agent=red  -> value heatmap V(s) per tile
    GET  /api/values?agent=red&cell=r,c -> per-action Q for one tile
    POST /api/control           -> {cmd: regenerate|reset|pause|play|speed|algo, ...}

Only third-party dep is gymnasium (+ numpy, already present). The browser is a
pure viewer: it polls the snapshot and renders the 3D scene.
"""
import http.server
import json
import mimetypes
import os
import sys
import threading
import time
import webbrowser
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)                      # static files are served from game/
sys.path.insert(0, os.path.join(HERE, "rl"))

from match import Match             # noqa: E402  (after sys.path tweak)

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

# ---------------------------------------------------------------- training loop
match = Match(seed=None, round_id=1)
_speed = 60.0          # target sim steps per second (set via /api/control)
_paused = False
_alive = True


def trainer():
    """Drive the match at the requested speed. Slow = watch the walk; fast = many
    episodes fly by and the heatmap fills in. Batches at high speed so the HTTP
    handler thread stays responsive."""
    while _alive:
        if _paused:
            time.sleep(0.03)
            continue
        sp = _speed
        if sp <= 120:
            match.tick()
            time.sleep(1.0 / sp)
        else:
            batch = min(2000, int(sp / 60))
            for _ in range(batch):
                match.tick()
            time.sleep(1.0 / 60)


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
            return self._json(match.snapshot())
        if route == "/api/world":
            return self._json({"worldVersion": match.world_version,
                               "world": match.env.to_json()})
        if route == "/api/values":
            agent = q.get("agent", ["red"])[0]
            if "cell" in q:
                r, c = (int(x) for x in q["cell"][0].split(","))
                return self._json(match.q_at(agent, r, c) or {})
            mode = q.get("mode", [""])[0]
            if mode == "visits":
                return self._json(match.visit_grid(agent))
            if mode == "q":
                return self._json(match.q_grid(agent))
            return self._json(match.value_grid(agent))
        if route == "/api/history":
            return self._json(match.history())
        if route == "/api/replay":
            return self._json(match.replay(q.get("which", ["last"])[0]))
        return self._json({"error": "unknown route"}, 404)

    # -------------------------------------------------------------------- POST
    def do_POST(self):
        if urlparse(self.path).path != "/api/control":
            return self._json({"error": "unknown route"}, 404)
        n = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "bad json"}, 400)
        return self._json(self._control(body))

    def _control(self, body):
        global _speed, _paused
        cmd = body.get("cmd")
        if cmd == "regenerate":
            match.regenerate(seed=body.get("seed"))
        elif cmd == "reset":
            match.reset_models()
        elif cmd == "pause":
            _paused = True
        elif cmd == "play":
            _paused = False
        elif cmd == "speed":
            _speed = max(2.0, min(15000.0, float(body.get("value", 60))))
        elif cmd == "sideAlgo":
            match.set_side_algo(body.get("side", "red"), body.get("value", "qlearning"))
        elif cmd == "setParams":
            match.set_params(body.get("params", {}))
        elif cmd == "setRedParams":
            match.set_red_params(body.get("params", {}))
        elif cmd == "cpuTier":
            match.set_cpu_tier(body.get("value", 1))
        elif cmd == "prevRound":
            match.prev_round()
        elif cmd == "nextRound":
            match.next_round()
        elif cmd == "setRound":
            match.set_round(int(body.get("value", 1)))
        else:
            return {"error": f"unknown cmd {cmd!r}"}
        return {"ok": True, "speed": _speed, "paused": _paused,
                "worldVersion": match.world_version, "roundId": match.round_id,
                "algoRed": match.algo_red, "algoBlue": match.algo_blue}


def main():
    httpd = None
    for port in range(8008, 8028):          # 8000-8007 are left for other apps
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        raise SystemExit("Could not find a free port between 8008 and 8027.")

    t = threading.Thread(target=trainer, daemon=True)
    t.start()

    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    print(f"King vs Queen RL arena running at {url}")
    print("Two models are training live. R = new world + reset, M = panel.")
    print("Keep this window open. Press Ctrl+C to stop.")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
