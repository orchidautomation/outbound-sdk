// Dependency rules for the package, checked by scripts/check-architecture.mjs
// over resolved imports. Every folder under src/ must be declared here with the
// folders it may import. docs/engineering-guardrails.md explains each rule.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const sourceRoot = "packages/outbound-sdk/src";
export const testRoot = "packages/outbound-sdk/test";

export const adapters = ["heyreach", "instantly", "memory", "smartlead"];

// Folder -> the other src/ folders it may import. "internal" holds the request
// engine and core types; an adapter may import it and nothing else.
export const layers = {
  alerts: ["internal"],
  audit: ["internal"],
  benchmarks: ["internal"],
  budget: ["internal"],
  cache: ["internal"],
  cards: ["alerts", "internal", "tools"],
  clients: ["combine", "internal"],
  cli: [
    "budget",
    "cache",
    "cards",
    "identity",
    "insights",
    "internal",
    "loader",
    "providers",
    "redact",
    "tools",
  ],
  combine: ["internal"],
  exporter: ["internal", "sync"],
  failover: ["cache", "internal"],
  fixtures: ["internal"],
  identity: ["combine", "internal"],
  insights: ["internal", "tools"],
  internal: [],
  loader: [...adapters, "combine", "internal", "providers"],
  providers: [],
  reconcile: ["internal", "sync"],
  redact: ["internal"],
  redis: ["internal"],
  sync: ["internal"],
  tools: ["internal"],
  tracing: ["internal"],
  webhooks: [...adapters, "internal"],
  ...Object.fromEntries(adapters.map((name) => [name, ["internal"]])),
};

// Folders that may use Node built-ins. Everything else stays on web standards
// so the core runs on Node, Bun and Cloudflare Workers.
export const nodeFolders = ["cli", "exporter", "fixtures"];

// External packages a folder may import. zod is the only runtime dependency.
export const externalPackages = {
  insights: ["zod"],
  tools: ["zod", "ai", "@anthropic-ai/claude-agent-sdk"],
};

const escapePattern = (value) => RegExp.escape(value);
const anyOf = (names) => `(?:${names.map(escapePattern).join("|")})`;

export const filesUnder = (root, directory) => {
  const absolute = path.join(root, directory);

  if (!existsSync(absolute)) {
    return [];
  }

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") {
      return [];
    }

    const relative = `${directory}/${entry.name}`;

    if (entry.isDirectory()) {
      return filesUnder(root, relative);
    }

    return entry.isFile() ? [relative] : [];
  });
};

const folderRules = () =>
  Object.entries(layers).flatMap(([name, allowed]) => {
    const from = { path: `^${sourceRoot}/${escapePattern(name)}/` };
    const packages = externalPackages[name] ?? ["zod"];

    return [
      {
        from,
        name: `${name}-dependency-direction`,
        severity: "error",
        to: {
          path: `^${sourceRoot}/`,
          pathNot: `^${sourceRoot}/${anyOf([name, ...allowed])}/`,
        },
      },
      {
        from,
        name: `${name}-external-packages`,
        severity: "error",
        to: {
          path: "(?:^|/)node_modules/",
          pathNot: `(?:^|/)node_modules/${anyOf(packages)}/`,
        },
      },
    ];
  });

// Dependency rules only fire on an import, so a file that imports nothing
// needs the orphan form to be caught too.
const undeclaredFolderRules = () => {
  const from = {
    path: `^${sourceRoot}/[^/]+/`,
    pathNot: `^${sourceRoot}/${anyOf(Object.keys(layers))}/`,
  };

  return [
    { from, name: "undeclared-source-folder", severity: "error", to: {} },
    {
      from: { ...from, orphan: true },
      name: "undeclared-source-folder-orphan",
      severity: "error",
      to: {},
    },
  ];
};

const packageRoot = "packages/outbound-sdk";

// The source file behind each public subpath and each executable. These,
// and every folder's index.ts, are the only files a test may import.
export const publicEntries = (root) => {
  const manifestPath = path.join(root, packageRoot, "package.json");

  if (!existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  const targets = [
    ...Object.values(manifest.exports ?? {}).map((entry) => entry.import),
    ...Object.values(manifest.bin ?? {}),
  ];

  return targets.map(
    (target) =>
      `${packageRoot}/${target.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts")}`
  );
};

export const architectureRules = (root = process.cwd()) => ({
  forbidden: [
    { from: {}, name: "no-cycles", severity: "error", to: { circular: true } },
    {
      from: {},
      name: "no-unresolved-imports",
      severity: "error",
      to: { couldNotResolve: true },
    },
    ...undeclaredFolderRules(),
    {
      // The package entry and the env loader sit at the root of src/.
      from: { path: `^${sourceRoot}/index\\.ts$` },
      name: "entry-imports-internal-only",
      severity: "error",
      to: { path: `^${sourceRoot}/`, pathNot: `^${sourceRoot}/internal/` },
    },
    {
      from: {
        path: `^${sourceRoot}/`,
        pathNot: `^${sourceRoot}/${anyOf(nodeFolders)}/`,
      },
      name: "web-standards-only",
      severity: "error",
      to: { dependencyTypes: ["core"] },
    },
    {
      from: { path: `^${sourceRoot}/` },
      name: "no-production-test-imports",
      severity: "error",
      to: { path: `^${testRoot}/|\\.test\\.[^.]+$` },
    },
    {
      // Tests use the same surface callers do: a folder's index.ts, or a
      // file package.json publishes as a subpath or an executable.
      from: { path: `^${testRoot}/` },
      name: "tests-use-entry-points",
      severity: "error",
      to: {
        path: `^${sourceRoot}/`,
        pathNot: [
          `^${sourceRoot}/index\\.ts$`,
          `^${sourceRoot}/[^/]+/index\\.ts$`,
          ...publicEntries(root).map((file) => `^${escapePattern(file)}$`),
        ],
      },
    },
    ...folderRules(),
  ],
});
