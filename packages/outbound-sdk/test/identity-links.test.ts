// person() and cross_channel_lead: one person's timeline holds each message
// once however many campaigns they are in (OUT-157), and each tool says what
// it can be linked by, so a tool that cannot be searched for the person reads
// as undetermined, never as not there (OUT-159).

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { combine } from "../src/combine/index.ts";
import { identity, leadIdentifierCoverage } from "../src/identity/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { Adapter } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { instantly } from "../src/instantly/index.ts";
import type { InstantlyOptions } from "../src/instantly/index.ts";
import { fromEnv } from "../src/loader/index.ts";
import { memory } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";
import { createClock } from "./helpers/clock.ts";
import { fixture } from "./helpers/fixtures.ts";
import { createFetch, json } from "./helpers/http.ts";
import type { RecordedRequest } from "./helpers/http.ts";
import { KEY } from "./instantly/suite.ts";

const PERSON = "person41@example.com";
const PROFILE = "https://www.linkedin.com/in/example-person-41";
const CAMPAIGNS = ["c1", "c2", "c3", "c4"] as const;

// Five sends and two replies over four campaigns, as in the agent's report.
const MESSAGES = [
  ["c1", "out", "2026-11-01"],
  ["c1", "out", "2026-11-03"],
  ["c1", "in", "2026-11-04"],
  ["c2", "out", "2026-11-02"],
  ["c2", "in", "2026-11-05"],
  ["c3", "out", "2026-11-02"],
  ["c4", "out", "2026-11-02"],
] as const;

const callTool = async (
  outbound: ReturnType<typeof createOutbound>,
  name: string,
  input: Record<string, unknown>
) => {
  const tool = createTools(outbound).find((each) => each.name === name);
  assert.ok(tool !== undefined, `${name} is offered`);

  const result = await tool.call(input);
  assert.ok(result.ok, JSON.stringify(result));

  return { ...result, data: result.data as Record<string, unknown> };
};

test("person() keeps each message once when one lead id is in four campaigns (OUT-157)", async () => {
  // Smartlead's lead id is global: one ref in every campaign, and its
  // timeline holds every campaign's messages.
  const outbound = createOutbound({
    adapter: memory({
      data: {
        campaigns: CAMPAIGNS.map((id) => ({ id, name: id })),
        leads: CAMPAIGNS.map((campaignId) => ({
          campaignId,
          email: PERSON,
          id: "shared",
        })),
        messages: MESSAGES.map(([campaignId, direction, day], index) => ({
          campaignId,
          direction,
          id: `m${index}`,
          leadId: "shared",
          sentAt: `${day}T10:00:00.000Z`,
        })),
      },
      name: "mailtool",
      workspaceId: "agency",
    }),
    plugins: [identity()],
  });

  const person = await outbound.person(PERSON);

  assert.equal(person.records.length, 4, "one record per campaign");
  assert.equal(
    person.timeline.length,
    7,
    "5 sent and 2 received, not 20 and 8"
  );
  assert.deepEqual(
    person.timeline.map((message) => message.direction),
    ["out", "out", "out", "out", "out", "in", "in"]
  );

  const answer = await callTool(outbound, "cross_channel_lead", {
    email: PERSON,
  });

  const timeline = answer.data.timeline as { campaign: string | null }[];

  assert.equal(timeline.length, 7);
  assert.equal(
    new Set(timeline.map((entry) => entry.campaign)).size,
    4,
    "each message names its campaign"
  );
  assert.match(answer.meta.notes[0] ?? "", /each once/u);
  assert.match(
    answer.meta.notes[0] ?? "",
    /person_summary counts per campaign/u
  );
});

