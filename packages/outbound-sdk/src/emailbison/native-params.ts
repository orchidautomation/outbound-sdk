// Pieces the EmailBison native catalog shares.

import { inQuery } from "../internal/native.ts";
import type { NativeParam } from "../internal/native.ts";

const REFERENCE = "https://dedi.emailbison.com/api/reference";

/** The reference's anchor for one read. */
export const docs = (
  tag: string,
  method: "get" | "post",
  path: string
): string => `${REFERENCE}#tag/${tag}/${method}${path}`;

export const page = {
  page: inQuery("number", "The page to read, from 1. 15 records per page."),
} as const satisfies Record<string, NativeParam>;
