import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  generate,
  isCurrent,
  renderInput,
  rulesOf,
  target,
  typeOf,
} from "./generate-insight-inputs.mjs";

const roots = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const copy = (contents) => {
  const root = mkdtempSync(path.join(tmpdir(), "outbound-inputs-"));
  roots.push(root);
  const file = path.join(root, "inputs.generated.ts");
  writeFileSync(file, contents);

  return file;
};

test("the generated insight inputs are current", async () => {
  assert.equal(
    await isCurrent(),
    true,
    "run: node scripts/generate-insight-inputs.mjs"
  );
});

test("a stale copy of the generated inputs is rejected", async () => {
  const stale = readFileSync(target, "utf-8").replace(
    "Defaults to `500`.",
    "Defaults to `50`."
  );

  assert.notEqual(stale, readFileSync(target, "utf-8"));
  assert.equal(await isCurrent(copy(stale)), false);
  assert.equal(await isCurrent(copy(await generate())), true);
});

test("a field's JSDoc gives its description, range and default", () => {
  const text = renderInput({
    properties: {
      max_leads: {
        default: 500,
        description: "The most leads to read and score.",
        maximum: 20_000,
        minimum: 1,
        type: "integer",
      },
      person: { description: "Who", minLength: 3, type: "string" },
      weight: { default: 1, exclusiveMinimum: 0, type: "number" },
    },
    required: ["person"],
  });

  assert.match(
    text,
    /\* The most leads to read and score\.\n \*\n \* A whole number from 1 to 20,000\. Defaults to `500`\.\n \*\/\nreadonly max_leads\?: number \| undefined;/u
  );
  assert.match(
    text,
    /At least 3 characters\. Required\.\n \*\/\nreadonly person: string;/u
  );
  assert.match(text, /A number, more than 0\. Defaults to `1`\./u);
});

test("an old input name is marked @deprecated and has no default", () => {
  const text = renderInput({
    properties: {
      max_bounce_rate: {
        default: 0.03,
        description: "The bounce rate that is too high",
        maximum: 1,
        minimum: 0,
        type: "number",
      },
      threshold: {
        deprecated: true,
        description:
          "Deprecated: renamed to `max_bounce_rate`. Removed in 0.5.0.",
        maximum: 1,
        minimum: 0,
        type: "number",
      },
    },
  });

  assert.match(
    text,
    /\/\*\*\n \* @deprecated Renamed to `max_bounce_rate`\. Removed in 0\.5\.0\.\n \*\n \* A number from 0 to 1\.\n \*\/\nreadonly threshold\?: number \| undefined;/u
  );
  assert.match(
    text,
    /\* The bounce rate that is too high\n \*\n \* A number from 0 to 1\. Defaults to `0\.03`\.\n \*\/\nreadonly max_bounce_rate\?: number \| undefined;/u
  );
  assert.doesNotMatch(text, /@deprecated[^/]*Defaults to/u);
});

test("types and rules follow the schema the way z.input does", () => {
  assert.equal(
    typeOf({ items: { enum: ["a", "b"], type: "string" }, type: "array" }),
    '("a" | "b")[]'
  );
  assert.equal(
    typeOf({ anyOf: [{ type: "string" }, { type: "null" }] }),
    "string | null"
  );
  assert.deepEqual(
    rulesOf({
      anyOf: [{ format: "date", type: "string" }, { type: "null" }],
    }),
    ["An ISO 8601 date, `YYYY-MM-DD`, or `null`."]
  );
  assert.deepEqual(rulesOf({ type: "boolean" }), []);
  assert.throws(() => typeOf({ type: "object" }), /No TypeScript type/u);
});
