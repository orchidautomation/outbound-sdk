// `outbound version` and `outbound update`. Update compares the installed version with the newest on npm and
// says how to get it. A global install is updated in place; a project install
// is only told the command, because installing would rewrite the project's
// package.json and lockfile; npx is told to ask for @latest.

import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { packageVersion } from "./version.ts";

/** Runs npm with these arguments and resolves to what it printed. */
export type NpmRunner = (args: readonly string[]) => Promise<string>;

const PACKAGE = "outbound-sdk";

// Commands that need no adapter and no key, with the flags each takes.
export const STANDALONE: ReadonlyMap<string, readonly string[]> = new Map([
  ["mcp", ["time-budget", "tools"]],
  ["providers", []],
  ["update", []],
  ["version", ["version"]],
]);

const execFileAsync = promisify(execFile);

/** npm failed. `code` is npm's error code, such as `E404`, when it printed one. */
export class NpmFailedError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined, cause: unknown) {
    super(message, { cause });
    this.name = "NpmFailedError";
    this.code = code;
  }
}

/** What npm said when it failed. */
interface NpmReason {
  /** npm's error code, such as `E404`. */
  readonly code: string | undefined;
  /** The first line that says what went wrong. */
  readonly said: string;
}

const NPM_LINE = /^npm (?:error|ERR!) ?(?<said>.*)$/u;
const NPM_CODE = /^code (?<code>E[A-Z0-9]+)$/u;

// Lines npm prints about the failed call before saying what went wrong.
const NPM_DETAIL = /^(?:code|syscall|path|errno|signal|cmd|cwd|command) /u;

/**
 * npm's code and the first line that says what went wrong. npm ends every
 * failure with "A complete log of this run can be found in: ...", so the last
 * line says nothing. npm starts its explanation lines with a tag, such as
 * `404`, `notarget` or the code in lower case, which is dropped.
 */
export const npmReason = (stderr: string): NpmReason => {
  const lines = stderr
    .split("\n")
    .map((line) => NPM_LINE.exec(line.trim())?.groups?.said?.trim() ?? "")
    .filter((line) => line !== "" && !line.startsWith("A complete log"));

  const code = lines
    .map((line) => NPM_CODE.exec(line)?.groups?.code)
    .find((found) => found !== undefined);

  const tags = new Set(["notarget", code?.toLowerCase()]);

  const untag = (line: string) => {
    const [first = "", ...rest] = line.split(" ");

    return /^\d{3}$/u.test(first) || tags.has(first)
      ? rest.join(" ").trim()
      : line;
  };

  const said =
    lines
      .filter((line) => !NPM_DETAIL.test(line))
      .map(untag)
      .find((line) => line !== "") ??
    stderr.trim().split("\n").at(-1) ??
    "";

  return { code, said };
};

export const runNpm: NpmRunner = async (args) => {
  try {
    // npm is npm.cmd on Windows, which only a shell can start.
    const { stdout } = await execFileAsync("npm", [...args], {
      shell: process.platform === "win32",
    });

    return stdout;
  } catch (error) {
    // execFile's error carries what npm printed to stderr.
    const stderr =
      error instanceof Error && "stderr" in error ? String(error.stderr) : "";

    const { code, said } = npmReason(stderr);
    const label = code === undefined ? "" : ` (${code})`;

    throw new NpmFailedError(
      `npm ${args.join(" ")} failed${label}${said === "" ? "" : `: ${said}`}`,
      code,
      error
    );
  }
};

/** Waits this many milliseconds. */
export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = async (ms) => {
  await setTimeoutPromise(ms);
};

// npm lists a new version minutes before its tarball can be downloaded: 0.7.0
// was listed at once and served 9 minutes later. Until then an install fails
// with E404 (tarball) or ETARGET (version not yet in the metadata npm read).
const NOT_YET_SERVED = new Set(["E404", "ETARGET"]);
const RETRY_EVERY_MS = 30_000;
const RETRY_FOR_MS = 15 * 60_000;

