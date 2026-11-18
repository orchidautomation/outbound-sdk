#!/bin/zsh -i
# The nightly eval run on Brandon's Mac, started by launchd at 03:00
# America/New_York, and the same command before a publish. Interactive zsh
# reads the vendor keys and LINEAR_API_KEY from ~/.zshrc; none is printed.
#
#   evals/nightly.sh            layer 1 live, layer 2, then a counts-only comment on OUT-145
#   EVAL_POST=0 evals/nightly.sh   the same without the comment
#
# Exits non-zero when layer 1 is red.

set -u
cd "${0:a:h}/.." || exit 1
out="$HOME/outbound-evals"
mkdir -p "$out"
marker=$(mktemp)

LIVE_TESTS=1 node evals/run.ts
invariants=$?

# A held lock (75) means another run is on the vendors right now; skip the rest.
if [ "$invariants" -eq 75 ]; then
  exit 75
fi

# Anything but green (0) or red (1) means layer 1 died, for example killed,
# and recorded no truth, so layer 2 would score nothing.
if [ "$invariants" -ne 0 ] && [ "$invariants" -ne 1 ]; then
  echo "layer 1 exited $invariants and recorded no truth, so layer 2 is skipped" >&2
  rm -f "$marker"
  exit "$invariants"
fi

node evals/agent/run.ts

# This run's summaries, layer 1 first.
new=($(find "$out" -name '*.md' -newer "$marker" | sort))
rm -f "$marker"

if [ "${EVAL_POST:-1}" = "1" ] && [ ${#new[@]} -gt 0 ]; then
  node evals/post.ts --issue "${EVAL_ISSUE:-OUT-145}" "${new[@]}"
fi

exit "$invariants"
