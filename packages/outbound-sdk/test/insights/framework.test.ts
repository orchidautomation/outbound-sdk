import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { createMcpServer, run } from "../../src/cli/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import {
  compareRates,
  defineInsight,
  deviation,
  INSIGHTS,
  insightTools,
  listInsights,
  mean,
  median,
  percentile,
  rate,
  round,
  runInsight,
  runInsightByName,
  tally,
  total,
  wilson,
  zScore,
} from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";
import { openaiTools } from "../../src/tools/index.ts";
import { agency, EMAIL_TOOL, single } from "./helpers.ts";

test("rates, totals and averages treat an unknown count as unknown, never as zero", () => {
  assert.equal(rate(1, 3), 0.3333);
  assert.equal(rate(null, 3), null);
  assert.equal(rate(1, null), null);
  assert.equal(rate(1, 0), null);
  assert.equal(round(null), null);
  assert.equal(round(Number.NaN), null);
  assert.equal(total([1, null, 4]), 5);
  assert.equal(total([null, null]), null);
  assert.equal(mean([2, 4, 9]), 5);
  assert.equal(mean([]), null);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.9), 46);
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([7], 2), 7, "a fraction over 1 is the largest value");
  assert.equal(round(deviation([2, 4, 4, 4, 5, 5, 7, 9])), 2.1381);
  assert.equal(deviation([3]), null);
  assert.equal(round(zScore(10, [4, 6])), 3.5355);
  assert.equal(zScore(1, [5, 5, 5]), null, "no spread, no score");
  assert.deepEqual(
    [...tally(["a", "b", "a"])],
    [
      ["a", 2],
      ["b", 1],
    ]
  );
});

test("the Wilson interval is wide on a small sample and narrow on a large one", () => {
  // Checked against the published formula: 2 of 10 at 95%.
  assert.deepEqual(wilson(2, 10), { high: 0.5098, low: 0.0567 });
  assert.deepEqual(wilson(200, 1000), { high: 0.2259, low: 0.1764 });
  assert.deepEqual(wilson(0, 20), { high: 0.1611, low: 0 });
  assert.equal(wilson(1, 0), null);
  assert.equal(wilson(null, 10), null);
});

test("the two-proportion test separates a real difference from chance", () => {
  // 120 of 1,000 against 80 of 1,000: z = 2.98, p = 0.0029.
  const real = compareRates(
    { successes: 120, trials: 1000 },
    { successes: 80, trials: 1000 }
  );

  assert.deepEqual(real, { pValue: 0.0029, significant: true, z: 2.9814 });

  const chance = compareRates(
    { successes: 6, trials: 50 },
    { successes: 4, trials: 50 }
  );

  assert.equal(chance?.significant, false);
  assert.ok((chance?.pValue ?? 0) > 0.4);
  assert.equal(
    compareRates(
      { successes: 80, trials: 1000 },
      { successes: 120, trials: 1000 }
    )?.z,
    -2.9814,
    "negative when the first rate is lower"
  );
  assert.equal(
    compareRates({ successes: 1, trials: 0 }, { successes: 1, trials: 10 }),
    null
  );
  assert.equal(
    compareRates({ successes: null, trials: 5 }, { successes: 1, trials: 10 }),
    null
  );
  assert.equal(
    compareRates({ successes: 0, trials: 10 }, { successes: 0, trials: 10 }),
    null,
    "two rates of zero cannot be compared"
  );
});

const probe = defineInsight({
  description: "Counts campaigns and senders, for the framework tests.",
  inputSchema: z.object({
    limit: z.number().int().min(1).default(1).describe("Page size"),
  }),
  key: "probe",
  name: "probe",
  needs: ["senders.list"],
  next: "Nothing.",
  run: async (context, input) => {
    const campaigns = context.page(
      await context.outbound.campaigns.list({ limit: input.limit })
    );

    const senders = await context.all(context.outbound.senders.listAll());
    const [first] = campaigns;

    const one =
      first === undefined
        ? null
        : context.one(await context.outbound.campaigns.get(first.ref));

    const rows = context.rows(await context.outbound.stats());
    context.note("a note");
    context.note("a note");

    return {
      campaigns: campaigns.length,
      first: one?.name ?? null,
      rows: rows.length,
      senders: senders.length,
    };
  },
});

