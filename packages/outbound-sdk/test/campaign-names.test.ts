// A campaign given by name, in a tool, an insight or the CLI, and inputs
// refused here instead of by the vendor: a person that is not an email
// address, and a LinkedIn lookup an adapter cannot make (OUT-101).

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../src/index.ts";
import type { Adapter, Json } from "../src/index.ts";
import { insights, insightTools } from "../src/insights/index.ts";
import { memory } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";
import type { ToolResult } from "../src/tools/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch } from "./helpers/http.ts";
import { agency, EMAIL_TOOL, PROFILE } from "./insights/helpers.ts";
import { suite } from "./instantly/suite.ts";
import { suite as smartleadSuite } from "./smartlead/suite.ts";

// The answer inside the envelope: a list's records, or the data itself.
const answerOf = (text: string): never => {
  const { data } = JSON.parse(text) as { data: { items?: unknown } | null };

  return (data?.items ?? data) as never;
};

// The Instantly fixtures list three campaigns over two pages.
const FIRST = "01a1d77f-5e23-7a9a-9112-a6f7089f329f";
const THIRD = "01a1d77f-5e23-7a9a-9112-a6f7089f3291";

const overVendor = (vendor = suite) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const http = createFetch(fixtureHandler([vendor], unrouted));

  const outbound = createOutbound({
    adapter: vendor.make(),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const call = (name: string, input: Json): Promise<ToolResult> => {
    const tool = [...createTools(outbound), ...insightTools(outbound)].find(
      (each) => each.name === name
    );

    assert.ok(tool, `${name} is offered`);

    return clock.settle(tool.call(input));
  };

  const paths = () =>
    http.requests.map(
      (request) => `${request.method} ${new URL(request.url).pathname}`
    );

  return { call, paths, unrouted };
};

const overInstantly = () => overVendor(suite);

const LIST_CAMPAIGNS = "GET /api/v2/campaigns";

test("instantly: a tool's campaign may be its name, matched whole and ignoring case", async () => {
  const { call, paths, unrouted } = overInstantly();

  const result = await call("campaign_setup", {
    campaign: " my first campaign ",
  });

  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    paths().filter((path) => path === LIST_CAMPAIGNS).length,
    2,
    "both pages of campaigns are read to find the name"
  );
  assert.ok(
    paths().includes(`${LIST_CAMPAIGNS}/${FIRST}`),
    "then the one named is read"
  );
  assert.equal(result.meta.requests, paths().length, "the lookup is counted");
  assert.deepEqual(unrouted, []);
});

test("instantly: a campaign id or ref is used as given, with no lookup", async () => {
  for (const campaign of [FIRST, `instantly:client-a:${FIRST}`]) {
    const { call, paths } = overInstantly();

    // oxlint-disable-next-line no-await-in-loop -- one instance per input, so each request list is its own.
    const result = await call("campaign_setup", { campaign });

    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(
      !paths().includes(LIST_CAMPAIGNS),
      `${campaign} needs no campaign listing`
    );
  }
});

test("instantly: a part of one name finds it; a part of several lists them", async () => {
  const { call, paths } = overInstantly();

  const third = await call("campaign_setup", { campaign: "third" });

  assert.ok(third.ok, JSON.stringify(third));
  assert.ok(paths().includes(`${LIST_CAMPAIGNS}/${THIRD}`), paths().join(", "));

  const several = await call("campaign_setup", { campaign: "Campaign" });

  assert.equal(several.ok, false);
  assert.equal(several.ok ? null : several.error.code, "Invalid");
  assert.match(
    several.ok ? "" : several.error.message,
    /^3 campaigns match "Campaign": "My First Campaign" \(instantly:client-a:[^)]+\), "Second Campaign" .*"Third Campaign" .*Give the full name, or the ref, which also skips reading every campaign to find it$/u
  );

  const none = await call("campaign_setup", { campaign: "Databricks" });

  assert.equal(none.ok ? null : none.error.code, "NotFound");
  assert.match(
    none.ok ? "" : none.error.message,
    /No campaign has the id or name "Databricks"/u
  );
});

test("instantly: an insight's campaign may be its name", async () => {
  const { call, paths } = overInstantly();

  const result = await call("step_funnel", { campaign: "Third Campaign" });

  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    (result.data as { campaign: string }).campaign,
    `instantly:client-a:${THIRD}`
  );
  assert.equal(result.meta.requests, paths().length, "the lookup is counted");
});

