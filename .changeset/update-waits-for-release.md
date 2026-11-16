---
"outbound-sdk": patch
---

`outbound update` works in the minutes right after a release. npm lists a new version before it serves the download (0.7.0's tarball returned `E404` for 9 minutes), so a global update failed. It now installs the exact version npm named, and on `E404` or `ETARGET` tries again every 30 seconds for up to 15 minutes, asking the registry afresh each time. Any other npm failure now shows npm's error code and the line that says what went wrong, instead of "A complete log of this run can be found in: ...".