test("an insight's meta adds up its reads, keeps a note once, and says when a page was not the last", async () => {
  const outbound = createOutbound({ adapter: memory({ data: demoData() }) });
  const result = await runInsight(outbound, probe, {}, { now: 0 });

  assert.deepEqual(result.data, {
    campaigns: 1,
    first: "Q4 SaaS founders",
    rows: 1,
    senders: 2,
  });
  assert.equal(result.insight, "probe");
  assert.equal(result.meta.complete, false, "two campaigns, one read");
  assert.deepEqual(result.meta.notes, [
    "Only the first page of a listing was read.",
    "a note",
  ]);
  assert.equal(result.meta.evidence, "exact");
  assert.equal(result.meta.requests, 0, "the in-memory adapter makes none");
  assert.equal(result.meta.computedAt, "1970-01-01T00:00:00.000Z");

  const whole = await runInsight(outbound, probe, { limit: 50 });
  assert.equal(whole.meta.complete, true);
  assert.deepEqual(whole.meta.notes, ["a note"]);
});

test("an insight takes the weakest evidence of its reads", async () => {
  const outbound = createOutbound({
    adapter: memory({
      capabilities: { "campaigns.status": "client" },
      data: demoData(),
    }),
  });

  const filtered = defineInsight({
    description: "Reads a client-side filter, for the framework tests.",
    inputSchema: z.object({}),
    key: "filtered",
    name: "filtered",
    needs: [],
    next: "Nothing.",
    run: async (context) =>
      context.page(
        await context.outbound.campaigns.list({ limit: 50, status: "active" })
      ).length,
  });

  const result = await runInsight(outbound, filtered, {});
  assert.equal(result.data, 1);
  assert.equal(result.meta.evidence, "derived");
});

