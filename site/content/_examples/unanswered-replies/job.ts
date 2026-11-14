import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

import { unansweredReplies } from "./unanswered.ts";

// Reads INSTANTLY_API_KEY. Swap the import for smartlead() or heyreach().
const outbound = createOutbound({
  adapter: instantly({ workspaceId: "acme" }),
  // One run may spend at most 150 vendor requests.
  maxRequests: 150,
  plugins: [insights()],
});

/**
 * What a scheduler calls. It returns the text; posting it to a channel or an
 * inbox is yours to do. The SDK answers no reply.
 */
export const job = (): Promise<string> => unansweredReplies(outbound);
