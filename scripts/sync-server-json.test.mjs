import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { syncServerJson, withVersion } from "./sync-server-json.mjs";

const roots = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const SERVER = {
  name: "io.github.example/pkg",
  packages: [{ identifier: "pkg", registryType: "npm", version: "0.1.0" }],
  version: "0.1.0",
};

test("sets the entry's version and each package's version", () => {
  assert.deepEqual(JSON.parse(withVersion(JSON.stringify(SERVER), "0.2.0")), {
    ...SERVER,
    packages: [{ ...SERVER.packages[0], version: "0.2.0" }],
    version: "0.2.0",
  });
});

test("copies package.json's version into server.json, and leaves a synced file alone", () => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "server-json-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "pkg", version: "0.3.0" })
  );
  writeFileSync(path.join(root, "server.json"), JSON.stringify(SERVER));

  assert.equal(syncServerJson(root), "0.3.0");

  const synced = readFileSync(path.join(root, "server.json"), "utf-8");

  assert.equal(JSON.parse(synced).packages[0].version, "0.3.0");
  syncServerJson(root);
  assert.equal(readFileSync(path.join(root, "server.json"), "utf-8"), synced);
});

test("refuses a server.json that is not JSON", () => {
  assert.throws(() => withVersion("{ nope", "0.2.0"), SyntaxError);
});
