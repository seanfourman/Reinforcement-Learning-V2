#!/bin/bash
# Double-click this file (macOS) to launch the King vs Queen RL arena.
# It runs the ONE all-in-one server: serves the page, trains both models live,
# and opens your browser automatically. Just close the window to stop.
cd "$(dirname "$0")"
exec python3 serve.py
