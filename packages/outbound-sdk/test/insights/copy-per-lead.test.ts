// Copy written per lead in custom fields (OUT-95): every step body is
// `{{body_N}}` and the sender's signature, the subject `{{subject_1}}`.
// copy_audit audits it as sample leads receive it, and personalization_gaps
// counts only leads who get broken copy.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { NOW } from "./helpers.ts";

const CAMPAIGN = "instantly:agency:c1";

const body = (n: number): string =>
  `<div>{{body_${n}}}</div><div><br /></div><div>{{accountSignature}}</div>`;

const DATA: MemoryData = {
  campaigns: [
    {
      id: "c1",
      name: "Per-lead copy",
      steps: [
        { variants: [{ body: body(1), subject: "{{subject_1}}" }] },
        { variants: [{ body: body(2) }] },
        { variants: [{ body: body(3) }] },
        { variants: [{ body: body(4) }] },
      ],
    },
    // The same copy, and no leads.
    {
      id: "empty",
      steps: [{ variants: [{ body: body(1), subject: "{{subject_1}}" }] }],
    },
  ],
  leads: [
    {
      campaignId: "c1",
      custom: {
        body_1:
          "Ann,\n\nYour move into GTM engineering usually means one thing.",
        body_2: "Following up on my note.",
        body_3: "One more thought.",
        body_4: "Last one from me.",
        subject_1: "GTM engineering",
      },
      email: "person1@example.com",
      firstName: "Ann",
      id: "l1",
    },
    {
      campaignId: "c1",
      custom: {
        // A spam phrase and two links, only in this lead's copy.
        body_1:
          "Bo, act now for a free trial: https://example.com/a https://example.com/b",
        body_2: "Following up.",
        body_3: "One more thought.",
        body_4: "Last one from me.",
        subject_1: "A question",
      },
      email: "person2@example.com",
      firstName: "Bo",
      id: "l2",
    },
    {
      campaignId: "c1",
      // No body_2.
      custom: {
        body_1: "Cy, a short note.",
        body_3: "One more thought.",
        body_4: "Last one from me.",
        subject_1: "Hello",
      },
      email: "person3@example.com",
      firstName: "Cy",
      id: "l3",
    },
  ],
};

const instance = (data: MemoryData, name = "instantly", capabilities = {}) =>
  createOutbound({
    adapter: memory({ capabilities, data, name, workspaceId: "agency" }),
    plugins: [insights()],
  });

test("personalization_gaps flags the lead missing body_2 and never shows a gap no lead has", async () => {
  const { data } = await instance(DATA).insights.personalizationGaps(
    { campaign: CAMPAIGN },
    { now: NOW }
  );

  assert.deepEqual(
    data.variables.map((each) => [
      each.name,
      each.source,
      each.sender,
      each.gap,
      each.leadsWithoutValue,
      each.leadsAffected,
    ]),
    [
      ["body_2", "custom", false, true, 1, 1],
      ["body_1", "custom", false, false, 0, 0],
      ["body_3", "custom", false, false, 0, 0],
      ["body_4", "custom", false, false, 0, 0],
      ["subject_1", "custom", false, false, 0, 0],
      // Instantly fills it from the sending account: not a lead field.
      ["accountSignature", "unknown", true, false, null, null],
    ]
  );
  assert.ok(
    data.variables.every((each) => each.gap === (each.leadsAffected ?? 0) > 0)
  );
  assert.deepEqual(data.unknownVariables, []);
  assert.deepEqual(
    data.leads.map((each) => [each.lead, each.missing]),
    [["instantly:agency:l3", ["body_2"]]]
  );
  assert.equal(data.totals.leadsAffected, 1);
});

test("personalization_gaps treats each Instantly sender variable as the sender's, and only on Instantly", async () => {
  const sender: MemoryData = {
    campaigns: [
      {
        id: "c1",
        steps: [
          {
            variants: [
              {
                body: "{{sendingAccountFirstName}} {{sendingAccountName}} {{sendingAccountEmail}} {{accountSignature}} {{ICEBREAKER}}",
              },
            ],
          },
        ],
      },
    ],
    leads: [{ campaignId: "c1", email: "person1@example.com", id: "l1" }],
  };

  const instantly = await instance(sender).insights.personalizationGaps({
    campaign: CAMPAIGN,
  });

  assert.deepEqual(
    instantly.data.variables.map((each) => [each.name, each.sender]),
    [
      ["accountSignature", true],
      ["ICEBREAKER", false],
      ["sendingAccountEmail", true],
      ["sendingAccountFirstName", true],
      ["sendingAccountName", true],
    ]
  );
  assert.deepEqual(instantly.data.unknownVariables, ["ICEBREAKER"]);

  // Another tool has no such built-ins: the same names are unknown there.
  const other = await instance(sender, "memory").insights.personalizationGaps({
    campaign: "memory:agency:c1",
  });

  assert.ok(
    other.data.variables.every(
      (each) => each.source === "unknown" && each.sender === false
    )
  );
  assert.equal(other.data.unknownVariables.length, 5);
});

