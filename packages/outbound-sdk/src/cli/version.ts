// The package's own version, for the MCP server's `serverInfo`. Read from
// package.json at run time so a release needs no generated file. The manifest
// is two folders up from this module in the source (src/cli/) and from every
// built file it can land in (dist/cli/, dist/chunks/), and npm always ships it.

import { readFileSync } from "node:fs";

import { z } from "zod";

const Manifest = z.object({
  name: z.literal("outbound-sdk"),
  version: z.string().min(1),
});

/** The installed package's version, from its package.json. */
export const packageVersion = (): string =>
  Manifest.parse(
    JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8")
    )
  ).version;
