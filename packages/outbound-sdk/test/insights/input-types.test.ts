// The typed methods on `outbound.insights` check their input at compile time
// and at run time. Each `@ts-expect-error` below fails the type check if the
// line it marks ever starts compiling.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../../src/index.ts";
import { INSIGHTS, insights } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";

const outbound = createOutbound({
  adapter: memory({ data: demoData() }),
  plugins: [insights()],
});

const invalid = (pattern: RegExp) => (error: unknown) =>
  OutboundError.is(error) &&
  error.code === "Invalid" &&
  pattern.test(error.message);

test("an insight refuses a value of the wrong type", async () => {
  await assert.rejects(
    // @ts-expect-error -- `days` is a number
    async () => await outbound.insights.clientReport({ days: "seven" }),
    invalid(/client_report: days /u)
  );
});

test("an insight refuses a missing required input, naming it", async () => {
  await assert.rejects(
    // @ts-expect-error -- `person` is required
    async () => await outbound.insights.personSummary({}),
    invalid(/^person_summary: `person` is required$/u)
  );
});

test("every insight names a missing required input the same way", async () => {
  const required = INSIGHTS.flatMap((definition) =>
    Object.entries(definition.inputSchema.shape).flatMap(([name, field]) =>
      field.safeParse(undefined).success ? [] : [{ definition, name }]
    )
  );

  // person_summary, account_summary and the campaign insights at least.
  assert.ok(required.length >= 6);

  for (const { definition, name } of required) {
    // oxlint-disable-next-line no-await-in-loop -- one insight at a time keeps the failing one in the message.
    await assert.rejects(
      definition.execute(outbound, {}),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Invalid" &&
        error.message.includes(`\`${name}\` is required`) &&
        !error.message.includes("Invalid input"),
      definition.name
    );
  }
});

test("an insight refuses an input it does not take, and lists what it takes", async () => {
  await assert.rejects(
    // @ts-expect-error -- `tag` is not an input of clientReport
    async () => await outbound.insights.clientReport({ tag: "acme" }),
    invalid(
      /client_report: "tag" is not an input\. It takes: alpha, .*statuses/u
    )
  );
});

test("an input with a default may be left out", async () => {
  const report = await outbound.insights.clientReport({});

  assert.equal(report.data.days, 7);
});

test("an old input name still type-checks, and is held to the new name's type", async () => {
  const result = await outbound.insights.bounceWatch({ threshold: 0.05 });

  assert.equal(result.data.threshold, 0.05);

  await assert.rejects(
    // @ts-expect-error -- `threshold` is a number, as `max_bounce_rate` is
    async () => await outbound.insights.bounceWatch({ threshold: "high" }),
    invalid(/bounce_watch: max_bounce_rate /u)
  );
});
