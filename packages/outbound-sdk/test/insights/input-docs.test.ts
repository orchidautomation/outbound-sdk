// The methods on `outbound.insights` take the generated InsightInputs, whose
// JSDoc gives each field's default and range. The type check runs over this
// file: it fails if a generated input stops matching what its schema accepts.
// scripts/generate-insight-inputs.test.mjs checks the file is current.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { INSIGHTS, InsightInputs } from "../../src/insights/index.ts";

type Each = (typeof INSIGHTS)[number];

type GivenOf<Definition> = Definition extends { readonly given?: infer Given }
  ? Given
  : never;

type Same<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

type Matches = {
  readonly [Definition in Each as Definition["key"]]: Same<
    InsightInputs[Definition["key"]],
    GivenOf<Definition>
  >;
};

// `true` only when every insight's generated input is its schema's input.
const everyInputMatches: Matches[keyof Matches] extends true ? true : false =
  true;

const sameInsights: Same<keyof InsightInputs, Each["key"]> = true;

test("every insight has a generated input that matches its schema", () => {
  assert.equal(everyInputMatches, true);
  assert.equal(sameInsights, true);
});