test("person_summary takes a mailto: link as the address in it", async () => {
  const result = await agency().insights.personSummary({
    person: "mailto:Person1@Example.com",
  });

  assert.equal(result.data.found, true);
  assert.ok(result.data.identifiers.includes("email:person1@example.com"));
});

test("instantly: person_summary refuses a domain or a broken address before any request", async () => {
  const cases = [
    [
      "@example.com",
      /"@example\.com" is a company domain, not a person\. Use account_summary/u,
    ],
    [
      "example.com",
      /"example\.com" is a company domain, not a person\. Use account_summary/u,
    ],
    ["mailto:@example.com", /is a company domain/u],
    ["person@example", /"person@example" is not a valid email address/u],
    ["person@@example.com", /is not a valid email address/u],
  ] as const;

  for (const [person, message] of cases) {
    const { call, paths } = overInstantly();

    // oxlint-disable-next-line no-await-in-loop -- one instance per input, so each request list is its own.
    const result = await call("person_summary", { person });

    assert.equal(result.ok ? null : result.error.code, "Invalid", person);
    assert.match(result.ok ? "" : result.error.message, message);
    assert.deepEqual(paths(), [], `${person} reaches no vendor`);
  }
});

test("instantly: a LinkedIn lookup says Instantly leads have no LinkedIn field", async () => {
  const { call, paths } = overInstantly();

  const result = await call("person_summary", { person: PROFILE });

  assert.ok(result.ok, JSON.stringify(result));
  assert.equal((result.data as { found: boolean }).found, false);
  assert.deepEqual(paths(), []);
  assert.match(
    JSON.stringify(result),
    /instantly leads have no LinkedIn field, so a LinkedIn profile finds no one there; search by email instead/u
  );
});

test("a LinkedIn lookup where leads can hold a profile adds no such note", async () => {
  const result = await agency().insights.personSummary({ person: PROFILE });

  assert.equal(result.data.found, true);
  assert.ok(
    !result.meta.notes.some((note) => note.includes("no LinkedIn field"))
  );
});

