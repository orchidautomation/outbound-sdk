// Runs the real CLI in this process, the way the `outbound` executable does,
// and prints what a terminal would show.
import process from "node:process";

import { run } from "outbound-sdk/cli";

// The in-memory adapter with its demo data: no key, no network.
process.env.OUTBOUND_SDK_PROVIDER = "memory";

const quote = (argument: string): string =>
  /^[\w./:=-]+$/u.test(argument) ? argument : `'${argument}'`;

const execute = async (argv: readonly string[]) => {
  const lines: string[] = [];

  const code = await run(argv, {
    stderr: (text) => {
      lines.push(text);
    },
    stdout: (text) => {
      lines.push(text);
    },
  });

  console.log(
    `$ outbound ${argv.map((argument) => quote(argument)).join(" ")}`
  );

  return { code, text: lines.join("\n") };
};

/** Runs `outbound <argv>`, then prints the command, its output and a failing exit code. */
export const outbound = async (...argv: string[]): Promise<void> => {
  const { code, text } = await execute(argv);
  console.log(text);

  if (code !== 0) {
    console.log(`(exit code ${code})`);
  }

  console.log("");
};

/**
 * For output too long to show: runs the command and prints, in brackets, what
 * `describe` says about the output instead of the output itself.
 */
export const outboundSummary = async (
  argv: readonly string[],
  describe: (text: string) => string
): Promise<void> => {
  const { text } = await execute(argv);
  console.log(`[${describe(text)}]\n`);
};
