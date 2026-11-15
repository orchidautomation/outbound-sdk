// Stands in for `node:test` inside Cloudflare's Workers runtime, which has no
// test runner. scripts/workers-tests.mjs bundles every test file against this
// module, so tests are registered here and run by `runAll` from the Worker's
// fetch handler. `node:assert` is the runtime's own, from `nodejs_compat`.
//
// Only what the bundled tests use is supported: `test`, `after` and
// `mock.timers` for `Date`. Anything else throws, so a test that needs more
// fails loudly instead of passing for the wrong reason.

const tests = [];
const afters = [];
let currentFile = "";

export const setFile = (file) => {
  currentFile = file;
};

export const test = (name, options, fn) => {
  // `test(name, fn)` or `test(name, options, fn)`.
  const body = fn ?? options;
  const settings = fn ? options : {};
  tests.push({ body, file: currentFile, name, skip: Boolean(settings.skip) });
};

export const after = (fn) => {
  afters.push({ file: currentFile, fn });
};

const RealDate = globalThis.Date;
let frozen = null;

class MockDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(frozen);
    } else {
      super(...args);
    }
  }

  static now() {
    return frozen;
  }
}

const unsupported = (what) => () => {
  throw new Error(`${what} is not supported in the Workers test run`);
};

export const mock = {
  fn: unsupported("mock.fn"),
  method: unsupported("mock.method"),
  timers: {
    enable({ apis = [], now = 0 } = {}) {
      if (apis.length !== 1 || apis[0] !== "Date") {
        throw new Error("Only mock.timers for Date runs on Workers");
      }

      frozen = now instanceof RealDate ? now.getTime() : Number(now);
      globalThis.Date = MockDate;
    },
    reset() {
      frozen = null;
      globalThis.Date = RealDate;
    },
    tick(milliseconds) {
      frozen += milliseconds;
    },
  },
};

const context = {
  mock: {
    method: unsupported("t.mock.method"),
    restoreAll: unsupported("t.mock.restoreAll"),
  },
};

const describe = (error) =>
  error instanceof Error ? (error.stack ?? String(error)) : String(error);

const runOne = async ({ body, file, name, skip }) => {
  if (skip) {
    return { file, name, status: "skip" };
  }

  try {
    await body(context);

    return { file, name, status: "pass" };
  } catch (error) {
    return { error: describe(error), file, name, status: "fail" };
  } finally {
    mock.timers.reset();
  }
};

// Runs files in order, each file's tests in order and then its `after` hooks,
// as `node --test` does within one file.
export const runAll = async () => {
  const results = [];
  const files = [...new Set(tests.map((entry) => entry.file))];

  for (const file of files) {
    for (const entry of tests.filter((candidate) => candidate.file === file)) {
      // oxlint-disable-next-line no-await-in-loop -- tests in a file run one at a time, as under node --test
      results.push(await runOne(entry));
    }

    for (const hook of afters.filter((candidate) => candidate.file === file)) {
      // oxlint-disable-next-line no-await-in-loop -- hooks run after the file's tests, one at a time
      results.push(await runOne({ body: hook.fn, file, name: "after hook" }));
    }
  }

  return results;
};
