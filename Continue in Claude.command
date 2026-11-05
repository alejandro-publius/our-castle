#!/bin/sh
set -eu
our_castle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$our_castle_dir"
our_castle_claude=$(command -v claude || true)
if [ -z "$our_castle_claude" ] && [ -x "$HOME/.local/bin/claude" ]; then
  our_castle_claude="$HOME/.local/bin/claude"
fi
if [ -z "$our_castle_claude" ]; then
  printf '%s\n' 'Install Claude Code, then open this folder and paste CLAUDE-START.md.'
  exit 1
fi
printf '%s\n' 'Opening Claude Code in Our Castle with the current visual handoff.'
exec "$our_castle_claude" "$(cat CLAUDE-START.md)"
