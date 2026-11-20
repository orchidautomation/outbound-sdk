import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { redact } from "../../src/redact/index.ts";
import { single } from "./helpers.ts";

const CAMPAIGN = "memory:agency:c1";

// Copy written the way a fully templated Instantly campaign stores it: the
// subject and body come from custom fields, the signature from the tool.
const DATA: MemoryData = {
  campaigns: [
    {
      id: "c1",
      steps: [
        {
          variants: [
            {
              body: '<div>{{content1}} </div><div><br /></div><div>{{accountSignature}} </div><div><a href="https://unsubscribe.example">Unsubscribe</a></div>',
              subject: "{{subject1}}",
            },
            {
              body: "Hi {{first_name|there}}, {Hi|Hello} from %Sender_City%.",
              key: "B",
              subject: "{{firstName}} at {{ Company Name }}",
            },
          ],
        },
        {
          variants: [
            { body: "<p>{{content2}}</p><p>{{accountSignature}}</p>" },
          ],
        },
      ],
    },
    {
      id: "c2",
      steps: [{ variants: [{ body: "No variables.", subject: "Hi" }] }],
    },
    { id: "c3", steps: [{ variants: [{ body: "Hi {{firstName|there}}" }] }] },
  ],
  leads: [
    // Has only a first name.
    {
      campaignId: "c1",
      email: "person1@example.com",
      firstName: "Ann",
      id: "l1",
    },
    // Has the most: read second, still picked.
    {
      campaignId: "c1",
      company: "Acme",
      custom: {
        content1: "Saw Acme & co. is hiring <b>SDRs</b>.",
        content2: "  ",
        subject1: "Hiring at Acme",
      },
      email: "person2@example.com",
      firstName: "Bo",
      id: "l2",
    },
    { campaignId: "c1", email: "person3@example.com", id: "l3" },
  ],
};

test("copy_preview shows each variant as written and as the lead with the most variables filled gets it", async () => {
  const result = await single(DATA).insights.copyPreview({
    campaign: CAMPAIGN,
  });

  const { data } = result;

  assert.equal(result.insight, "copy_preview");
  assert.equal(data.campaign, CAMPAIGN);
  assert.deepEqual(data.lead, {
    email: "person2@example.com",
    lead: "memory:agency:l2",
    linkedinUrl: null,
    // subject1, content1, firstName and company; not content2 (blank),
    // accountSignature, first_name's key is firstName so it counts once,
    // and not Sender_City.
    variablesFilled: 4,
  });

  const [first, second] = data.steps;
  // Each step both ways; the deprecated `step` is the index, counted from 0.
  assert.deepEqual(
    data.steps.map((step) => [step.stepIndex, step.stepNumber, step.step]),
    [
      [0, 1, 0],
      [1, 2, 1],
    ]
  );
  assert.deepEqual(first?.variants[0], {
    rendered: {
      body: '<div>Saw Acme & co. is hiring <b>SDRs</b>. </div><div><br /></div><div>{{accountSignature}} </div><div><a href="https://unsubscribe.example">Unsubscribe</a></div>',
      bodyText:
        "Saw Acme & co. is hiring SDRs.\n\n{{accountSignature}}\nUnsubscribe",
      subject: "Hiring at Acme",
    },
    template: {
      body: '<div>{{content1}} </div><div><br /></div><div>{{accountSignature}} </div><div><a href="https://unsubscribe.example">Unsubscribe</a></div>',
      subject: "{{subject1}}",
    },
    unfilled: ["accountSignature"],
    variantKey: "A",
  });
  // A value wins over a fallback; spintax is left alone.
  assert.deepEqual(first?.variants[1]?.rendered, {
    body: "Hi Bo, {Hi|Hello} from %Sender_City%.",
    bodyText: "Hi Bo, {Hi|Hello} from %Sender_City%.",
    subject: "Bo at Acme",
  });
  assert.deepEqual(first?.variants[1]?.unfilled, ["Sender_City"]);
  // A blank custom field is no value.
  assert.deepEqual(second?.variants[0]?.rendered, {
    body: "<p>{{content2}}</p><p>{{accountSignature}}</p>",
    bodyText: "{{content2}}\n{{accountSignature}}",
    subject: null,
  });
  assert.deepEqual(second?.variants[0]?.unfilled, [
    "content2",
    "accountSignature",
  ]);
  assert.deepEqual(data.totals, {
    steps: 2,
    // accountSignature, content2 and Sender_City.
    unfilled: 3,
    // subject1, content1, accountSignature, firstName, companyname,
    // sendercity, content2.
    variables: 7,
    variants: 3,
  });
  assert.deepEqual(result.meta.notes, [
    "Left as written: accountSignature, Sender_City, content2. The lead has no value and the copy no fallback, or the sending tool fills it at send time, such as a signature.",
    "Spintax such as {Hi|Hello} is shown as written, not resolved.",
  ]);
  assert.equal(result.meta.complete, true);
});

