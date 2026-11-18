import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

// The limits are documented in docs/engineering-guardrails.md.
// A rule is suppressed only inline, with a reason:
//   // oxlint-disable-next-line <rule> -- <why>
export default defineConfig({
  extends: [core, antiSlop],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "fixtures/**",
    "**/CHANGELOG.md",
  ],
  jsPlugins: ["oxlint-plugin-complexity"],
  overrides: [
    {
      // Only internal/ may call fetch: every adapter and plugin request goes
      // through the request engine, so none can bypass the rate budget.
      excludeFiles: ["packages/outbound-sdk/src/internal/**"],
      files: ["packages/outbound-sdk/src/**"],
      rules: {
        "no-restricted-globals": [
          "error",
          {
            message: "Only src/internal may call fetch. Use ctx.request().",
            name: "fetch",
          },
        ],
      },
    },
    {
      // A documentation sample reads top to bottom, one call after another,
      // and prints what it found.
      files: ["site/content/_examples/**"],
      rules: {
        "no-await-in-loop": "off",
        "no-console": "off",
      },
    },
    {
      // eve names a tool after its file, and tool names are snake_case, such
      // as eve's own `no_reply`.
      files: ["examples/*/agent/tools/**"],
      rules: {
        "unicorn/filename-case": "off",
      },
    },
    {
      // The eval suite is a test client: it reads tool output it must not
      // trust the shape of, and calls one tool at a time on purpose, so each
      // call's cost and timing are its own (one run at a time, a request
      // budget). The type-evidence rules are relaxed as for tests.
      files: ["evals/**"],
      rules: {
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unknown-returns": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        "no-await-in-loop": "off",
        "promise/avoid-new": "off",
        "unicorn/no-await-expression-member": "off",
      },
    },
    {
      // Test doubles are casts by nature, so the type-evidence rules are
      // relaxed for tests only. The behavioural rules stay on.
      files: [
        "**/*.test.{ts,mjs}",
        "packages/outbound-sdk/test/**",
        "site/test/**",
        "scripts/test-fixtures/**",
      ],
      rules: {
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-known-value-widening": "off",
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unknown-returns": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/no-widen-then-assert": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        "max-classes-per-file": "off",
        "max-lines-per-function": "off",
        // Tests step through calls one at a time and read results inline.
        "no-await-in-loop": "off",
        "promise/avoid-new": "off",
        "promise/prefer-await-to-callbacks": "off",
        "promise/prefer-await-to-then": "off",
        "unicorn/no-await-expression-member": "off",
      },
    },
  ],
  rules: {
    "complexity/complexity": ["error", { cognitive: 25 }],
    // Plugins are middleware: `next` is a continuation that is awaited and
    // whose result is transformed, not a Node-style error-first callback.
    "node/callback-return": "off",
    "max-lines-per-function": [
      "error",
      { max: 100, skipBlankLines: true, skipComments: true },
    ],
  },
});
