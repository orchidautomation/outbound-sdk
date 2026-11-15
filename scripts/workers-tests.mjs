#!/usr/bin/env node

// Runs the package's tests inside Cloudflare's Workers runtime (workerd, via
// Miniflare), so nothing that breaks on Workers can merge. CI runs it as its
// own job; `npm run test:workers` runs it locally.
//
// Which tests run is worked out, not listed: every test file runs unless what
// it imports reaches a Node built-in or a folder that architecture-rules.mjs
// lets use Node (`nodeFolders`). The fixtures helper reads from disk, so it is
// swapped for the same fixtures embedded in the bundle. Every public subpath
// outside the Node folders is loaded, and every other source folder,
// including an adapter added later, must be reached by something that runs.

import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";

import { build } from "esbuild";

import {
  filesUnder,
  layers,
  nodeFolders,
  publicEntries,
  sourceRoot,
  testRoot,
} from "./architecture-rules.mjs";

const runtimeShim = path.join(
  import.meta.dirname,
  "workers-runtime/node-test.mjs"
);

// The Worker supplies these: `node:test` from the shim, `node:assert` from
// the runtime's own `nodejs_compat`.
const harnessModules = new Set([
  "node:assert",
  "node:assert/strict",
  "node:test",
]);

// Globals `nodejs_compat` adds. They are removed before any SDK code loads,
// because a Worker without that flag does not have them. (`setImmediate`
// cannot be removed, and is only a timer.) `process` comes back as just
// `{ env }`, which is what the env-key tests set and the SDK reads.
export const nodeGlobals = ["Buffer", "global", "process"];

const fixturesHelper = `${testRoot}/helpers/fixtures.ts`;

export const workersSafeFolders = Object.keys(layers).filter(
  (folder) => !nodeFolders.includes(folder)
);

const inNodeFolder = (file) =>
  nodeFolders.some((folder) => file.startsWith(`${sourceRoot}/${folder}/`));

const embeddedFixtures = (root) => {
  const files = Object.fromEntries(
    filesUnder(root, "fixtures").map((file) => [
      file.slice("fixtures/".length),
      readFileSync(path.join(root, file), "utf-8"),
    ])
  );

  return `const files = ${JSON.stringify(files)};
export const fixtureText = (provider, name) => {
  const text = files[provider + "/" + name];
  if (text === undefined) throw new Error("No fixture " + provider + "/" + name);
  return text;
};
export const fixture = (provider, name) => JSON.parse(fixtureText(provider, name));
`;
};

// `node:test` resolves to the shim and the fixtures helper to embedded
// fixtures. Every other Node built-in, with or without the `node:` prefix,
// stays external so the plan can see who imports it.
const workersPlugin = (root) => ({
  name: "workers-runtime",
  setup(context) {
    // oxlint-disable-next-line require-unicode-regexp -- esbuild filters are Go regular expressions, which reject the u flag
    context.onResolve({ filter: /^[a-z_:/]+$/ }, ({ path: specifier }) => {
      if (specifier === "node:test") {
        return { path: runtimeShim };
      }

      return isBuiltin(specifier)
        ? { external: true, path: specifier.replace(/^(?!node:)/u, "node:") }
        : undefined;
    });
    // oxlint-disable-next-line require-unicode-regexp -- esbuild filters are Go regular expressions, which reject the u flag
    context.onLoad({ filter: /fixtures\.ts$/ }, ({ path: file }) =>
      file === path.join(root, fixturesHelper)
        ? { contents: embeddedFixtures(root), loader: "js" }
        : undefined
    );
  },
});

const bundle = (root, options) =>
  build({
    absWorkingDir: root,
    bundle: true,
    conditions: ["workerd", "worker"],
    format: "esm",
    logLevel: "error",
    platform: "browser",
    plugins: [workersPlugin(root)],
    write: false,
    ...options,
  });

const folderOf = (file) => file.split("/").slice(0, 4).join("/");

const packageOf = (file) =>
  file.match(/node_modules\/(?<name>(?:@[^/]+\/)?[^/]+)/u)?.groups?.name ??
  file;

// Why a bundled file cannot run on Workers, or undefined when it can.
const blockerIn = (metafile, input) => {
  if (inNodeFolder(input)) {
    return `reaches ${folderOf(input)}`;
  }

  const builtin = metafile.inputs[input]?.imports.find(
    (entry) => entry.path.startsWith("node:") && !harnessModules.has(entry.path)
  );

  return builtin && `${packageOf(input)} imports ${builtin.path}`;
};

