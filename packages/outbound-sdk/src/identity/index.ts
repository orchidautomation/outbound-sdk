// outbound-sdk/identity: the same person in several tools.
//
// Adds `personKey` to every lead, and `outbound.person(key)`, which returns
// every record for that person and one timeline across tools. Records are
// linked, never merged: each keeps its own provider, workspace and fields.

export { identity } from "./plugin.ts";

export type {
  IdentityExtension,
  Person,
  PersonLead,
  PersonOptions,
} from "./plugin.ts";

export { leadIdentifierCoverage } from "../internal/identifiers.ts";

export type {
  IdentifierCoverage,
  IdentifierType,
  LeadIdentifierCoverage,
  PersonLink,
  ToolIdentifiers,
  ToolLeadIdentifiers,
} from "../internal/identifiers.ts";

export { emailKey, keysOf, linkedinKey, toKey } from "./keys.ts";
