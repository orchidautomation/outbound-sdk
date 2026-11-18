import { run } from "outbound-sdk/cli";

import { outbound } from "./cli.ts";

// A record per line as each page arrives, then one { meta, ok } line.
// --limit stopped it while more exist, so it exits 3 and meta.cursor says
// where to resume.
await outbound("leads", "--jsonl", "--limit", "2");

// The cursor from that last line, read the way a script would.
const lines: string[] = [];
const notes: string[] = [];

await run(["leads", "--jsonl", "--limit", "2"], {
  stderr: (note) => {
    notes.push(note);
  },
  stdout: (line) => {
    lines.push(line);
  },
});

// SAFETY: --jsonl prints the { meta, ok } line last, and a run --limit stopped carries a cursor.
const { meta } = JSON.parse(lines.at(-1) ?? "{}") as {
  meta: { cursor: string };
};

// The rest, from where the first run stopped: no lead twice.
await outbound("leads", "--jsonl", "--cursor", meta.cursor);

// Leads created since a time.
await outbound("leads", "--since", "2026-10-01", "--compact");

// Every sender's rows in one read needs stats.bySenders, which the demo
// adapter does not have: refused before any request.
await outbound("stats", "--scope", "sender");
