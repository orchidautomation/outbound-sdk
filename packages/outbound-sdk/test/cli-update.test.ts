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
    "install --global outbound-sdk@999.0.0",
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
// `view` with FAKE_NPM_LATEST and `root --global` with FAKE_NPM_ROOT, fails
// `install` with npm's real E404 output FAKE_NPM_MISSES times before it
// succeeds (or with EACCES when FAKE_NPM_EACCES is set), and fails like a
// real npm for anything else. It appends each call
// to FAKE_NPM_LOG.
const FAKE_NPM = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.FAKE_NPM_LOG, args.join(" ") + "\\n");
const installs = fs.readFileSync(env.FAKE_NPM_LOG, "utf8").split("\\n").filter((line) => line.startsWith("install")).length;
const fail = (lines) => {
  process.stderr.write(lines.map((line) => "npm error " + line).join("\\n") + "\\n");
  process.exit(1);
};
const e404 = (what) => fail([
  "code E404",
  "404 Not Found - GET https://registry.npmjs.org/" + what + " - Not found",
  "404",
  "404  The requested resource could not be found or you do not have permission to access it.",
  "A complete log of this run can be found in: /home/someone/.npm/_logs/debug-0.log",
]);
if (args[0] === "view" && env.FAKE_NPM_LATEST) {
  process.stdout.write(env.FAKE_NPM_LATEST + "\\n");
} else if (args[0] === "root" && env.FAKE_NPM_ROOT) {
  process.stdout.write(env.FAKE_NPM_ROOT + "\\n");
} else if (args[0] === "install" && env.FAKE_NPM_EACCES) {
  fail(["code EACCES", "syscall mkdir", "path /usr/local/lib/node_modules/outbound-sdk", "errno -13", "Error: EACCES: permission denied, mkdir", "A complete log of this run can be found in: /x.log"]);
} else if (args[0] === "install" && installs > Number(env.FAKE_NPM_MISSES ?? 0)) {
  process.exit(0);
} else {
  e404("outbound-sdk");
}
`;

interface FakeNpmEnv {
  readonly latest: string;
  readonly root?: string;
  readonly misses?: number;
  readonly eacces?: boolean;
}

const withFakeNpm = async (
  setup: FakeNpmEnv,
  body: (calls: () => string[]) => Promise<void>
): Promise<void> => {
  const dir = mkdtempSync(path.join(tmpdir(), "outbound-npm-"));
  const log = path.join(dir, "calls.log");

  const names = [
    "FAKE_NPM_LATEST",
    "FAKE_NPM_ROOT",
    "FAKE_NPM_MISSES",
    "FAKE_NPM_LOG",
    "FAKE_NPM_EACCES",
    "PATH",
  ] as const;

  const saved = new Map(names.map((name) => [name, process.env[name]]));

  writeFileSync(path.join(dir, "npm"), FAKE_NPM);
  writeFileSync(log, "");
  chmodSync(path.join(dir, "npm"), 0o755);
  process.env.PATH = `${dir}${path.delimiter}${saved.get("PATH") ?? ""}`;
  process.env.FAKE_NPM_LATEST = setup.latest;
  process.env.FAKE_NPM_ROOT = setup.root ?? "";
  process.env.FAKE_NPM_MISSES = String(setup.misses ?? 0);
  process.env.FAKE_NPM_LOG = log;
  process.env.FAKE_NPM_EACCES = setup.eacces === true ? "1" : "";

  try {
    await body(() =>
      readFileSync(log, "utf-8")
        .split("\n")
        .filter((line) => line !== "")
    );
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }

    rmSync(dir, { force: true, recursive: true });
  }
};

const POSIX = { skip: process.platform === "win32" };

test(
  "update runs the npm on PATH, and reports npm's code and reason, not its log pointer",
  POSIX,
  async () => {
    await withFakeNpm({ latest: version }, async () => {
      const current = await cli(["update"]);

      assert.equal(current.code, 0);
      assert.equal(
        current.out,
        `outbound-sdk ${version} is the latest version.`
      );
    });

    // A newer version sends update on to `npm root --global`, which this npm
    // refuses: the install is then treated as a project one, never installed over.
    await withFakeNpm({ latest: "999.0.0" }, async () => {
      const behind = await cli(["update"]);

      assert.equal(behind.code, 0);
      assert.match(
        behind.out,
        /npm install outbound-sdk@latest" in this project/u
      );
    });

    await withFakeNpm({ latest: "" }, async () => {
      const broken = await cli(["update"]);

      assert.equal(broken.code, 1);
      assert.equal(
        broken.err,
        "Error: npm view outbound-sdk version failed (E404): Not Found - GET https://registry.npmjs.org/outbound-sdk - Not found"
      );
    });
  }
);

// The 0.7.0 release: npm listed it at once, and its tarball returned E404
// for the next 9 minutes.
test(
  "update waits out a version npm lists but does not serve yet, then installs it",
  POSIX,
  async () => {
    const root = path.dirname(packageDir);

    await withFakeNpm({ latest: "999.0.0", misses: 2, root }, async (calls) => {
      const waits: number[] = [];
      const out: string[] = [];

      const code = await run(["update"], {
        sleep: (ms) => {
          waits.push(ms);

          return Promise.resolve();
        },
        stderr: () => {},
        stdout: (text) => {
          out.push(text);
        },
      });

      assert.equal(code, 0);
      assert.deepEqual(calls(), [
        "view outbound-sdk version",
        "root --global",
        "install --global outbound-sdk@999.0.0",
        "install --global --prefer-online outbound-sdk@999.0.0",
        "install --global --prefer-online outbound-sdk@999.0.0",
      ]);
      assert.deepEqual(waits, [30_000, 30_000]);
      assert.equal(
        out.filter((line) => line.includes("not serving it yet")).length,
        1
      );
      assert.equal(out.at(-1), "Updated outbound-sdk to 999.0.0.");
    });
  }
);

test(
  "update gives up after 15 minutes of E404 and reports npm's reason",
  POSIX,
  async () => {
    const root = path.dirname(packageDir);

    await withFakeNpm(
      { latest: "999.0.0", misses: 1000, root },
      async (calls) => {
        let waited = 0;
        const err: string[] = [];

        const code = await run(["update"], {
          sleep: (ms) => {
            waited += ms;

            return Promise.resolve();
          },
          stderr: (text) => {
            err.push(text);
          },
          stdout: () => {},
        });

        assert.equal(code, 1);
        assert.equal(waited, 15 * 60_000);
        assert.equal(
          calls().filter((call) => call.startsWith("install")).length,
          31
        );
        assert.match(
          err.join("\n"),
          /^Error: npm install --global --prefer-online outbound-sdk@999\.0\.0 failed \(E404\): Not Found - GET /u
        );
      }
    );
  }
);

test(
  "update does not retry a failure that waiting cannot fix",
  POSIX,
  async () => {
    const root = path.dirname(packageDir);

    await withFakeNpm(
      { eacces: true, latest: "999.0.0", root },
      async (calls) => {
        const err: string[] = [];

        const code = await run(["update"], {
          sleep: () => Promise.reject(new Error("update waited")),
          stderr: (text) => {
            err.push(text);
          },
          stdout: () => {},
        });

        assert.equal(code, 1);
        assert.equal(
          calls().filter((call) => call.startsWith("install")).length,
          1
        );
        assert.equal(
          err.join("\n"),
          "Error: npm install --global outbound-sdk@999.0.0 failed (EACCES): Error: EACCES: permission denied, mkdir"
        );
      }
    );
  }
);