// Instantly as it answers live: one lead record per campaign with its own
// id, GET /leads/{id} names the campaign, and GET /emails is filtered by
// address and campaign.
const instantlyLead = (index: number): Record<string, unknown> => {
  const [base] = (
    fixture("instantly", "listLeads.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

  return {
    ...base,
    campaign: `campaign-${CAMPAIGNS[index]}`,
    email: PERSON,
    id: `lead-${CAMPAIGNS[index]}`,
  };
};

const instantlyEmail = (index: number): Record<string, unknown> => {
  const [base] = (
    fixture("instantly", "listEmails.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

  const [campaign, direction, day] = MESSAGES[index] ?? MESSAGES[0];

  return {
    ...base,
    campaign_id: `campaign-${campaign}`,
    from_address_email: direction === "in" ? PERSON : "outreach@example.com",
    id: `email-${index}`,
    is_auto_reply: 0,
    lead: PERSON,
    thread_id: `thread-${campaign}`,
    timestamp_created: `${day}T10:00:00.000Z`,
    timestamp_email: `${day}T10:00:00.000Z`,
    ue_type: direction === "in" ? 2 : 1,
  };
};

const instantlyRespond = (request: RecordedRequest): Response => {
  const url = new URL(request.url);
  const leads = CAMPAIGNS.map((_, index) => instantlyLead(index));

  if (url.pathname === "/api/v2/leads/list") {
    return json({ items: leads });
  }

  if (url.pathname.startsWith("/api/v2/leads/")) {
    const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");

    return json(leads.find((lead) => lead.id === id) ?? {});
  }

  if (url.pathname === "/api/v2/emails") {
    const campaign = url.searchParams.get("campaign_id");

    return json({
      items: MESSAGES.flatMap((_, index) => {
        const email = instantlyEmail(index);

        return campaign === null || email.campaign_id === campaign
          ? [email]
          : [];
      }),
    });
  }

  return json({ items: [] });
};

test("instantly: a person in four campaigns gets each message once, at two reads per record (OUT-157)", async () => {
  const clock = createClock();
  const http = createFetch((request) => instantlyRespond(request));

  const outbound = createOutbound({
    adapter: instantly({ apiKey: KEY, workspaceId: "client-a" }),
    fetch: http.fetch,
    plugins: [identity()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const person = await clock.settle(outbound.person(PERSON));

  assert.equal(person.records.length, 4);
  assert.deepEqual(
    person.timeline.map((message) => message.ref).toSorted(),
    MESSAGES.map((_, index) => `instantly:client-a:email-${index}`).toSorted()
  );
  assert.equal(
    person.requests,
    http.requests.length,
    "one lookup, then a lead read and an email read per campaign record"
  );
  assert.equal(person.requests, 9);
});

// Two tools whose leads share no identifier type: an email tool without
// profiles, as Instantly is, and a LinkedIn tool without addresses.
const emailOnly = (): Adapter =>
  memory({
    data: {
      campaigns: [{ id: "c1", name: "Email" }],
      leads: [{ campaignId: "c1", email: PERSON, id: "l1" }],
    },
    fields: { lead: { linkedinUrl: false } },
    name: "mailtool",
    workspaceId: "agency",
  });

const linkedinOnly = (): Adapter =>
  memory({
    data: {
      campaigns: [{ channel: "linkedin", id: "k1", name: "LinkedIn" }],
      leads: [{ campaignId: "k1", id: "p1", linkedinUrl: PROFILE }],
    },
    fields: { lead: { email: false } },
    name: "lntool",
    workspaceId: "acme",
  });

test("with no identifier type shared, a tool that cannot be searched is undetermined, not absent (OUT-159)", async () => {
  const outbound = createOutbound({
    adapter: combine([emailOnly(), linkedinOnly()]),
    plugins: [identity(), insights()],
  });

  assert.deepEqual(await outbound.identifiers(), {
    shared: [],
    tools: [
      {
        identifiers: ["email"],
        provider: "mailtool",
        searchable: ["email"],
        workspaceId: "agency",
      },
      {
        identifiers: ["linkedin"],
        provider: "lntool",
        searchable: ["linkedin"],
        workspaceId: "acme",
      },
    ],
  });

  const byProfile = await outbound.person(PROFILE);

  assert.equal(byProfile.found, true);
  assert.deepEqual(
    byProfile.links.map((link) => [link.provider, link.status]),
    [
      ["mailtool", "undetermined"],
      ["lntool", "linked"],
    ]
  );

  const nobody = await outbound.person("person99@example.com");

  assert.equal(nobody.found, false);
  assert.deepEqual(
    nobody.links.map((link) => [link.provider, link.status]),
    [
      ["mailtool", "absent"],
      ["lntool", "undetermined"],
    ],
    "searched where it can be, and can't tell where it cannot"
  );

  const answer = await callTool(outbound, "cross_channel_lead", {
    linkedin_url: PROFILE,
  });

  assert.equal(answer.meta.complete, false);
  assert.ok(
    answer.meta.notes.some((note) =>
      /^mailtool \(agency\) can be searched by email .* cannot be told/u.test(
        note
      )
    ),
    answer.meta.notes.join("\n")
  );
  assert.deepEqual(answer.data.links, [
    {
      identifiers: ["email"],
      provider: "mailtool",
      searchable: ["email"],
      status: "undetermined",
      workspace: "agency",
    },
    {
      identifiers: ["linkedin"],
      provider: "lntool",
      searchable: ["linkedin"],
      status: "linked",
      workspace: "acme",
    },
  ]);

  const summary = await outbound.insights.personSummary({
    linkedin_url: PROFILE,
  });

  assert.equal(summary.meta.complete, false);
  assert.ok(
    summary.meta.notes.some((note) => /cannot be told/u.test(note)),
    summary.meta.notes.join("\n")
  );
});

const leadOf = (provider: string, email: string | null, url: string | null) =>
  ({
    email,
    linkedinUrl: url,
    provider,
    workspaceId: "w",
  }) as Parameters<typeof leadIdentifierCoverage>[0][number];

test("leadIdentifierCoverage counts what leads carry, so a declared but empty field cannot link", () => {
  const coverage = leadIdentifierCoverage([
    leadOf("instantly", PERSON, null),
    leadOf("instantly", "person42@example.com", null),
    leadOf("heyreach", null, PROFILE),
  ]);

  assert.deepEqual(coverage.shared, []);
  assert.deepEqual(
    coverage.tools.map((tool) => [tool.provider, tool.leads, tool.carrying]),
    [
      ["instantly", 2, { email: 2, linkedin: 0 }],
      ["heyreach", 1, { email: 0, linkedin: 1 }],
    ]
  );

  assert.deepEqual(
    leadIdentifierCoverage([
      leadOf("instantly", PERSON, PROFILE),
      leadOf("heyreach", null, PROFILE),
    ]).shared,
    ["linkedin"]
  );
});

// An Instantly account that keeps profiles under two custom field names.
const leadsWithProfiles = (): Response => {
  const [base] = (
    fixture("instantly", "listLeads.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

  return json({
    items: [
      {
        ...base,
        email: "person43@example.com",
        id: "lead-a",
        payload: {
          linkedin_profile: "https://www.linkedin.com/in/example-person-43",
        },
      },
      {
        ...base,
        email: "person44@example.com",
        id: "lead-b",
        payload: {
          linkedin_url: "https://www.linkedin.com/in/example-person-44",
        },
      },
      { ...base, email: "person45@example.com", id: "lead-c", payload: {} },
    ],
  });
};

const ENV = ["INSTANTLY_API_KEY", "OUTBOUND_LEAD_FIELDS"] as const;

const withEnv = async (
  values: Partial<Record<(typeof ENV)[number], string>>,
  body: () => Promise<void>
): Promise<void> => {
  const saved = new Map(ENV.map((name) => [name, process.env[name]]));

  for (const name of ENV) {
    const value = values[name];

    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }

  try {
    await body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  }
};

const TWO_NAMES = { linkedinUrl: ["linkedin_profile", "linkedin_url"] };

const PROFILES = [
  "https://www.linkedin.com/in/example-person-43",
  "https://www.linkedin.com/in/example-person-44",
  null,
];

test("leadFields takes several candidate names, from OUTBOUND_LEAD_FIELDS (OUT-159)", async () => {
  await withEnv(
    { INSTANTLY_API_KEY: KEY, OUTBOUND_LEAD_FIELDS: JSON.stringify(TWO_NAMES) },
    async () => {
      const http = createFetch(() => leadsWithProfiles());

      const outbound = createOutbound({
        adapter: await fromEnv({ provider: "instantly" }),
        fetch: http.fetch,
        plugins: [identity()],
        rateLimitStore: new MemoryRateLimitStore(),
      });

      const { items } = await outbound.leads.list();

      assert.deepEqual(
        items.map((lead) => lead.linkedinUrl),
        PROFILES
      );
      assert.equal(outbound.fields.lead.linkedinUrl, "derived");
      const [tool] = (await outbound.identifiers()).tools;

      assert.deepEqual(tool?.identifiers, ["email", "linkedin"]);
      assert.deepEqual(
        tool?.searchable,
        ["email"],
        "a profile read from a custom field is on the lead, but Instantly cannot be asked for it"
      );
    }
  );
});

test("a bad OUTBOUND_LEAD_FIELDS is refused before any request", async () => {
  for (const [value, pattern] of [
    ["linkedinUrl=linkedin_url", /is not JSON/u],
    [
      '{"linkedin":"linkedin_url"}',
      /names "linkedin", which is not a lead field/u,
    ],
    ['{"linkedinUrl":[]}', /give a custom field name or a list/u],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- the environment is shared, so one case at a time.
    await withEnv(
      { INSTANTLY_API_KEY: KEY, OUTBOUND_LEAD_FIELDS: value },
      async () => {
        await assert.rejects(
          fromEnv({ provider: "instantly" }),
          (error) =>
            OutboundError.is(error) &&
            error.code === "Invalid" &&
            pattern.test(error.message)
        );
      }
    );
  }
});

test("a --config file's leadFields reaches the adapter the CLI builds", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "outbound-lead-fields-"));
  const file = path.join(directory, "outbound.config.mjs");

  await writeFile(
    file,
    `export default { leadFields: ${JSON.stringify(TWO_NAMES)} };\n`
  );

  await withEnv({ INSTANTLY_API_KEY: KEY }, async () => {
    const out: string[] = [];
    const http = createFetch(() => leadsWithProfiles());

    const code = await run(
      ["leads", "--provider", "instantly", "--config", file, "--compact"],
      {
        fetch: http.fetch,
        stderr: () => {},
        stdout: (text) => {
          out.push(text);
        },
      }
    );

    const { data } = JSON.parse(out.join("")) as {
      data: { items: { linkedinUrl: string | null }[] };
    };

    assert.equal(code, 0);
    assert.deepEqual(
      data.items.map((lead) => lead.linkedinUrl),
      PROFILES
    );
  });
});

// The five spellings a live Instantly account used for one LinkedIn field,
// and values that are not a profile URL under a profile-like name.
const LIVE_SPELLINGS = [
  "linkedin_url",
  "linkedin_profile",
  "LinkedIn_URL",
  "linkedin_URL",
  "LinkedIn URL",
];

const leadsWithSpellings = (): Response => {
  const [base] = (
    fixture("instantly", "listLeads.json") as {
      items: Record<string, unknown>[];
    }
  ).items;

  return json({
    items: [
      ...LIVE_SPELLINGS.map((name, index) => ({
        ...base,
        email: `person5${index}@example.com`,
        id: `lead-${index}`,
        payload: {
          [name]: `https://www.linkedin.com/in/example-person-5${index}`,
        },
      })),
      {
        ...base,
        email: "person60@example.com",
        id: "lead-no-scheme",
        payload: {
          "linkedin-profile-url": "linkedin.com/in/example-person-60",
        },
      },
      {
        ...base,
        email: "person61@example.com",
        id: "lead-not-a-profile",
        payload: {
          LinkedIn: "https://www.linkedin.com/company/example-co",
          linkedin_url: "n/a",
        },
      },
      {
        ...base,
        email: "person62@example.com",
        id: "lead-other-name",
        payload: { profile: "https://www.linkedin.com/in/example-person-62" },
      },
    ],
  });
};

const instantlyOn = (
  respond: () => Response,
  leadFields?: InstantlyOptions["leadFields"]
) => {
  const http = createFetch(respond);

  return {
    http,
    outbound: createOutbound({
      adapter: instantly({
        apiKey: KEY,
        workspaceId: "client-a",
        ...(leadFields !== undefined && { leadFields }),
      }),
      fetch: http.fetch,
      plugins: [identity()],
      rateLimitStore: new MemoryRateLimitStore(),
    }),
  };
};

test("with no leadFields, a profile is read from a custom field named like one, in any of the live spellings", async () => {
  const { outbound } = instantlyOn(leadsWithSpellings);
  const { items } = await outbound.leads.list();

  assert.deepEqual(
    items.map((lead) => lead.linkedinUrl),
    [
      ...LIVE_SPELLINGS.map(
        (_, index) => `https://www.linkedin.com/in/example-person-5${index}`
      ),
      "linkedin.com/in/example-person-60",
      null,
      null,
    ],
    "only a linkedin.com/in/ URL under a profile-like name is taken"
  );
  assert.equal(outbound.fields.lead.linkedinUrl, "derived");
  assert.deepEqual(
    items
      .slice(0, 2)
      .map((lead) => (lead as { personKeys?: string[] }).personKeys),
    [
      ["email:person50@example.com", "linkedin:example-person-50"],
      ["email:person51@example.com", "linkedin:example-person-51"],
    ]
  );
});

test("an explicit leadFields linkedinUrl replaces the built-in names", async () => {
  const { outbound } = instantlyOn(leadsWithSpellings, {
    linkedinUrl: "profile",
  });

  const { items } = await outbound.leads.list();

  assert.deepEqual(
    items.map((lead) => lead.linkedinUrl),
    [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "https://www.linkedin.com/in/example-person-62",
    ]
  );
});

test("a profile only a custom field holds is not searchable, so a profile lookup leaves Instantly undetermined", async () => {
  const { http, outbound } = instantlyOn(leadsWithSpellings);

  const person = await outbound.person(
    "https://www.linkedin.com/in/example-person-50"
  );

  assert.equal(person.found, false);
  assert.deepEqual(
    person.links.map((link) => [link.provider, link.status]),
    [["instantly", "undetermined"]],
    "Instantly cannot be asked for a profile, so not finding one proves nothing"
  );
  assert.equal(http.requests.length, 0, "the lookup sends no request");

  const byEmail = await outbound.person("person50@example.com", {
    timeline: false,
  });

  assert.deepEqual(byEmail.keys, [
    "email:person50@example.com",
    "linkedin:example-person-50",
  ]);
  assert.deepEqual(
    byEmail.links.map((link) => link.status),
    ["linked"]
  );
});
