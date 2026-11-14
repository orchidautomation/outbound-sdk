import { SCHEMA_VERSION } from "./entities.ts";
import type { EventData, EventType } from "./entities.ts";
import { compactObject } from "./json.ts";
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

/** Refs to other records of the same provider and workspace, skipping empty ids. */
export const refsTo = (
  identity: Identity,
  sourceIds: readonly (string | number | null | undefined)[]
): string[] => sourceIds.flatMap((sourceId) => refTo(identity, sourceId) ?? []);

/**
 * The event types a webhook's vendor event names become, without repeats and
 * in a fixed order. A name the adapter does not know, or maps to `unknown`,
 * adds nothing.
 */
export const eventTypesOf = (
  names: readonly string[],
  known: ReadonlyMap<string, EventType>
): EventType[] =>
  [
    ...new Set(
      names.flatMap((name) => {
        const type = known.get(name);

        return type === undefined || type === "unknown" ? [] : [type];
      })
    ),
  ].toSorted();

/** The shared keys of an event's data, each with the type it must have. */
type SharedEventData = {
  readonly [
    Key in keyof EventData as string extends Key ? never : Key
  ]?: EventData[Key];
};

/**
 * An event's `data` from what an adapter read: the shared keys are typed, a
 * vendor's extras are any JSON, and a key with no value is left out.
 */
export const eventData = (
  shared: SharedEventData,
  extras: Readonly<Record<string, Json | undefined>> = {}
): EventData =>
  // SAFETY: the shared keys were typed on the way in and only absent values are dropped.
  compactObject({ ...extras, ...shared }) as EventData;
