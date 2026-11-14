#!/usr/bin/env node

// Recorded vendor payloads must not contain real people, companies or
// credentials. This scans every fixture for the things that can be detected
// mechanically: email addresses outside reserved test domains, real LinkedIn
// profile URLs, and strings that look like keys or tokens.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// RFC 2606 and RFC 6761 reserve these for documentation and testing.
const allowedDomain =
  /(?:^|\.)(?:example\.(?:com|net|org)|test|invalid|localhost)$/iu;

const email = /[\w.!#$%&'*+/=?^`{|}~-]+@(?<domain>[\w-]+(?:\.[\w-]+)+)/gu;

const linkedinProfile =
  /linkedin\.com\/(?:in|sales\/lead|sales\/people)\/(?<slug>[^\s"'/?#\\]+)/giu;

const secretPatterns = [
  [/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/u, "a JSON Web Token"],
  [/\b(?:sk|pk|rk)_(?:live|test)_[\dA-Za-z]{16,}/u, "an API key"],
  [/\bBearer\s+[\w.~+/-]{20,}/u, "a bearer token"],
  [/\bwhsec_[\dA-Za-z+/=]{16,}/u, "a webhook signing secret"],
  [
    /"(?:password|smtp_password|imap_password|api_key|apiKey|secret_key)"\s*:\s*"(?!\[?redacted|\*+"|")[^"]{6,}"/iu,
    "a credential field with a value",
  ],
];

export const findProblems = (file, contents) => {
  const problems = [];

  for (const match of contents.matchAll(email)) {
    if (!allowedDomain.test(match.groups.domain)) {
      problems.push(
        `${file}: email address at a real domain (${match.groups.domain})`
      );
    }
  }

  for (const match of contents.matchAll(linkedinProfile)) {
    if (!/^example/iu.test(match.groups.slug)) {
      problems.push(
        `${file}: LinkedIn profile "${match.groups.slug}" is not an example- placeholder`
      );
    }
  }

  for (const [pattern, what] of secretPatterns) {
    if (pattern.test(contents)) {
      problems.push(`${file}: looks like it contains ${what}`);
    }
  }

  return problems;
};

export const checkFixtures = (root) => {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "fixtures",
    ],
    {
      cwd: root,
      encoding: "utf-8",
    }
  )
    .split("\0")
    .filter((file) => file && /\.(?:json|txt|md)$/u.test(file));

  return {
    files: files.length,
    problems: files.flatMap((file) =>
      findProblems(file, readFileSync(path.join(root, file), "utf-8"))
    ),
  };
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const result = checkFixtures(process.cwd());

  for (const problem of result.problems) {
    console.error(`FAIL ${problem}`);
  }

  console.log(
    `Fixtures: ${result.problems.length} problem(s) in ${result.files} file(s)`
  );
  process.exitCode = result.problems.length > 0 ? 1 : 0;
}
