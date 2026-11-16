import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { agency, NOW, single } from "./helpers.ts";

const CAMPAIGN = "memory:agency:c1";

const DATA: MemoryData = {
  campaigns: [
    {
      id: "c1",
      steps: [
        {
          variants: [
            {
              body: "Hi {{ First Name }}, I saw {{company_name}} is hiring. {Hi|Hello} again. {{senderSignature}}",
              subject: "{{firstName}}, a question about {{Company-Name}}",
            },
            {
              body: "Hi {{first_name|there}}, congrats on %Funding_Round%.",
              key: "B",
              subject: "Quick one",
            },
          ],
        },
        {
          variants: [
            {
              body: "As {job title} you may like this, {{firstName | friend}}. Reply to {{ICEBREAKER}} or 50% off, 20% more.",
            },
          ],
        },
        { variants: [{ body: "No variables here.", subject: "Bump" }] },
      ],
    },
    { id: "c2", steps: [{ variants: [{ body: "Plain text only." }] }] },
    { id: "c3", steps: [{ variants: [{ body: "Hi {{firstName|there}}" }] }] },
  ],
  leads: [
    // Has everything.
    {
      campaignId: "c1",
      company: "Acme",
      custom: { "Funding Round": "Series A", icebreaker: "Loved your talk" },
      email: "person1@example.com",
      firstName: "Ann",
      id: "l1",
      title: "CEO",
    },
    // Missing the first name and the custom fields.
    {
      campaignId: "c1",
      company: "Beta",
      email: "person2@example.com",
      id: "l2",
      status: "paused",
      title: "CTO",
    },
    // Missing the company, and its title and icebreaker are blank.
    {
      campaignId: "c1",
      custom: { "funding-round": "Seed", ICEBREAKER: "  " },
      email: "person3@example.com",
      firstName: "Cy",
      id: "l3",
      title: " ",
    },
    // Missing everything.
    { campaignId: "c1", email: "person4@example.com", id: "l4" },
    { campaignId: "c2", email: "person5@example.com", id: "l5" },
    { campaignId: "c3", email: "person6@example.com", id: "l6" },
  ],
};

test("personalization_gaps lists the variables, where they are used and the leads each one breaks", async () => {
  const result = await single(DATA).insights.personalizationGaps(
    { campaign: CAMPAIGN },
    { now: NOW }
  );

  const { data } = result;
  assert.equal(result.insight, "personalization_gaps");
  // Most leads affected first; the unknown variable last.
  assert.deepEqual(
    data.variables.map((each) => [
      each.name,
      each.source,
      each.gap,
      each.steps,
      each.leadsWithoutValue,
      each.leadsAffected,
    ]),
    [
      // l2, l3 (blank) and l4.
      ["ICEBREAKER", "custom", true, [1], 3, 3],
      // l3 and l4. Named as the subject writes it, which is read first.
      ["Company-Name", "builtin", true, [0], 2, 2],
      // l2 and l4. Two of its four uses have a fallback, two do not.
      ["firstName", "builtin", true, [0, 1], 2, 2],
      // l2 and l4.
      ["Funding_Round", "custom", true, [0], 2, 2],
      // l3 (blank) and l4.
      ["job title", "builtin", true, [1], 2, 2],
      // No lead has it: a variable the tool fills in itself.
      ["senderSignature", "unknown", false, [0], null, null],
    ]
  );

  const firstName = data.variables.find((each) => each.name === "firstName");
  assert.deepEqual(firstName?.uses, [
    {
      fallback: false,
      field: "subject",
      step: 0,
      stepIndex: 0,
      stepNumber: 1,
      variant: "A",
    },
    {
      fallback: false,
      field: "body",
      step: 0,
      stepIndex: 0,
      stepNumber: 1,
      variant: "A",
    },
    {
      fallback: true,
      field: "body",
      step: 0,
      stepIndex: 0,
      stepNumber: 1,
      variant: "B",
    },
    {
      fallback: true,
      field: "body",
      step: 1,
      stepIndex: 1,
      stepNumber: 2,
      variant: "A",
    },
  ]);
  assert.deepEqual(
    data.variables.find((each) => each.name === "Company-Name")?.uses,
    [
      {
        fallback: false,
        field: "subject",
        step: 0,
        stepIndex: 0,
        stepNumber: 1,
        variant: "A",
      },
      {
        fallback: false,
        field: "body",
        step: 0,
        stepIndex: 0,
        stepNumber: 1,
        variant: "A",
      },
    ]
  );
  // Most missing first, then by lead.
  assert.deepEqual(data.leads, [
    {
      email: "person4@example.com",
      lead: "memory:agency:l4",
      linkedinUrl: null,
      missing: [
        "firstName",
        "Company-Name",
        "Funding_Round",
        "ICEBREAKER",
        "job title",
      ],
      status: "active",
    },
    {
      email: "person2@example.com",
      lead: "memory:agency:l2",
      linkedinUrl: null,
      missing: ["firstName", "Funding_Round", "ICEBREAKER"],
      status: "paused",
    },
    {
      email: "person3@example.com",
      lead: "memory:agency:l3",
      linkedinUrl: null,
      missing: ["Company-Name", "ICEBREAKER", "job title"],
      status: "active",
    },
  ]);
  assert.deepEqual(data.unknownVariables, ["senderSignature"]);
  assert.deepEqual(data.totals, {
    // Three of the four leads read.
    affectedRate: 0.75,
    leadsAffected: 3,
    leadsRead: 4,
    steps: 3,
    variables: 6,
  });
  assert.equal(data.campaign, CAMPAIGN);
  assert.equal(result.meta.complete, true);
});

