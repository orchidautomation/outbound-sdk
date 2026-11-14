#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline";

import { run } from "./index.ts";

process.exitCode = await run(process.argv.slice(2), {
  stderr: (text) => {
    process.stderr.write(`${text}\n`);
  },
  stdin: () => createInterface({ input: process.stdin }),
  stdout: (text) => {
    process.stdout.write(`${text}\n`);
  },
});
