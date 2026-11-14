// Holds what the site says about the project to the code, so a page cannot
// keep claiming something after it stops being true.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { providers } from "../../packages/outbound-sdk/src/providers/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTENT = path.join(ROOT, "site/content");

const read = (file: string): string =>
  readFileSync(path.join(ROOT, file), "utf-8");

const manifest = JSON.parse(read("packages/outbound-sdk/package.json")) as {
  version: string;
  exports: Record<string, unknown>;
};

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(dir, entry.name))
      : [path.join(dir, entry.name)]
  );

const pages = walk(CONTENT).filter((file) => /\.mdx?$/u.test(file));
const unpublished = manifest.version === "0.0.0";

test("the status page and the status notice give each adapter its maturity", () => {
  const status = read("site/content/docs/status.mdx");
  const notice = read("site/content/_snippets/status.mdx");

  for (const provider of providers.filter(({ id }) => id !== "memory")) {
    assert.match(
      status,
      new RegExp(`\\| ${provider.name} \\| \`${provider.maturity}\` \\|`, "u"),
      `docs/status.mdx lists ${provider.name} as ${provider.maturity}`
    );
    assert.match(
      read("site/blume.config.ts"),
      new RegExp(`${provider.name}[^."]*${provider.maturity}`, "u"),
      `blume.config.ts calls ${provider.name} ${provider.maturity}`
    );
    assert.match(
      notice.replaceAll(/\s+/gu, " "),
      new RegExp(`${provider.name}[^.]*\`${provider.maturity}\``, "u"),
      `_snippets/status.mdx calls ${provider.name} ${provider.maturity}`
    );
  }
});

test("while the package is unpublished, no page shows an install command for it", () => {
  if (!unpublished) {
    return;
  }

  // The installation page says the command does not work, in a callout.
  const allowed = path.join(CONTENT, "docs/installation.mdx");

  const install =
    /(?:npm (?:i|install|add)|pnpm add|yarn add|bun add|npx(?: -y)?) +(?:-\S+ +)*outbound-sdk(?![\w/-]*\.tgz)/u;

  for (const page of pages) {
    for (const line of readFileSync(page, "utf-8").split("\n")) {
      if (install.test(line)) {
        assert.ok(
          page === allowed ||
            /does not|not work|not published|unpublished|once it is published|after the first release/iu.test(
              line
            ),
          `${path.relative(ROOT, page)} shows an install command without saying it does not work: ${line.trim()}`
        );
      }
    }
  }

  assert.match(
    read("site/content/docs/installation.mdx"),
    /not been published/u
  );
  assert.match(read("site/content/_snippets/status.mdx"), /not on npm/u);
  assert.match(read("site/blume.config.ts"), /not on npm yet/u);
});

test("every public subpath has a page", () => {
  const home: Readonly<Record<string, string>> = {
    ".": "docs/usage.mdx",
    "./cli": "docs/cli/index.mdx",
    "./combine": "docs/adapters/combine.mdx",
    "./heyreach": "docs/adapters/heyreach.mdx",
    "./insights": "docs/insights/index.mdx",
    "./instantly": "docs/adapters/instantly.mdx",
    "./loader": "docs/adapters/index.mdx",
    "./memory": "docs/adapters/memory.mdx",
    "./providers": "docs/adapters/index.mdx",
    "./redis": "docs/rate-limits.mdx",
    "./smartlead": "docs/adapters/smartlead.mdx",
    "./tools": "docs/tools/index.mdx",
    "./tools/ai-sdk": "docs/tools/ai-sdk.mdx",
    "./tools/claude-agent": "docs/tools/claude-agent.mdx",
    "./webhooks": "docs/webhooks/index.mdx",
  };

  for (const subpath of Object.keys(manifest.exports)) {
    const page = home[subpath] ?? `docs/plugins/${subpath.slice(2)}.mdx`;
    const file = path.join(CONTENT, page);

    assert.ok(existsSync(file), `${subpath} is documented at ${page}`);
    assert.ok(
      subpath === "." ||
        readFileSync(file, "utf-8").includes(
          `outbound-sdk/${subpath.slice(2)}`
        ),
      `${page} names outbound-sdk/${subpath.slice(2)}`
    );
  }
});
