import { SCHEMA_VERSION } from "./entities.ts";
import type { Json } from "./json.ts";
import { makeRef } from "./ref.ts";

/** Which provider and workspace a record belongs to. */
export interface Identity {
  readonly provider: string;
  readonly workspaceId: string;
}

/** The fields every entity shares. Adapters spread this into each record. */
export const recordBase = (
  identity: Identity,
  sourceId: string | number,
  raw: Json
) => ({
  provider: identity.provider,
  raw,
  ref: makeRef(identity.provider, identity.workspaceId, sourceId),
  schemaVersion: SCHEMA_VERSION,
  sourceId: String(sourceId),
  workspaceId: identity.workspaceId,
});

/** A ref to another record of the same provider and workspace, or `null`. */
export const refTo = (
  identity: Identity,
  sourceId: string | number | null | undefined
): string | null =>
  sourceId === null || sourceId === undefined || sourceId === ""
    ? null
    : makeRef(identity.provider, identity.workspaceId, sourceId);
