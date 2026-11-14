import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const repositories = [];

after(() => {
  for (const repository of repositories) {
    rmSync(repository, { force: true, recursive: true });
  }
});

const lines = (count) =>
  `${Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")}\n`;

const runFixture = (files = {}) => {
  const repository = mkdtempSync(path.join(tmpdir(), "outbound-shape-"));
  repositories.push(repository);

  const fixtureFiles = {
    "AGENTS.md": "# Fixture instructions\n",
    "scripts/check-repo-shape.mjs": null,
    ...files,
  };

  for (const [file, contents] of Object.entries(fixtureFiles)) {
    if (contents === undefined) {
      continue;
    }

    const destination = path.join(repository, file);
    mkdirSync(path.dirname(destination), { recursive: true });

    if (contents === null) {
      copyFileSync(
        fileURLToPath(new URL(path.basename(file), import.meta.url)),
        destination
      );
    } else {
      writeFileSync(destination, contents);
    }
  }

  execFileSync("git", ["init", "-q", "--initial-branch=main"], {
    cwd: repository,
  });
  execFileSync("git", ["add", "-f", "."], { cwd: repository });

  const result = spawnSync(process.execPath, ["scripts/check-repo-shape.mjs"], {
    cwd: repository,
    encoding: "utf-8",
  });

  assert.ifError(result.error);

  return {
    output: `${result.stdout}\n${result.stderr}`,
    status: result.status,
  };
};

const rejects = (files, pattern) => {
  const result = runFixture(files);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, pattern);
};

const accepts = (files) => {
  const result = runFixture(files);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Repository shape OK/u);

  return result;
};

test("accepts a healthy repository", () => {
  accepts({ "src/example.ts": "export const value = 1;\n" });
});

test("warns at the review threshold without failing", () => {
  const result = accepts({ "src/medium.ts": lines(401) });
  assert.match(result.output, /400-line source-file review threshold/u);
});

test("rejects oversized production source", () => {
  rejects({ "src/large.ts": lines(601) }, /600-line source-file hard limit/u);
});

test("applies the separate test-source limit", () => {
  accepts({ "test/large.test.ts": lines(601) });
  rejects(
    { "test/large.test.ts": lines(901) },
    /900-line test-source hard limit/u
  );
});

test("applies source limits to extensionless scripts with a shebang", () => {
  rejects(
    { "bin/tool": `#!/usr/bin/env node\n${lines(601)}` },
    /600-line source-file hard limit/u
  );
});

test("rejects oversized module facades", () => {
  accepts({ "src/index.ts": lines(250) });
  rejects({ "src/index.ts": lines(251) }, /250-line module-facade hard limit/u);
});

test("rejects oversized declarative files", () => {
  rejects(
    { "data/big.json": lines(1201) },
    /1200-line declarative-file hard limit/u
  );
});

test("accepts an allowlisted oversized fixture with a reason", () => {
  accepts({
    "fixtures/large-fixtures.json": JSON.stringify([
      {
        file: "fixtures/acme/big.json",
        reason: "full documented payload under test",
      },
    ]),
    "fixtures/acme/big.json": lines(1201),
  });
});

test("rejects an allowlist entry without a reason or outside fixtures", () => {
  rejects(
    {
      "fixtures/large-fixtures.json": JSON.stringify([
        { file: "fixtures/acme/big.json", reason: "" },
      ]),
      "fixtures/acme/big.json": lines(1201),
    },
    /entry needs a reason/u
  );
  rejects(
    {
      "data/big.json": lines(1201),
      "fixtures/large-fixtures.json": JSON.stringify([
        { file: "data/big.json", reason: "no" },
      ]),
    },
    /only files under fixtures\/ may be allowlisted/u
  );
});

test("exempts lockfiles from line limits", () => {
  accepts({ "packages/a/package-lock.json": lines(5000) });
});

test("rejects oversized instructions", () => {
  rejects({ "AGENTS.md": lines(121) }, /120-line hard limit/u);
  rejects({ "packages/a/AGENTS.md": lines(151) }, /150-line hard limit/u);
  rejects(
    { "skills/a/SKILL.md": lines(301) },
    /300-line skill-instruction hard limit/u
  );
  rejects(
    { "docs/long.md": lines(1201) },
    /1200-line authored-Markdown hard limit/u
  );
});

test("requires root agent instructions", () => {
  rejects({ "AGENTS.md": undefined }, /required root agent instructions/u);
});

test("does not apply line limits to binary files", () => {
  accepts({
    "assets/blob.bin": Buffer.concat([
      Buffer.from([0]),
      Buffer.from(lines(2000)),
    ]),
  });
});

test("rejects forced-tracked local state", () => {
  rejects(
    { ".agent-artifacts/run.json": "{}\n" },
    /local agent or tool state/u
  );
  rejects({ ".entire/logs/session.log": "x\n" }, /local agent or tool state/u);
});

test("rejects secret-bearing environment files but allows examples", () => {
  rejects({ ".env": "KEY=1\n" }, /secret-bearing environment files/u);
  rejects(
    { "apps/a/.env.local": "KEY=1\n" },
    /secret-bearing environment files/u
  );
  accepts({ ".env.example": "KEY=\n" });
});

test("rejects tracked files over 1 MiB", () => {
  rejects(
    { "assets/huge.bin": Buffer.alloc(1024 * 1024 + 1) },
    /1 MiB tracked-file limit/u
  );
});