test("bad input and a missing capability are refused before the insight runs", async () => {
  const outbound = createOutbound({
    adapter: memory({
      capabilities: { "senders.list": false },
      data: demoData(),
    }),
  });

  await assert.rejects(
    async () => await runInsight(outbound, probe, { limit: 0 }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      error.message.startsWith("probe: limit ")
  );
  // An input the insight does not take is refused, never silently dropped:
  // a filter that was ignored would answer a wider question than was asked.
  await assert.rejects(
    async () =>
      await runInsightByName(outbound, "client_report", { tag: "acme" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /client_report: "tag" is not an input/u.test(error.message)
  );
  await assert.rejects(
    async () => await runInsight(outbound, probe, {}),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /does not support senders\.list/u.test(error.message)
  );
});

test("every insight has a unique key and name, a real description and described inputs", () => {
  const listed = listInsights();
  assert.equal(listed.length, INSIGHTS.length);
  assert.equal(new Set(listed.map((each) => each.name)).size, listed.length);
  assert.equal(new Set(listed.map((each) => each.key)).size, listed.length);

  for (const each of listed) {
    assert.match(
      each.name,
      /^[a-z]+(?:_[a-z]+)*$/u,
      `${each.name} is snake_case`
    );
    assert.match(each.key, /^[a-z][A-Za-z]+$/u, `${each.key} is camelCase`);
    assert.equal(
      each.key.toLowerCase(),
      each.name.replaceAll("_", ""),
      `${each.key} and ${each.name} are the same words`
    );
    assert.ok(each.description.length > 80, `${each.name} explains itself`);

    const schema = each.parameters as {
      properties?: Record<string, { description?: string }>;
    };

    for (const [field, property] of Object.entries(schema.properties ?? {})) {
      assert.ok(
        (property.description ?? "").length > 5,
        `${each.name}.${field} is described`
      );
    }
  }
});

test("an insight runs by tool name or method name with JSON input", async () => {
  const byName = await runInsightByName(agency(), "person_summary", {
    person: "person1@example.com",
  });

  assert.equal((byName.data as { found: boolean }).found, true);

  const byKey = await runInsightByName(agency(), "personSummary", {
    person: "person2@example.com",
  });

  assert.equal(
    (byKey.data as { totals: { campaigns: number } }).totals.campaigns,
    1
  );
  await assert.rejects(
    async () => await runInsightByName(agency(), "nope"),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /There is no insight "nope"\. Known: person_summary/u.test(error.message)
  );
});

test("insight tools are offered only when the adapter can serve them, and never throw", async () => {
  const tools = insightTools(agency());
  const tool = tools.find((each) => each.name === "person_summary");
  assert.ok(tool);

  const ok = await tool.call({ person: "person1@example.com" });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.meta.provider, "combined");

  const data = ok.data as {
    complete: boolean;
    notes: string[];
    result: { found: boolean };
  };

  assert.equal(data.result.found, true);
  assert.equal(data.complete, true);
  assert.match(ok.next, /account_summary/u);

  const bad = await tool.call({ person: "Jane Doe" });
  assert.ok(!bad.ok);
  assert.equal(bad.error.code, "Invalid");
  assert.match(bad.next, /Check the input/u);

  const without = single(EMAIL_TOOL, { "leads.lookup": false });
  assert.ok(
    !insightTools(without).some((each) => each.name === "person_summary")
  );
  assert.deepEqual(
    insightTools(agency(), { only: ["person_summary"] }).map(
      (each) => each.name
    ),
    ["person_summary"]
  );
  assert.deepEqual(insightTools(agency(), { only: [] }), []);
});

test("an insight tool reports an unsupported read and an unexpected failure as results", async () => {
  const [tool] = insightTools(agency(), { only: ["person_summary"] });
  assert.ok(tool);

  const broken = createOutbound({
    adapter: {
      ...memory({ data: EMAIL_TOOL }),
      listLeads: () => Promise.reject(new TypeError("boom")),
    },
  });

  const [failing] = insightTools(broken, { only: ["person_summary"] });
  const crashed = await failing?.call({ person: "person1@example.com" });
  assert.ok(crashed && !crashed.ok);
  assert.equal(crashed.error.code, "Provider");

  const gated = createOutbound({
    adapter: memory({
      capabilities: { "leads.timeline": false },
      data: EMAIL_TOOL,
    }),
  });

  assert.equal(
    insightTools(gated).length < insightTools(agency()).length,
    true
  );
});

test("insight tools ride along with the built-in tools through `extra`, on OpenAI and MCP", async () => {
  const outbound = agency();
  const extra = insightTools(outbound);
  const { handle, tools } = openaiTools(outbound, { extra });
  assert.ok(tools.some((tool) => tool.name === "person_summary"));

  const answer = JSON.parse(
    await handle(
      "person_summary",
      JSON.stringify({ person: "person1@example.com" })
    )
  ) as { ok: boolean };

  assert.equal(answer.ok, true);

  const mcp = createMcpServer(outbound, { extra });

  const listed = await mcp.handle({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/list",
  });

  const { tools: served } = (listed?.result ?? { tools: [] }) as {
    tools: { name: string }[];
  };

  const names = new Set(served.map((tool) => tool.name));
  assert.ok(names.has("person_summary"));
  assert.ok(names.has("campaign_overview"));
});

test("the CLI lists the insights and runs one", async () => {
  const out: string[] = [];

  const cli = async (...argv: string[]) => {
    out.length = 0;

    const code = await run(argv, {
      adapter: memory({ data: EMAIL_TOOL, workspaceId: "agency" }),
      stderr: (text) => {
        out.push(text);
      },
      stdout: (text) => {
        out.push(text);
      },
    });

    return { code, text: out.join("\n") };
  };

  const listed = await cli("insight");
  assert.equal(listed.code, 0);
  assert.ok(
    (JSON.parse(listed.text) as { name: string }[]).some(
      (each) => each.name === "person_summary"
    )
  );

  const ran = await cli(
    "insight",
    "person_summary",
    "--input",
    '{"person":"person1@example.com"}'
  );

  assert.equal(ran.code, 0);
  assert.equal(
    (JSON.parse(ran.text) as { data: { totals: { campaigns: number } } }).data
      .totals.campaigns,
    3
  );

  const unknown = await cli("insight", "nope");
  assert.equal(unknown.code, 1);
  assert.match(unknown.text, /Invalid: There is no insight "nope"/u);
});
