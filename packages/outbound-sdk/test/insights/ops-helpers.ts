// What the ops insight tests share: a two-tool instance built from the data
// each test states, a stats row in one line, and the check for a refused read.

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData, MemoryStats } from "../../src/memory/index.ts";

/** An instance over an email tool (`mailtool`) and a LinkedIn tool (`lntool`). */
export const pair = (mail: MemoryData, linkedin: MemoryData) =>
  createOutbound({
    adapter: combine([
      memory({ data: mail, name: "mailtool", workspaceId: "agency" }),
      memory({ data: linkedin, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [insights()],
  });

/** One day of counts for a campaign. */
export const row = (
  campaignId: string,
  date: string,
  counts: MemoryStats["counts"]
): MemoryStats => ({ campaignId, counts, date });

/** Matches the `Unsupported` error that names a capability key. */
export const unsupported = (key: string) => (error: unknown) =>
  OutboundError.is(error) &&
  error.code === "Unsupported" &&
  error.message.includes(key);
