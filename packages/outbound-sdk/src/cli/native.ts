// `outbound native <name>`: one of the vendor's own reads, refused in the
// CLI's words when the name is unknown, since the SDK's own error names its API.

import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, toJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { didYouMean } from "./suggest.ts";

/** Runs the native read `name` with the parameters `params` gives, once the name is known. */
export const readNative = async (
  outbound: OutboundApi,
  name: string,
  params: () => Json
): Promise<Json> => {
  const known = Object.keys(outbound.native.catalog);

  // An adapter with no native reads is still refused by the SDK, as Unsupported.
  if (outbound.capabilities.native && !known.includes(name)) {
    throw new OutboundError(
      "Invalid",
      `${outbound.provider} has no native read "${name}".${didYouMean(name, known)} Run "outbound native" to list them`
    );
  }

  const given = params();

  if (!isJsonObject(given)) {
    throw new OutboundError("Invalid", "--input must be a JSON object");
  }

  return toJson(await outbound.native.read(name, given));
};
