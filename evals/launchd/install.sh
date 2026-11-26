#!/bin/sh
# Installs the nightly eval run (evals/nightly.sh at 03:00) as a launchd
# agent for the signed-in user. Run it from a checkout that stays on main.
#
#   evals/launchd/install.sh         write the agent and load it
#   evals/launchd/install.sh --now   the same, then run it once now
#
# evals/launchd/uninstall.sh removes it.

set -eu

label=dev.outbound-sdk.evals
repo=${EVALS_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}
agents=${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}
launchctl=${LAUNCHCTL:-launchctl}
target="$agents/$label.plist"

branch=$(git -C "$repo" symbolic-ref --short -q HEAD || echo "a detached HEAD")

if [ "$branch" != main ]; then
  echo "Install from a checkout on main; $repo is on $branch, and the run evaluates whatever is checked out." >&2
  exit 1
fi

if [ -e "$target" ]; then
  echo "$target already exists. Run evals/launchd/uninstall.sh first." >&2
  exit 1
fi

mkdir -p "$agents"
sed "s#REPO#$repo#g" "$repo/evals/launchd/$label.plist" >"$target"
"$launchctl" bootstrap "gui/$(id -u)" "$target"

if [ "${1:-}" = --now ]; then
  "$launchctl" kickstart "gui/$(id -u)/$label"
fi

echo "Installed $label: evals/nightly.sh runs at 03:00 from $repo and logs to /tmp/outbound-evals.log."
