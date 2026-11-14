// What the senders insight tests share: two tools behind one instance, the
// ref of a record in the single-tool instance, and the two refusals.

import assert from "node:assert/strict";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";

/** An instance over a mail tool and a LinkedIn tool together. */
export const pair = (mail: MemoryData, linkedin: MemoryData) =>
  createOutbound({
    adapter: combine([
      memory({ data: mail, name: "mailtool", workspaceId: "agency" }),
      memory({ data: linkedin, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [insights()],
  });

/** The ref of a record in the instance `single()` builds. */
export const ref = (id: string): string => `memory:agency:${id}`;

/** Asserts that the call is refused as `Unsupported`, naming the capability. */
export const refused = async (
  call: () => Promise<object>,
  capability: string
): Promise<void> => {
  await assert.rejects(
    call,
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      error.message.includes(capability)
  );
};
