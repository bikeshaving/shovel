#!/usr/bin/env bash
# Sets up the WPT submodule with sparse checkout so only the needed
# test directories are checked out on disk.
#
# Runs automatically via `prepare` script on install.

set -e

WPT_PATH="packages/shovel-wpt/wpt"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
WPT_FULL="$ROOT/$WPT_PATH"

# Skip if not in a git repo (e.g. installed as a dependency)
if [ ! -d "$ROOT/.git" ]; then
  exit 0
fi

# Skip if already checked out with the right files
if [ -f "$WPT_FULL/fs/script-tests/FileSystemDirectoryHandle-getFileHandle.js" ] \
   && [ -f "$WPT_FULL/IndexedDB/abort-in-initial-upgradeneeded.any.js" ]; then
  exit 0
fi

echo "Setting up WPT submodule (sparse checkout)..."

# Clean any broken state
rm -rf "$WPT_FULL"
rm -rf "$ROOT/.git/modules/$WPT_PATH"

# Init submodule config (registers URL from .gitmodules)
git -C "$ROOT" submodule init "$WPT_PATH"

# Clone without checking out files
git clone --no-checkout --depth=1 \
  "$(git -C "$ROOT" config "submodule.$WPT_PATH.url")" \
  "$WPT_FULL"

# Configure sparse checkout — only pull what we need
git -C "$WPT_FULL" sparse-checkout set --no-cone \
  '/*' '!/*/' '/FileAPI/' '/IndexedDB/' '/cookiestore/' '/fs/' '/resources/'

# Move .git into parent repo's modules dir
git -C "$ROOT" submodule absorbgitdirs "$WPT_PATH"

# Fetch and checkout the pinned commit (respects sparse checkout)
git -C "$ROOT" submodule update --force "$WPT_PATH"

echo "WPT submodule ready (sparse: FileAPI, IndexedDB, cookiestore, fs, resources)"
