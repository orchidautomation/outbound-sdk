import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "../src/cli/index.ts";
import type { NpmRunner } from "../src/cli/index.ts";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

const { bin, version } = JSON.parse(
  readFileSync(path.join(packageDir, "package.json"), "utf-8")
) as { bin: Record<string, string>; version: string };

/** A fake npm: answers `view` and `root`, and records every call. */
const fakeNpm = (latest: string, globalRoot = "/nowhere") => {
  const calls: string[] = [];

  const npm: NpmRunner = (args) => {
    calls.push(args.join(" "));

    if (args[0] === "view") {
      return Promise.resolve(`${latest}\n`);
    }

    if (args[0] === "root") {
      return Promise.resolve(`${globalRoot}\n`);
    }

    return Promise.resolve("");
  };

  return { calls, npm };
};

const unreachableNpm: NpmRunner = () =>
  Promise.reject(new Error("npm view outbound-sdk version failed: ENOTFOUND"));

const cli = async (argv: string[], npm?: NpmRunner) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, {
    npm,
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  return { code, err: err.join("\n"), out: out.join("\n") };
};

test("the package installs one executable as both outbound and outbound-sdk", () => {
  // `npx outbound-sdk` must find its executable by name: `outbound` on npm is
  // an unrelated package, so `npx outbound` outside a project runs that.
  assert.deepEqual(Object.keys(bin).toSorted(), ["outbound", "outbound-sdk"]);
  assert.equal(bin.outbound, bin["outbound-sdk"]);
});

test("version, --version and -v print the package version without a key", async () => {
  for (const argv of [["version"], ["--version"], ["-v"]]) {
    const result = await cli(argv);

    assert.equal(result.code, 0, argv.join(" "));
    assert.equal(result.out, version, argv.join(" "));
  }
});

test("--version on another command is refused, not ignored", async () => {
  const result = await cli(["campaigns", "--version"]);

  assert.equal(result.code, 1);
  assert.match(result.err, /--version is not an option of campaigns/u);
});

test("help lists version and update", async () => {
  const help = await cli([]);

  assert.match(help.out, /^ {2}version {2,}/mu);
  assert.match(help.out, /^ {2}update {2,}/mu);
});

test("update says so when the installed version is the latest, and installs nothing", async () => {
  const { calls, npm } = fakeNpm(version);
  const result = await cli(["update"], npm);

  assert.equal(result.code, 0);
  assert.equal(result.out, `outbound-sdk ${version} is the latest version.`);
  assert.deepEqual(calls, ["view outbound-sdk version"]);
});

test("update tells a project install the command instead of rewriting its package.json", async () => {
  const { calls, npm } = fakeNpm("999.0.0");
  const result = await cli(["update"], npm);

  assert.equal(result.code, 0);
  assert.match(result.out, /999\.0\.0 is the latest/u);
  assert.match(result.out, /npm install outbound-sdk@latest" in this project/u);
  assert.ok(!calls.some((call) => call.startsWith("install")));
});

test("update installs over a global install", async () => {
  const { calls, npm } = fakeNpm("999.0.0", path.dirname(packageDir));
  const result = await cli(["update"], npm);

  assert.equal(result.code, 0);
  assert.deepEqual(calls, [
    "view outbound-sdk version",
    "root --global",
    "install --global outbound-sdk@latest",
  ]);
  assert.match(result.out, /Updated outbound-sdk to 999\.0\.0\./u);
});

test("update compares versions by number, not as text", async () => {
  const [major = "0", minor = "0"] = version.split(".");
  // 0.10.0 sorts before 0.9.0 as text; as numbers it is newer.
  const newer = `${major}.${Number(minor) + 10}.0`;
  const older = `${major}.${Math.max(Number(minor) - 1, 0)}.99`;

  assert.match(
    (await cli(["update"], fakeNpm(newer).npm)).out,
    /is installed/u
  );

  if (older !== version) {
    assert.match(
      (await cli(["update"], fakeNpm(older).npm)).out,
      /is the latest version/u
    );
  }
});

test("update fails with exit code 1 when npm cannot be reached", async () => {
  const result = await cli(["update"], unreachableNpm);

  assert.equal(result.code, 1);
  assert.match(result.err, /^Error: npm view outbound-sdk version failed/u);
});

// The default runner starts the npm on PATH. A stand-in npm on PATH answers
// `view` with FAKE_NPM_LATEST, and fails like a real npm for anything else or
// when that is empty.
const FAKE_NPM = `#!/usr/bin/env node
const [verb, name] = process.argv.slice(2);
if (verb === "view" && name === "outbound-sdk" && process.env.FAKE_NPM_LATEST) {
  process.stdout.write(process.env.FAKE_NPM_LATEST + "\\n");
} else {
  process.stderr.write("npm error code E404\\nnpm error 404 Not Found\\n");
  process.exit(1);
}
`;

const withFakeNpm = async (
  latest: string,
  body: () => Promise<void>
): Promise<void> => {
  const dir = mkdtempSync(path.join(tmpdir(), "outbound-npm-"));
  const saved = { latest: process.env.FAKE_NPM_LATEST, path: process.env.PATH };

  writeFileSync(path.join(dir, "npm"), FAKE_NPM);
  chmodSync(path.join(dir, "npm"), 0o755);
  process.env.PATH = `${dir}${path.delimiter}${saved.path ?? ""}`;
  process.env.FAKE_NPM_LATEST = latest;

  try {
    await body();
  } finally {
    process.env.PATH = saved.path;

    if (saved.latest === undefined) {
      delete process.env.FAKE_NPM_LATEST;
    } else {
      process.env.FAKE_NPM_LATEST = saved.latest;
    }

    rmSync(dir, { force: true, recursive: true });
  }
};

test(
  "update runs the npm on PATH, and reports the last line npm printed when it fails",
  { skip: process.platform === "win32" },
  async () => {
    await withFakeNpm(version, async () => {
      const current = await cli(["update"]);

      assert.equal(current.code, 0);
      assert.equal(
        current.out,
        `outbound-sdk ${version} is the latest version.`
      );
    });

    // A newer version sends update on to `npm root --global`, which this npm
    // refuses: the install is then treated as a project one, never installed over.
    await withFakeNpm("999.0.0", async () => {
      const behind = await cli(["update"]);

      assert.equal(behind.code, 0);
      assert.match(
        behind.out,
        /npm install outbound-sdk@latest" in this project/u
      );
    });

    await withFakeNpm("", async () => {
      const broken = await cli(["update"]);

      assert.equal(broken.code, 1);
      assert.equal(
        broken.err,
        "Error: npm view outbound-sdk version failed: npm error 404 Not Found"
      );
    });
  }
);
