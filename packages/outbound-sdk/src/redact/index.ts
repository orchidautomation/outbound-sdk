// outbound-sdk/redact: masks personal data in results before they reach a
// caller, an agent or a report. List it first so it is the outermost plugin.
//
// It fails closed: a record it does not recognise is refused, never passed
// through unprotected. The vendor's raw payload is always dropped, because it
// holds everything the normalized fields were taken from.

export { ALL_FIELDS, KNOWN_TOKENS, MASK, redact } from "./plugin.ts";

export type { RedactExtension, RedactField, RedactOptions } from "./plugin.ts";
