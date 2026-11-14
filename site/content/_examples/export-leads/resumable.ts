import { appendFile, readFile } from "node:fs/promises";

import type { Lead, Outbound } from "outbound-sdk";

/** Where an unfinished export stopped. Keep it somewhere that survives a crash. */
export interface ExportState {
  cursor?: string | undefined;
  done: boolean;
}

const refsIn = async (file: string): Promise<Set<string>> => {
  const lines = await readFile(file, "utf-8").catch(() => "");

  return new Set(
    lines
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => String(JSON.parse(line).ref))
  );
};

/**
 * Appends leads to a `.jsonl` file, starting from `state.cursor`. The cursor
 * is saved each time a page has been written, so a run that dies restarts on
 * the page it was writing. That page is read again: delivery is at least
 * once, and the refs already in the file are skipped.
 */
export const exportLeadsFrom = async (
  outbound: Outbound,
  file: string,
  state: ExportState,
  onRow?: (lead: Lead) => void
): Promise<{ skipped: number; written: number }> => {
  const seen = await refsIn(file);
  const walk = outbound.leads.listAll({ cursor: state.cursor });
  let skipped = 0;
  let written = 0;

  for await (const lead of walk) {
    // The walker moves its cursor once a whole page has been handed out, and
    // every row of that page has been appended by now.
    state.cursor = walk.cursor;

    if (seen.has(lead.ref)) {
      skipped += 1;
    } else {
      const row = { email: lead.email, ref: lead.ref, status: lead.status };

      await appendFile(file, `${JSON.stringify(row)}\n`);
      seen.add(lead.ref);
      written += 1;
      onRow?.(lead);
    }
  }

  state.cursor = undefined;
  state.done = true;

  return { skipped, written };
};
