// Preloaded into every documentation example the test suite runs
// (site/test/examples.test.ts). It lets an example import `outbound-sdk` the
// way a reader would and resolves that to this repository's source, but only
// for subpaths the package exports. It refuses any network call: an example
// runs on the in-memory adapter or on a `fetch` it supplies itself. And it
// fixes the clock, so a recorded output is the same on every run.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The instant every example runs at. */
export const EXAMPLE_NOW = "2026-11-14T12:00:00.000Z";

const PACKAGE = path.resolve(import.meta.dirname, "../packages/outbound-sdk");

const EXPORTED = new Set(
  Object.keys(
    JSON.parse(readFileSync(path.join(PACKAGE, "package.json"), "utf-8"))
      .exports
  )
);

const SOURCE = path.join(PACKAGE, "src");

// Subpaths that are a file, not a folder with an index.
const FILES = new Map([
  ["tools/ai-sdk", "tools/ai-sdk.ts"],
  ["tools/claude-agent", "tools/claude-agent.ts"],
]);

/** The source file a package specifier names, or `null` for anything else. */
export const sourceFor = (specifier) => {
  if (specifier === "outbound-sdk") {
    return path.join(SOURCE, "index.ts");
  }

  if (!specifier.startsWith("outbound-sdk/")) {
    return null;
  }

  const subpath = specifier.slice("outbound-sdk/".length);

  if (!EXPORTED.has(`./${subpath}`)) {
    throw new Error(`${specifier} is not a subpath the package exports`);
  }

  return path.join(SOURCE, FILES.get(subpath) ?? `${subpath}/index.ts`);
};

registerHooks({
  resolve: (specifier, context, nextResolve) => {
    const file = sourceFor(specifier);

    return file === null
      ? nextResolve(specifier, context)
      : { shortCircuit: true, url: pathToFileURL(file).href };
  },
});

// The live runs (site/test/live) call a real model on purpose: they keep the
// real network and the real clock.
const LIVE = process.env.EXAMPLES_LIVE === "1";

if (!LIVE) {
  globalThis.fetch = (input) =>
    Promise.reject(
      new Error(
        `A documentation example tried to reach the network: ${String(input instanceof Request ? input.url : input).split("?")[0]}`
      )
    );

  const FIXED = Date.parse(EXAMPLE_NOW);
  const RealDate = Date;

  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(FIXED);
      } else {
        super(...args);
      }
    }

    static now() {
      return FIXED;
    }
  };
}
