#!/usr/bin/env python3
"""Serves the game and opens it in the browser.

Run with:  python serve.py

No dependencies — standard library only. This little server is also where
the Python RL backend will plug in later.
"""
import http.server
import mimetypes
import os
import threading
import webbrowser

# Serve relative to this file no matter where it's launched from.
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Some Windows machines have a broken registry entry that maps .js to
# text/plain, which makes browsers refuse ES modules. Force the right types.
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/png", ".png")


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # keep the console quiet (404s for optional texture overrides are normal)


def main():
    httpd = None
    for port in range(8000, 8020):
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        raise SystemExit("Could not find a free port between 8000 and 8019.")

    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    print(f"Grid World running at {url}")
    print("Keep this window open while playing. Press Ctrl+C to stop.")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