test("copy_audit audits copy written per lead as each sample lead receives it", async () => {
  const result = await instance(DATA).insights.copyAudit(
    { campaign: CAMPAIGN },
    { now: NOW }
  );

  const { data } = result;
  assert.equal(data.variantsWrittenPerLead, 4);
  assert.deepEqual(data.leadsAudited, [
    "instantly:agency:l1",
    "instantly:agency:l2",
    "instantly:agency:l3",
  ]);
  assert.equal(data.clean, false);
  assert.deepEqual(
    data.findings.map((each) => [
      each.lead,
      each.stepIndex,
      each.check,
      each.text,
    ]),
    [
      ["instantly:agency:l2", 0, "spam_words", "act now, free trial"],
      [
        "instantly:agency:l2",
        0,
        "too_many_links",
        "https://example.com/a https://example.com/b",
      ],
    ]
  );
  assert.deepEqual(result.meta.notes, [
    "4 variants are written per lead in variables, so the rendered copy of 3 sample leads was audited; each finding names its lead.",
  ]);
});

test("copy_audit says clean only when every variant written per lead was rendered for a lead", async () => {
  const fine = await instance({
    ...DATA,
    leads: (DATA.leads ?? []).filter((lead) => lead.id === "l1"),
  }).insights.copyAudit({ campaign: CAMPAIGN }, { now: NOW });

  assert.equal(fine.data.clean, true);
  assert.equal(fine.data.variantsNotAudited, 0);
  assert.deepEqual(fine.data.leadsAudited, ["instantly:agency:l1"]);

  // l3 has no body_2, so step 2 is never rendered: not clean, with no finding.
  const partial = await instance({
    ...DATA,
    leads: (DATA.leads ?? []).filter((lead) => lead.id === "l3"),
  }).insights.copyAudit({ campaign: CAMPAIGN }, { now: NOW });

  assert.equal(partial.data.clean, false);
  assert.deepEqual(partial.data.findings, []);
  assert.equal(partial.data.variantsNotAudited, 1);
  assert.deepEqual(partial.meta.notes, [
    "4 variants are written per lead in variables, so the rendered copy of 1 sample lead was audited; each finding names its lead.",
    "1 variant written per lead could not be audited: no sample lead has values for its variables.",
  ]);
});

test("copy_audit never returns clean true when no lead's copy can be rendered, and counts what it left unaudited", async () => {
  const reasons: [
    string,
    Promise<{ data: { clean: boolean; variantsNotAudited?: number } }>,
  ][] = [
    [
      "the campaign has no leads",
      instance(DATA).insights.copyAudit({ campaign: "instantly:agency:empty" }),
    ],
    [
      "samples is 0",
      instance(DATA).insights.copyAudit({ campaign: CAMPAIGN, samples: 0 }),
    ],
    [
      "this tool does not list a campaign's leads",
      instance(DATA, "instantly", {
        "leads.byCampaign": false,
      }).insights.copyAudit({ campaign: CAMPAIGN }),
    ],
  ];

  for (const [reason, pending] of reasons) {
    // oxlint-disable-next-line no-await-in-loop -- one reason at a time.
    const result = await pending;

    assert.equal(result.data.clean, false, reason);
    assert.ok((result.data.variantsNotAudited ?? 0) > 0, reason);
    assert.match(
      (result as unknown as { meta: { notes: string[] } }).meta.notes.join(" "),
      new RegExp(
        `could not be audited as any lead receives it: ${reason}\\.`,
        "u"
      )
    );
  }
});

test("copy_audit audits copy that is only partly variables as stored, and reads no lead for it", async () => {
  const written: MemoryData = {
    campaigns: [
      {
        id: "c1",
        steps: [
          {
            variants: [
              {
                body: "Hi {{firstName}}, saw {{company}} is hiring. Worth a chat?",
                subject: "{{subject_1}}",
              },
            ],
          },
          // Not judged against the first subject, which is written per lead.
          { variants: [{ body: "Following up.", subject: "Re: hiring" }] },
        ],
      },
    ],
  };

  const result = await instance(written, "memory", {
    "leads.byCampaign": false,
  }).insights.copyAudit({ campaign: "memory:agency:c1" });

  // Only the first variant is written per lead; the second is audited as stored.
  assert.equal(result.data.variantsWrittenPerLead, 1);
  assert.deepEqual(result.data.findings, []);
  assert.equal(result.data.clean, false);
  assert.equal(result.data.variantsNotAudited, 1);

  const plain = await instance(
    {
      campaigns: [
        {
          id: "c1",
          steps: [
            {
              variants: [
                { body: "Hi {{firstName}}, a short note.", subject: "Hello" },
              ],
            },
          ],
        },
      ],
    },
    "memory",
    { "leads.byCampaign": false }
  ).insights.copyAudit({ campaign: "memory:agency:c1" });

  assert.equal(plain.data.variantsWrittenPerLead, 0);
  assert.equal(plain.data.clean, true);
  assert.deepEqual(plain.data.leadsAudited, []);
  assert.deepEqual(plain.meta.notes, []);
});
