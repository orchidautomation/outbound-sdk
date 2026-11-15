// The `campaign` an insight answers with is always a ref, whether the caller
// passed a ref or a bare vendor id. Made from what the instance knows, so it
// costs no request.

import type { OutboundApi } from "../internal/outbound/api.ts";
import { makeRef, parseRef } from "../internal/ref.ts";

/**
 * The ref of the record `id` names on this instance. A combined instance
 * takes only refs, each of one of its tools, so its ids are kept as given.
 */
export const refOf = (outbound: OutboundApi, id: string): string => {
  const provider = parseRef(id)?.provider;

  return provider === outbound.provider ||
    (provider !== undefined && outbound.provider === "combined")
    ? id
    : makeRef(outbound.provider, outbound.workspaceId, id);
};