test("copy_preview renders for the lead given, using a fallback where it has no value", async () => {
  const { data } = await single(DATA).insights.copyPreview({
    campaign: CAMPAIGN,
    lead: "memory:agency:l3",
  });

  assert.equal(data.lead?.lead, "memory:agency:l3");
  assert.equal(data.lead?.variablesFilled, 0);
  assert.deepEqual(
    data.steps[0]?.variants[1]?.rendered.body,
    "Hi there, {Hi|Hello} from %Sender_City%."
  );
  assert.deepEqual(
    data.steps[0]?.variants[1]?.rendered.subject,
    "{{firstName}} at {{ Company Name }}"
  );
  assert.deepEqual(data.steps[0]?.variants[1]?.unfilled, [
    "firstName",
    "Company Name",
    "Sender_City",
  ]);
});

test("copy_preview reads no lead when the copy has no variables", async () => {
  const result = await single(DATA).insights.copyPreview({
    campaign: "memory:agency:c2",
  });

  assert.equal(result.data.lead, null);
  assert.deepEqual(result.data.steps[0]?.variants[0]?.rendered, {
    body: "No variables.",
    bodyText: "No variables.",
    subject: "Hi",
  });
  assert.deepEqual(result.meta.notes, [
    "The copy uses no variables, so no lead was read.",
  ]);
});

test("copy_preview shows the copy as written when the campaign has no leads", async () => {
  const result = await single(DATA).insights.copyPreview({
    campaign: "memory:agency:c3",
  });

  assert.equal(result.data.lead, null);
  assert.equal(
    result.data.steps[0]?.variants[0]?.rendered.body,
    "Hi {{firstName|there}}"
  );
  // It has a fallback, so a lead would never see it as written.
  assert.deepEqual(result.data.steps[0]?.variants[0]?.unfilled, []);
  assert.match(result.meta.notes.join(" "), /no leads/u);
});

test("copy_preview refuses a lead that does not exist", async () => {
  await assert.rejects(
    single(DATA).insights.copyPreview({
      campaign: CAMPAIGN,
      lead: "memory:agency:nope",
    }),
    (error: unknown) =>
      error instanceof OutboundError && error.code === "NotFound"
  );
});

test("copy_preview under redact keeps the template and masks the lead's values, and says so", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: DATA, workspaceId: "agency" }),
    plugins: [redact(), insights()],
  });

  const result = await outbound.insights.copyPreview({ campaign: CAMPAIGN });
  const variant = result.data.steps[0]?.variants[0];

  assert.equal(variant?.template.subject, "{{subject1}}");
  assert.equal(variant?.rendered.subject, "[redacted]");
  assert.doesNotMatch(JSON.stringify(result.data), /Acme|Bo\b|person2/u);
  assert.match(result.meta.notes.join(" "), /redact plugin masks/u);
});
