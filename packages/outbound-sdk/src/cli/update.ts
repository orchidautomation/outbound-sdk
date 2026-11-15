// `outbound version` and `outbound update`. Update compares the installed version with the newest on npm and
// says how to get it. A global install is updated in place; a project install
// is only told the command, because installing would rewrite the project's
// package.json and lockfile; npx is told to ask for @latest.

import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { packageVersion } from "./version.ts";

/** Runs npm with these arguments and resolves to what it printed. */
export type NpmRunner = (args: readonly string[]) => Promise<string>;

const PACKAGE = "outbound-sdk";

// Commands that need no adapter and no key, with the flags each takes.
export const STANDALONE: ReadonlyMap<string, readonly string[]> = new Map([
  ["mcp", []],
  ["providers", []],
  ["update", []],
  ["version", ["version"]],
]);

const execFileAsync = promisify(execFile);

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

    const said = stderr.trim().split("\n").at(-1) ?? "";

    throw new Error(
      `npm ${args.join(" ")} failed${said === "" ? "" : `: ${said}`}`,
      { cause: error }
    );
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
  say: (text: string) => void
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

  say(`Running "npm install --global ${PACKAGE}@latest"...`);
  await npm(["install", "--global", `${PACKAGE}@latest`]);
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
  say: (text: string) => void
): Promise<boolean> => {
  if (name === "version" || (name === undefined && flags.version === true)) {
    say(packageVersion());

    return true;
  }

  if (name === "update" && flags.help !== true) {
    await update(npm, say);

    return true;
  }

  return false;
};
