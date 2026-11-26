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

if ! command -v "$launchctl" >/dev/null 2>&1; then
  echo "$launchctl is not available, so $label cannot be unloaded; $target is kept." >&2
  exit 1
fi

# Already unloaded (for example after a failed bootstrap) is fine; still
# loaded after a failed bootout is not, so the plist stays for another try.
if ! "$launchctl" bootout "gui/$(id -u)/$label" 2>/dev/null &&
  "$launchctl" print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  echo "$label is still loaded and launchctl bootout failed; $target is kept." >&2
  exit 1
fi

rm -f "$target"

echo "Removed $label."