export const testFiles = (root) =>
  filesUnder(root, testRoot)
    .filter((file) => file.endsWith(".test.ts"))
    .toSorted();

const byFile = (a, b) => a.file.localeCompare(b.file);

// Sorts test files and public subpaths into those that run on Workers and
// those that cannot, and names any Workers-safe folder nothing that runs
// reaches.
export const planWorkersTests = async (root, folders = workersSafeFolders) => {
  const tests = testFiles(root);
  const entries = publicEntries(root).filter((file) => !inNodeFolder(file));

  const { metafile } = await bundle(root, {
    entryPoints: [...new Set([...tests, ...entries])],
    metafile: true,
    outbase: root,
    outdir: "workers-plan",
  });

  const plan = { entries: [], excluded: [], included: [] };
  const reached = new Set();

  for (const { entryPoint, inputs } of Object.values(metafile.outputs)) {
    const files = Object.keys(inputs);

    const reason = files
      .map((input) => blockerIn(metafile, input))
      .find(Boolean);

    if (reason) {
      plan.excluded.push({ file: entryPoint, reason });
      continue;
    }

    plan[tests.includes(entryPoint) ? "included" : "entries"].push(entryPoint);

    for (const input of files) {
      reached.add(folderOf(input));
    }
  }

  return {
    entries: plan.entries.toSorted(),
    excluded: plan.excluded.toSorted(byFile),
    included: plan.included.toSorted(),
    unreached: folders.filter(
      (folder) => !reached.has(`${sourceRoot}/${folder}`)
    ),
  };
};

// The Worker: strip Node's globals, load every Workers-safe public subpath,
// then each test file in turn, and answer with the results as JSON.
const workerSource = (root, plan) => {
  const load = (file) =>
    `[${JSON.stringify(file)}, () => import(${JSON.stringify(path.join(root, file))})]`;

  return `import { runAll, setFile } from ${JSON.stringify(runtimeShim)};
const entries = [${plan.entries.map(load).join(",\n")}];
const tests = [${plan.included.map(load).join(",\n")}];
const globals = ${JSON.stringify(nodeGlobals)};
const loadAll = async (modules, results, label) => {
  for (const [file, importModule] of modules) {
    setFile(file);
    try {
      await importModule();
      if (label) results.push({ file, name: label, status: "pass" });
    } catch (error) {
      results.push({ error: String(error?.stack ?? error), file, name: label ?? "file loads", status: "fail" });
    }
  }
};
export default {
  async fetch() {
    for (const name of globals) delete globalThis[name];
    const leaked = globals.filter((name) => name in globalThis);
    if (leaked.length > 0) return new Response("Node globals remain: " + leaked.join(", "), { status: 500 });
    globalThis.process = { env: {} };
    const results = [];
    await loadAll(entries, results, "loads on Workers");
    await loadAll(tests, results);
    results.push(...(await runAll()));
    return Response.json(results);
  },
};
`;
};

export const runOnWorkers = async (root, plan) => {
  const { outputFiles } = await bundle(root, {
    outfile: "workers-tests.js",
    stdin: {
      contents: workerSource(root, plan),
      loader: "js",
      resolveDir: root,
    },
  });

  const { Miniflare } = await import("miniflare");

  const worker = new Miniflare({
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    modules: true,
    script: outputFiles[0].text,
  });

  try {
    const response = await worker.dispatchFetch(
      "http://workers-tests.invalid/"
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return await response.json();
  } finally {
    await worker.dispose();
  }
};

const report = (plan, results) => {
  const failed = results.filter((result) => result.status === "fail");

  const count = (status) =>
    results.filter((result) => result.status === status).length;

  for (const result of failed) {
    console.error(`not ok - ${result.file}: ${result.name}\n${result.error}\n`);
  }

  console.log(`Not run on Workers (${plan.excluded.length}):`);

  for (const { file, reason } of plan.excluded) {
    console.log(`  ${file} (${reason})`);
  }

  for (const folder of plan.unreached) {
    console.error(
      `Nothing that runs on Workers reaches ${sourceRoot}/${folder}/`
    );
  }

  console.log(
    `workers: ${count("pass")} passed, ${failed.length} failed, ${count("skip")} skipped, across ${plan.included.length} test files`
  );

  if (plan.included.length === 0) {
    console.error("No test file can run on Workers, so nothing was proven");
  }

  return (
    failed.length === 0 &&
    plan.unreached.length === 0 &&
    plan.included.length > 0
  );
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const root = process.cwd();
  const plan = await planWorkersTests(root);
  const results = await runOnWorkers(root, plan);
  process.exitCode = report(plan, results) ? 0 : 1;
}