const installGlobal = async (
  npm: NpmRunner,
  say: (text: string) => void,
  wait: Sleep,
  version: string
): Promise<void> => {
  const target = `${PACKAGE}@${version}`;
  const tries = RETRY_FOR_MS / RETRY_EVERY_MS;

  for (let attempt = 1; ; attempt += 1) {
    try {
      // After a miss, ask the registry again instead of npm's cached metadata.
      // oxlint-disable-next-line no-await-in-loop -- each try waits for the one before
      await npm(
        attempt === 1
          ? ["install", "--global", target]
          : ["install", "--global", "--prefer-online", target]
      );

      return;
    } catch (error) {
      const code = error instanceof NpmFailedError ? error.code : undefined;

      if (code === undefined || !NOT_YET_SERVED.has(code) || attempt > tries) {
        throw error;
      }

      if (attempt === 1) {
        say(
          `npm lists ${version} but is not serving it yet, which happens for a few minutes after a release. Trying again every ${RETRY_EVERY_MS / 1000} seconds for up to ${RETRY_FOR_MS / 60_000} minutes; Ctrl-C stops.`
        );
      }

      // oxlint-disable-next-line no-await-in-loop -- the wait between tries is the point
      await wait(RETRY_EVERY_MS);
    }
  }
};

// The package folder: two up from this module in the source (src/cli/) and
// from every built file it can land in (dist/cli/, dist/chunks/).
const packageDir = () =>
  path.dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

const parts = (version: string) =>
  version
    .split("-")[0]
    ?.split(".")
    .map((part) => Math.trunc(Number(part)) || 0) ?? [];

/** Whether `a` is older than `b`, comparing major, minor and patch. */
const older = (a: string, b: string): boolean => {
  const [left, right] = [parts(a), parts(b)];

  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) {
      return difference < 0;
    }
  }

  return false;
};

type Install = "global" | "npx" | "project";

const installKind = async (npm: NpmRunner, dir: string): Promise<Install> => {
  if (dir.split(path.sep).includes("_npx")) {
    return "npx";
  }

  const printed = await npm(["root", "--global"]).catch(() => "");
  const globalRoot = printed.trim();

  return globalRoot !== "" && path.dirname(dir) === path.resolve(globalRoot)
    ? "global"
    : "project";
};

/** Checks npm for a newer version and updates a global install. */
export const update = async (
  npm: NpmRunner,
  say: (text: string) => void,
  wait: Sleep = sleep
): Promise<void> => {
  const installed = packageVersion();
  const viewed = await npm(["view", PACKAGE, "version"]);
  const latest = viewed.trim();

  if (!older(installed, latest)) {
    say(`${PACKAGE} ${installed} is the latest version.`);

    return;
  }

  say(`${PACKAGE} ${installed} is installed; ${latest} is the latest.`);

  const kind = await installKind(npm, packageDir());

  if (kind === "npx") {
    say(`Run "npx ${PACKAGE}@latest <command>" to use ${latest}.`);

    return;
  }

  if (kind === "project") {
    say(`Run "npm install ${PACKAGE}@latest" in this project to update it.`);

    return;
  }

  say(`Running "npm install --global ${PACKAGE}@${latest}"...`);
  await installGlobal(npm, say, wait, latest);
  say(`Updated ${PACKAGE} to ${latest}.`);
};

/**
 * Runs `version` (also a bare `--version`) or `update`, and says whether it
 * did. Version comes before help, which is what no command at all prints;
 * `update --help` prints help.
 */
export const runSelf = async (
  name: string | undefined,
  flags: { readonly help?: boolean; readonly version?: boolean },
  npm: NpmRunner,
  say: (text: string) => void,
  wait: Sleep = sleep
): Promise<boolean> => {
  if (name === "version" || (name === undefined && flags.version === true)) {
    say(packageVersion());

    return true;
  }

  if (name === "update" && flags.help !== true) {
    await update(npm, say, wait);

    return true;
  }

  return false;
};
