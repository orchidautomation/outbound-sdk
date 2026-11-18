#!/bin/sh
# Removes the launchd agent that evals/launchd/install.sh installed.

set -eu

label=dev.outbound-sdk.evals
agents=${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}
launchctl=${LAUNCHCTL:-launchctl}
target="$agents/$label.plist"

if [ ! -e "$target" ]; then
  echo "$label is not installed ($target does not exist)."
  exit 0
fi

# Not loaded (for example after a failed bootstrap) is fine: the file still goes.
"$launchctl" bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$target"

echo "Removed $label."
