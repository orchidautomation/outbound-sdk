#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline";

import { run } from "./index.ts";

// A reader that stops early, as `outbound tools | head` does, closes the pipe:
// the rest of the output has nowhere to go, so the command ends quietly. Any
// other failure to write the output is exit 1.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  process.exit(error.code === "EPIPE" ? 0 : 1);
});

process.exitCode = await run(process.argv.slice(2), {
  stderr: (text) => {
    process.stderr.write(`${text}\n`);
  },
  stdin: () => createInterface({ input: process.stdin }),
  stdout: (text) => {
    process.stdout.write(`${text}\n`);
  },
});
