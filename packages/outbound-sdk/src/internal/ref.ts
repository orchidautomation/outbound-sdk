import { OutboundError } from "./errors.ts";

export interface RefParts {
  readonly provider: string;
  readonly workspaceId: string;
  readonly sourceId: string;
}

const SEPARATOR = ":";

/** Builds `provider:workspaceId:sourceId`. */
export const makeRef = (
  provider: string,
  workspaceId: string,
  sourceId: string | number
): string => [provider, workspaceId, String(sourceId)].join(SEPARATOR);

/** Splits a ref. The source id may itself contain colons. */
export const parseRef = (ref: string): RefParts | null => {
  const [provider, workspaceId, ...rest] = ref.split(SEPARATOR);

  if (!provider || !workspaceId || rest.length === 0) {
    return null;
  }

  return { provider, sourceId: rest.join(SEPARATOR), workspaceId };
};

/**
 * Accepts a ref or a bare vendor id and returns the vendor id for this
 * adapter. A ref that belongs to another provider or workspace is rejected.
 */
export const sourceIdFor = (
  id: string,
  provider: string,
  workspaceId: string
): string => {
  const parts = parseRef(id);

  if (parts === null || parts.provider !== provider) {
    return id;
  }

  if (parts.workspaceId !== workspaceId) {
    throw new OutboundError(
      "Invalid",
      `${id} belongs to workspace ${parts.workspaceId}, not ${workspaceId}`,
      { provider }
    );
  }

  return parts.sourceId;
};

/** Workspace labels become part of every ref, so they cannot hold the separator. */
export const assertWorkspaceId = (
  workspaceId: string,
  provider: string
): string => {
  if (workspaceId === "" || workspaceId.includes(SEPARATOR)) {
    throw new OutboundError(
      "Invalid",
      `workspaceId must be a non-empty string without "${SEPARATOR}"`,
      { provider }
    );
  }

  return workspaceId;
};
