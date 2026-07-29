#!/usr/bin/env bash
# Render build script (referenced by render.yaml, runs inside game/).
#
# Two jobs:
#   1. Pull the Git-LFS assets. Render clones WITHOUT LFS smudge, so every
#      model/texture arrives as a ~130-byte pointer file; without this pull the
#      3D scene loads nothing. The repo is public, so no auth is needed.
#   2. Install Python deps, forcing the CPU-only torch wheel (the default CUDA
#      build is ~2 GB and useless on Render's CPU boxes).
set -euo pipefail

if ! command -v git-lfs >/dev/null 2>&1; then
  # no sudo in the build image, so drop a standalone binary into /tmp
  LFS_VER=3.5.1
  curl -fsSL "https://github.com/git-lfs/git-lfs/releases/download/v${LFS_VER}/git-lfs-linux-amd64-v${LFS_VER}.tar.gz" -o /tmp/git-lfs.tar.gz
  tar -xzf /tmp/git-lfs.tar.gz -C /tmp
  export PATH="/tmp/git-lfs-${LFS_VER}:$PATH"
fi
# --force: Render's clone already ships LFS hooks, and a plain install refuses
# to overwrite an existing pre-push hook (exit 2, which kills the build)
git lfs install --local --force
git lfs pull

pip install --upgrade pip
pip install numpy gymnasium
pip install torch --index-url https://download.pytorch.org/whl/cpu
