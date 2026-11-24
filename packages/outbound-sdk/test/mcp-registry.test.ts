import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { providers } from "../src/providers/index.ts";

// server.json is the package's entry in the official MCP Registry. The
// registry checks it against the npm package, so it has to agree with
// package.json and with what `outbound mcp` reads from the environment.

const read = <T>(name: string): T =>
  JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "..", name), "utf-8")
  ) as T;

interface ServerJson {
  name: string;
  description: string;
  version: string;
  packages: {
    identifier: string;
    version: string;
    registryType: string;
    transport: { type: string };
    packageArguments: { type: string; value: string }[];
    environmentVariables: { name: string; isSecret?: boolean }[];
  }[];
}

interface PackageJson {
  name: string;
  version: string;
  mcpName: string;
  homepage: string;
  keywords: string[];
  bin: Record<string, string>;
}

const server = read<ServerJson>("server.json");
const pkg = read<PackageJson>("package.json");
const [entry] = server.packages;

test("server.json names the npm package, and its name is the package's mcpName", () => {
  assert.equal(server.name, pkg.mcpName);
  assert.equal(entry?.registryType, "npm");
  assert.equal(entry?.identifier, pkg.name);
  // npx runs the bin named after the package.
  assert.ok(pkg.bin[pkg.name]);
});

test("server.json's versions are the package's version", () => {
  assert.equal(server.version, pkg.version);
  assert.equal(entry?.version, pkg.version);
});

test("server.json starts `outbound mcp` on stdio", () => {
  assert.equal(entry?.transport.type, "stdio");
  assert.deepEqual(entry?.packageArguments, [
    { type: "positional", value: "mcp" },
  ]);
});

test("server.json lists every variable a provider reads, and marks each key secret", () => {
  const names = entry?.environmentVariables.map(({ name }) => name) ?? [];

  const expected = [
    "OUTBOUND_SDK_PROVIDER",
    ...providers.flatMap(({ envVars }) => envVars.map(({ name }) => name)),
    "OUTBOUND_REDACT_KEY",
  ];

  assert.deepEqual(names.toSorted(), expected.toSorted());

  for (const variable of entry?.environmentVariables ?? []) {
    assert.equal(
      variable.isSecret === true,
      /_API_KEY$|^OUTBOUND_REDACT_KEY$/u.test(variable.name),
      variable.name
    );
  }
});

test("the registry's 100-character description limit holds", () => {
  assert.ok(server.description.length <= 100, server.description);
});

test("the npm page points at the docs and is found by MCP and vendor-API searches", () => {
  assert.equal(pkg.homepage, "https://outbound-sdk.dev");

  for (const keyword of [
    "mcp",
    "mcp-server",
    "instantly-api",
    "smartlead-api",
    "heyreach-api",
    "emailbison-api",
  ]) {
    assert.ok(pkg.keywords.includes(keyword), keyword);
  }
});