const cli = async (adapter: Adapter, ...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run([...argv, "--compact"], {
    adapter,
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  return {
    code,
    json: () => answerOf(out.join("")),
    stderr: err.join("\n"),
  };
};

const mailtool = () =>
  memory({ data: EMAIL_TOOL, name: "mailtool", workspaceId: "agency" });

test("cli: campaign takes a name, and campaigns --search finds names", async () => {
  const one = await cli(mailtool(), "campaign", "Founders Q4");

  assert.equal(one.code, 0, one.stderr);
  assert.equal((one.json() as { ref: string }).ref, "mailtool:agency:c1");

  // A bare id still works as before.
  const byId = await cli(mailtool(), "campaign", "c2");

  assert.equal((byId.json() as { name: string }).name, "Agencies Q3");

  const found = await cli(mailtool(), "campaigns", "--search", "Q");

  assert.deepEqual(
    (found.json() as { name: string }[]).map((campaign) => campaign.name),
    ["Founders Q4", "Agencies Q3"]
  );

  const capped = await cli(
    mailtool(),
    "campaigns",
    "--search",
    "q",
    "--limit",
    "1"
  );

  assert.equal((capped.json() as unknown[]).length, 1);
  assert.match(capped.stderr, /Stopped at 1 campaign of 2 that match/u);

  const ambiguous = await cli(mailtool(), "campaign", "s Q");

  assert.equal(ambiguous.code, 1);
  assert.match(
    ambiguous.stderr,
    /^Invalid: 2 campaigns match "s Q": "Founders Q4" \(mailtool:agency:c1\), "Agencies Q3" \(mailtool:agency:c2\)/u
  );
});

test("cli: an unknown command, option, tool or native read suggests the closest", async () => {
  const command = await cli(mailtool(), "campaing");

  assert.equal(command.code, 1);
  assert.equal(
    command.stderr,
    'Invalid: Unknown command "campaing". Did you mean "campaign" or "campaigns"? Run "outbound help"'
  );

  const option = await cli(mailtool(), "campaigns", "--serch", "x");

  assert.equal(
    option.stderr,
    'Invalid: --serch is not an option of campaigns. Did you mean "--search"?'
  );

  const far = await cli(mailtool(), "zzzzzzzz");

  assert.equal(
    far.stderr,
    'Invalid: Unknown command "zzzzzzzz". Run "outbound help"',
    "nothing close, so no suggestion"
  );

  const tool = await cli(mailtool(), "tool", "winning_step");

  assert.match(
    tool.stderr,
    /Unknown tool "winning_step"\. Did you mean "winning_steps"\?/u
  );

  // The name is checked before any request, so a real adapter needs no network here.
  const native = await cli(suite.make(), "native", "nonsense");

  assert.equal(native.code, 1);
  assert.equal(
    native.stderr,
    'Invalid: instantly has no native read "nonsense". Run "outbound native" to list them'
  );

  const nearly = await cli(suite.make(), "native", "campaignExprt");

  assert.match(nearly.stderr, /Did you mean "campaignExport"/u);

  // Without native reads the SDK still refuses it as Unsupported.
  const none = await cli(mailtool(), "native", "nonsense");

  assert.match(none.stderr, /^Unsupported: /u);
});

test("smartlead: a numeric id is used with no lookup, and a name is looked up", async () => {
  const byId = overVendor(smartleadSuite);
  const direct = await byId.call("campaign_setup", { campaign: "2710262" });

  assert.ok(direct.ok, JSON.stringify(direct));
  assert.ok(
    !byId.paths().some((path) => path.endsWith("/campaigns")),
    byId.paths().join(", ")
  );

  const byName = overVendor(smartleadSuite);

  const named = await byName.call("campaign_setup", {
    campaign: "example co follow-up",
  });

  assert.ok(named.ok, JSON.stringify(named));
  assert.ok(
    byName.paths().some((path) => path.includes("/campaigns/2710100")),
    byName.paths().join(", ")
  );
  assert.deepEqual(byName.unrouted, []);
});

// A stand-in named after a vendor, holding ids of its own form, as the site's examples use.
const standIn = () =>
  memory({
    data: {
      campaigns: [
        { id: "cmp_founders", name: "Founders", status: "active" },
        { id: "cmp-two", name: "Second wave", status: "paused" },
      ],
    },
    name: "instantly",
    workspaceId: "acme",
  });

test("an id of another form still works where the adapter has it, as before names", async () => {
  for (const [given, ref] of [
    ["cmp_founders", "instantly:acme:cmp_founders"],
    ["cmp-two", "instantly:acme:cmp-two"],
    ["Second wave", "instantly:acme:cmp-two"],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one input at a time keeps a failure easy to read.
    const result = await cli(standIn(), "campaign", given);

    assert.equal(result.code, 0, `${given}: ${result.stderr}`);
    assert.equal((result.json() as { ref: string }).ref, ref);
  }

  const none = await cli(standIn(), "campaign", "cmp_missing");

  assert.match(
    none.stderr,
    /^NotFound: No campaign has the id or name "cmp_missing"/u
  );

  // On an adapter whose id form is not known, text with no space is an id, as before.
  const plain = await cli(mailtool(), "campaign", "c1");

  assert.equal((plain.json() as { name: string }).name, "Founders Q4");
});

// OUTB-26: "UG" matched 29 campaigns, among them one named "…Mug…".
test("cli: a name is matched whole, then by the start of a word, before anywhere in a name", async () => {
  const campaigns = memory({
    data: {
      campaigns: [
        { id: "c1", name: "Mug buyers" },
        { id: "c2", name: "UG founders" },
        { id: "c3", name: "Plug Q3" },
        { id: "c4", name: "ug" },
        { id: "c5", name: "Q4 UGC creators" },
      ],
    },
    // Instantly's ids are UUIDs, so a short word is read as a name.
    name: "instantly",
    workspaceId: "agency",
  });

  const exact = await cli(campaigns, "campaign", "UG");
  assert.equal(exact.code, 0, exact.stderr);
  assert.equal((exact.json() as { ref: string }).ref, "instantly:agency:c4");

  const word = await cli(campaigns, "campaign", "found");
  assert.equal((word.json() as { ref: string }).ref, "instantly:agency:c2");

  const words = await cli(campaigns, "campaign", "U");
  assert.equal(words.code, 1);
  assert.match(
    words.stderr,
    /^Invalid: 3 campaigns match "U": "UG founders" \(instantly:agency:c2\), "ug" \(instantly:agency:c4\), "Q4 UGC creators" \(instantly:agency:c5\)\. Give the full name, or the ref, which also skips reading every campaign to find it/u
  );

  const inside = await cli(campaigns, "campaign", "lug");
  assert.equal((inside.json() as { ref: string }).ref, "instantly:agency:c3");
});
