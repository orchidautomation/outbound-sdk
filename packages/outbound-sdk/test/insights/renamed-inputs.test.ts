// An input renamed before 1.0 keeps its old name for one minor release: the
// old name gives the same answer as the new one, with a note saying so, and
// the tool parameters mark it deprecated.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import { INSIGHTS, insights, insightTools } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");

const outbound = createOutbound({
  adapter: memory({ data: demoData({ now: NOW }) }),
  plugins: [insights()],
});

const CAMPAIGN = "memory:default:cmp_founders";

interface Rename {
  readonly tool: string;
  readonly from: string;
  readonly to: string;
  readonly value: number;
  readonly base?: Readonly<Record<string, string>>;
}

const RENAMES: readonly Rename[] = [
  {
    from: "threshold",
    to: "max_bounce_rate",
    tool: "bounce_watch",
    value: 0.01,
  },
  {
    from: "spam_rate_threshold",
    to: "max_spam_rate",
    tool: "domain_health",
    value: 0.01,
  },
  {
    base: { campaign: CAMPAIGN },
    from: "recent_days",
    to: "days",
    tool: "campaign_diagnosis",
    value: 3,
  },
  { from: "top", to: "limit", tool: "client_report", value: 1 },
];

const toolNamed = (name: string) => {
  const tool = insightTools(outbound).find((each) => each.name === name);
  assert.ok(tool, name);

  return tool;
};

const run = async (name: string, input: Readonly<Record<string, unknown>>) => {
  const result = await toolNamed(name).call(input);
  assert.equal(result.ok, true, JSON.stringify(result));

  return result.ok ? result.data : null;
};

const noteFor = ({ from, to }: Rename): string =>
  `\`${from}\` is deprecated and will be removed in 0.5.0; use \`${to}\`.`;

for (const rename of RENAMES) {
  const { base = {}, from, to, tool, value } = rename;

  test(`${tool}: \`${from}\` gives what \`${to}\` gives, with a note`, async () => {
    const definition = INSIGHTS.find((each) => each.name === tool);
    assert.ok(definition, tool);

    const old = await definition.execute(
      outbound,
      { ...base, [from]: value },
      { now: NOW }
    );

    const current = await definition.execute(
      outbound,
      { ...base, [to]: value },
      { now: NOW }
    );

    assert.deepEqual(old.data, current.data);
    assert.ok(old.meta.notes.includes(noteFor(rename)));
    assert.ok(!current.meta.notes.some((note) => note.includes("deprecated")));
    assert.deepEqual(
      old.meta.notes.filter((note) => note !== noteFor(rename)),
      current.meta.notes
    );
  });

  test(`${tool}: \`${from}\` and \`${to}\` together are refused`, async () => {
    const result = await toolNamed(tool).call({
      ...base,
      [from]: value,
      [to]: value,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, "Invalid");
    assert.equal(
      result.ok ? null : result.error.message,
      `${tool}: pass \`${to}\` only; \`${from}\` is its old name`
    );
  });

  test(`${tool}: the tool returns the note and marks \`${from}\` deprecated`, async () => {
    const data = await run(tool, { ...base, [from]: value });

    assert.ok(
      JSON.stringify(data).includes(JSON.stringify(noteFor(rename))),
      "data.notes carries the deprecation note"
    );

    const { properties } = structuredClone(toolNamed(tool).parameters) as {
      properties: Record<string, Record<string, unknown>>;
    };

    assert.equal(properties[from]?.deprecated, true);
    assert.equal(properties[from]?.default, undefined);
    assert.equal(properties[to]?.deprecated, undefined);
    assert.notEqual(properties[to]?.default, undefined);
  });

  test(`${tool}: a stray key's message leaves \`${from}\` out`, async () => {
    const result = await toolNamed(tool).call({ ...base, nonsense: 1 });
    const message = result.ok ? "" : result.error.message;

    assert.match(message, /It takes:/u);
    assert.ok(message.includes(to), message);
    assert.doesNotMatch(message, new RegExp(`\\b${from}\\b`, "u"));
  });
}

test("an old name set to undefined is left out, as any other input is", async () => {
  const result = await outbound.insights.bounceWatch(
    { threshold: undefined },
    { now: NOW }
  );

  assert.ok(!result.meta.notes.some((note) => note.includes("deprecated")));
});
