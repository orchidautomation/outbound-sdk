import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../../../fixtures");

/** Reads `fixtures/<provider>/<name>` as parsed JSON. */
export const fixture = (provider: string, name: string): unknown =>
  JSON.parse(readFileSync(path.join(root, provider, name), "utf-8"));

export const fixtureText = (provider: string, name: string): string =>
  readFileSync(path.join(root, provider, name), "utf-8");
