#!/usr/bin/env node

// The nightly vendor-drift agent may only touch one vendor's mapping,
// capabilities, webhooks, fixtures and research note. This check backs up
// that instruction mechanically: given a vendor and the changed files, it
// fails when any file is outside that vendor's scope.
//
//   node scripts/check-drift-scope.mjs <vendor> < changed-files.txt

import path from "node:path";

const adapterFiles = /^(?:map(?:-[\w-]+)?|capabilities|webhooks)\.ts$/u;

export const allowedForVendor = (vendor, file) => {
  const source = `packages/outbound-sdk/src/${vendor}/`;

  return (
    (file.startsWith(source) && adapterFiles.test(file.slice(source.length))) ||
    file.startsWith(`fixtures/${vendor}/`) ||
    file.startsWith(`packages/outbound-sdk/test/${vendor}/`) ||
    file === `docs/research/${vendor}.md` ||
    /^\.changeset\/[\w-]+\.md$/u.test(file)
  );
};

export const outOfScope = (vendor, files) =>
  /^[a-z][a-z0-9-]*$/u.test(vendor)
    ? files.filter((file) => !allowedForVendor(vendor, file))
    : [`"${vendor}" is not a vendor name`];

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const [vendor = ""] = process.argv.slice(2);
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  const files = Buffer.concat(chunks)
    .toString("utf-8")
    .split("\n")
    .filter(Boolean);

  const problems = outOfScope(vendor, files);

  for (const file of problems) {
    console.error(`FAIL ${file}: outside the ${vendor} drift scope`);
  }

  console.log(
    `Drift scope: ${problems.length} file(s) out of scope of ${files.length} changed`
  );
  process.exitCode = problems.length > 0 ? 1 : 0;
}