test("personalization_gaps does not count a variable whose every use has a fallback", async () => {
  const result = await single(DATA).insights.personalizationGaps({
    campaign: "memory:agency:c3",
  });

  assert.deepEqual(
    result.data.variables.map((each) => [
      each.name,
      each.gap,
      each.leadsWithoutValue,
      each.leadsAffected,
    ]),
    // The lead has no first name, and gets "there".
    [["firstName", false, 1, 0]]
  );
  assert.deepEqual(result.data.leads, []);
  assert.equal(result.data.totals.leadsAffected, 0);
  assert.equal(result.data.totals.affectedRate, 0);
});

test("personalization_gaps reads no lead when the copy has no variables, and has no rate without leads", async () => {
  const plain = await single(DATA).insights.personalizationGaps({
    campaign: "memory:agency:c2",
  });

  assert.deepEqual(plain.data.variables, []);
  assert.deepEqual(plain.data.totals, {
    affectedRate: null,
    leadsAffected: 0,
    leadsRead: 0,
    steps: 1,
    variables: 0,
  });
  assert.deepEqual(plain.meta.notes, [
    "The sequence uses no variables, so no lead was read.",
  ]);

  const noLeads = await single({
    campaigns: [
      { id: "c1", steps: [{ variants: [{ body: "{{firstName}}" }] }] },
    ],
  }).insights.personalizationGaps({ campaign: CAMPAIGN });

  // With no lead to look at, even a custom field would be unknown; a built-in is not.
  assert.deepEqual(
    noLeads.data.variables.map((each) => [
      each.name,
      each.source,
      each.leadsAffected,
    ]),
    [["firstName", "builtin", 0]]
  );
  assert.equal(noLeads.data.totals.affectedRate, null);

  const noSteps = await single({
    campaigns: [{ id: "c1" }],
  }).insights.personalizationGaps({ campaign: CAMPAIGN });

  assert.equal(noSteps.data.totals.steps, 0);
});

test("personalization_gaps says the answer is partial when max_leads stops the read, and limit only shortens the list", async () => {
  const capped = await single(DATA).insights.personalizationGaps({
    campaign: CAMPAIGN,
    max_leads: 2,
  });

  // l1 and l2 only: one of two affected.
  assert.equal(capped.data.totals.leadsRead, 2);
  assert.equal(capped.data.totals.affectedRate, 0.5);
  assert.equal(capped.meta.complete, false);
  assert.deepEqual(capped.meta.notes, [
    "Stopped at 2 leads of a campaign (max_leads); more exist.",
  ]);

  const limited = await single(DATA).insights.personalizationGaps({
    campaign: CAMPAIGN,
    limit: 1,
  });

  assert.deepEqual(
    limited.data.leads.map((each) => each.lead),
    ["memory:agency:l4"]
  );
  assert.equal(limited.data.totals.leadsAffected, 3);
  assert.equal(limited.meta.complete, true);
});

test("personalization_gaps is refused without a sequence or a campaign's leads, and needs a campaign", async () => {
  for (const key of ["sequence", "leads.byCampaign"] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one capability at a time.
    await assert.rejects(
      async () =>
        await single(DATA, { [key]: false }).insights.personalizationGaps({
          campaign: CAMPAIGN,
        }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Unsupported" &&
        error.message.includes(key)
    );
  }

  await assert.rejects(
    async () =>
      await single(DATA).insights.personalizationGaps({ campaign: "" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      error.message.startsWith("personalization_gaps: campaign ")
  );
});

test("personalization_gaps reads one tool's campaign through a combined instance", async () => {
  const result = await agency().insights.personalizationGaps({
    campaign: "mailtool:agency:c1",
  });

  // The shared email tool seeds no steps.
  assert.deepEqual(result.data.variables, []);
  assert.equal(result.data.campaign, "mailtool:agency:c1");
  assert.equal(result.meta.provider, "combined");
});
