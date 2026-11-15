---
"outbound-sdk": minor
---

CLI: `outbound version` (also `--version` and `-v`) prints the installed version, and `outbound update` checks npm for a newer one. It updates a global install in place, and for a project install or npx it prints the command to run.

The executable is now also installed as `outbound-sdk`, so `npx outbound-sdk <command>` finds it by name. The docs and skills use that form, because `outbound` on npm is an unrelated package and `npx outbound` outside a project would download it. `outbound` still works.
