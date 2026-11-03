#!/bin/sh
set -eu
our_house_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$our_house_dir"
our_house_claude=$(command -v claude || true)
if [ -z "$our_house_claude" ] && [ -x "$HOME/.local/bin/claude" ]; then
  our_house_claude="$HOME/.local/bin/claude"
fi
if [ -z "$our_house_claude" ]; then
  printf '%s\n' 'Install Claude Code, then open this folder and paste CLAUDE-START.md.'
  exit 1
fi
printf '%s\n' 'Opening Claude Code in Our House with the bundled concept and art handoff.'
exec "$our_house_claude" "$(cat CLAUDE-START.md)"
