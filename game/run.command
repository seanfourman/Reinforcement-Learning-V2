#!/bin/bash
# Double-click this file (macOS) to launch the King vs Queen RL arena.
# It runs the ONE all-in-one server: serves the page, trains both models live,
# and opens your browser automatically. Just close the window to stop.
cd "$(dirname "$0")"

# Make sure required Python packages are installed. We only run pip when a
# dependency is actually missing, so normal launches stay fast and offline.
if ! python3 -c "import gymnasium" >/dev/null 2>&1; then
    echo "Installing required Python packages from requirements.txt ..."
    if ! python3 -m pip install -r requirements.txt; then
        echo "Failed to install the required packages."
        echo "You can try running this manually: python3 -m pip install -r requirements.txt"
        exit 1
    fi
fi

exec python3 serve.py
