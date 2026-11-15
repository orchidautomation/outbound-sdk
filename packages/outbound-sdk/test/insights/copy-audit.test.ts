import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { ref } from "./copy-helpers.ts";
import { NOW, single } from "./helpers.ts";

const PIXEL =
  '<img src="https://t.example.com/pixel.gif" width="1" height="1">';

// 70 characters.
const LONG_SUBJECT =
  "A brand new idea that is far too long for a subject line to carry well";

const EMAIL: MemoryData = {
  campaigns: [
    {
      id: "c1",
      name: "Founders Q4",
      steps: [
        {
          variants: [
            {
              body: "Hi {{firstName}}, saw your post on CRM costs. Worth a chat? https://example.com/a",
              subject: "Quick question about {{company}}",
            },
            {
              // No subject, an unclosed variable, three spam phrases, three
              // capital words of four letters or more (ACT and NOW are three),
              // two exclamation marks, three links and a tracking pixel.
              body: `Hi {{firstName}, ACT NOW for a FREE TRIAL!! This is URGENT. https://example.com/a https://example.com/b www.example.com ${PIXEL}`,
            },
          ],
        },
        {
          variants: [
            {
              // 151 words. The subject continues the first email's thread.
              body: Array.from({ length: 151 }, () => "word").join(" "),
              subject: "Re: quick question about {{company}}",
            },
            { body: "{{ }} hello", subject: LONG_SUBJECT },
          ],
        },
        // The vendor returned no body for this step.
        { variants: [{ subject: "" }] },
      ],
    },
    { id: "empty" },
  ],
};

const LINKEDIN: MemoryData = {
  campaigns: [
    {
      channel: "linkedin",
      id: "k1",
      steps: [
        {
          action: "connection_request",
          variants: [{ body: "x".repeat(301) }],
        },
        {
          action: "message",
          variants: [
            {
              // Email-only checks do not apply: the links, the image and the spam phrase pass.
              body: `Hi {{firstName, click here https://example.com/a https://example.com/b ${PIXEL}`,
            },
          ],
        },
      ],
    },
  ],
};

test("copy_audit finds each problem, with its severity and the text behind it, worst first", async () => {
  const result = await single(EMAIL).insights.copyAudit(
    { campaign: ref("c1") },
    { now: NOW }
  );

  assert.equal(result.insight, "copy_audit");
  // The campaign record is read anyway, so its name comes back with the ref.
  assert.equal(result.data.campaignName, "Founders Q4");
  assert.equal(result.data.channel, "email");
  assert.equal(result.data.clean, false);
  assert.deepEqual(
    result.data.findings.map((finding) => [
      finding.severity,
      finding.step,
      finding.variantKey,
      finding.check,
      finding.text,
    ]),
    [
      [
        "high",
        0,
        "B",
        "malformed_variable",
        "Hi {{firstName}, ACT NOW for a FR",
      ],
      ["high", 0, "B", "missing_subject", ""],
      ["high", 1, "B", "malformed_variable", "{{ }}"],
      ["medium", 0, "B", "image", PIXEL],
      ["medium", 0, "B", "spam_words", "act now, free trial, urgent"],
      [
        "medium",
        0,
        "B",
        "too_many_links",
        "https://example.com/a https://example.com/b www.example.com",
      ],
      ["medium", 1, "B", "subject_breaks_thread", LONG_SUBJECT],
      ["low", 0, "B", "all_caps", "FREE TRIAL URGENT"],
      ["low", 0, "B", "exclamation_marks", "!!"],
      [
        "low",
        1,
        "A",
        "body_too_long",
        "word word word word word word word word word word word word",
      ],
      ["low", 1, "B", "subject_too_long", LONG_SUBJECT],
    ]
  );

  const finding = (check: string) =>
    result.data.findings.find((each) => each.check === check)?.finding;

  assert.equal(
    finding("subject_too_long"),
    "The subject is 70 characters; the limit is 60."
  );
  assert.equal(
    finding("body_too_long"),
    "The body is 151 words; the limit is 150."
  );
  assert.equal(
    finding("too_many_links"),
    "The body has 3 links; the limit is 1."
  );
  assert.equal(
    finding("exclamation_marks"),
    "The copy has 2 exclamation marks; the limit is 1."
  );
  assert.match(finding("image") ?? "", /tracking pixel/u);
  assert.match(finding("malformed_variable") ?? "", /not balanced/u);
  assert.equal(result.data.findings[0]?.action, "email");

  assert.deepEqual(result.data.bySeverity, { high: 3, low: 4, medium: 4 });
  // Every email check is listed, the ones that fired first; the LinkedIn check is not.
  assert.deepEqual(
    result.data.byCheck.map((each) => [each.check, each.severity, each.count]),
    [
      ["malformed_variable", "high", 2],
      ["missing_subject", "high", 1],
      ["image", "medium", 1],
      ["spam_words", "medium", 1],
      ["subject_breaks_thread", "medium", 1],
      ["too_many_links", "medium", 1],
      ["all_caps", "low", 1],
      ["body_too_long", "low", 1],
      ["exclamation_marks", "low", 1],
      ["subject_too_long", "low", 1],
    ]
  );
  assert.deepEqual(
    [
      result.data.stepsChecked,
      result.data.variantsChecked,
      result.data.variantsWithoutBody,
    ],
    [3, 5, 1]
  );
  assert.deepEqual(result.meta.notes, [
    "1 variant has no body in the vendor's answer, so its body checks were skipped.",
  ]);
});

const checks = async (input: Record<string, number | string[]>) => {
  const result = await single(EMAIL).insights.copyAudit(
    { campaign: ref("c1"), ...input },
    { now: NOW }
  );

  return result.data.findings.map(
    (finding) => `${finding.step}${finding.variantKey}:${finding.check}`
  );
};

test("copy_audit moves each limit with its input", async () => {
  const all = await checks({});

  for (const [input, gone] of [
    [{ max_subject_chars: 70 }, "1B:subject_too_long"],
    [{ max_body_words: 151 }, "1A:body_too_long"],
    [{ max_links: 3 }, "0B:too_many_links"],
    [{ max_caps_words: 3 }, "0B:all_caps"],
    [{ max_exclamations: 2 }, "0B:exclamation_marks"],
  ] as const) {
    assert.ok(all.includes(gone));
    assert.deepEqual(
      await checks(input),
      all.filter((each) => each !== gone)
    );
  }

  // One below each limit still fires.
  assert.ok(
    (await checks({ max_subject_chars: 69 })).includes("1B:subject_too_long")
  );

  // A caller's list replaces the default one: "chat" is in variant 0A only.
  const custom = await checks({ spam_words: ["chat", "nothing here"] });

  assert.ok(custom.includes("0A:spam_words"));
  assert.ok(!custom.includes("0B:spam_words"));

  // "chat" is matched whole: "chatter" is not a hit.
  const partial = await single({
    campaigns: [
      {
        id: "c1",
        steps: [{ variants: [{ body: "No chatter.", subject: "Hello" }] }],
      },
    ],
  }).insights.copyAudit(
    { campaign: ref("c1"), spam_words: ["chat"] },
    { now: NOW }
  );

  assert.equal(partial.data.clean, true);
});

test("copy_audit on a LinkedIn campaign skips the email checks and measures the connection request", async () => {
  const outbound = single(LINKEDIN);

  const result = await outbound.insights.copyAudit(
    { campaign: ref("k1") },
    { now: NOW }
  );

  assert.equal(result.data.channel, "linkedin");
  assert.deepEqual(
    result.data.findings.map((finding) => [
      finding.step,
      finding.action,
      finding.check,
      finding.severity,
      finding.finding,
    ]),
    [
      [
        0,
        "connection_request",
        "connection_request_too_long",
        "high",
        "The connection request is 301 characters; LinkedIn cuts it at 300.",
      ],
      [
        1,
        "message",
        "malformed_variable",
        "high",
        "A variable's braces are not balanced, so it sends as raw text.",
      ],
    ]
  );
  assert.deepEqual(
    result.data.byCheck.map((each) => each.check),
    [
      "connection_request_too_long",
      "malformed_variable",
      "all_caps",
      "body_too_long",
      "exclamation_marks",
    ]
  );

  const longer = await outbound.insights.copyAudit(
    { campaign: ref("k1"), max_connection_chars: 301 },
    { now: NOW }
  );

  assert.deepEqual(
    longer.data.findings.map((finding) => finding.check),
    ["malformed_variable"]
  );
});

test("copy_audit tells an image from a tracking pixel and accepts a clean or empty sequence", async () => {
  const picture = await single({
    campaigns: [
      {
        id: "c1",
        steps: [
          {
            variants: [
              {
                body: 'See <img src="https://example.com/logo.png" width="120"> and {{firstName}}',
                subject: "Hello",
              },
            ],
          },
          // An empty subject on a follow-up continues the thread.
          { variants: [{ body: "Following up." }] },
        ],
      },
    ],
  }).insights.copyAudit({ campaign: ref("c1") }, { now: NOW });

  assert.deepEqual(
    picture.data.findings.map((finding) => [finding.check, finding.finding]),
    [
      [
        "image",
        "The body holds an image, which cold email filters weigh against.",
      ],
    ]
  );

  const empty = await single(EMAIL).insights.copyAudit(
    { campaign: ref("empty") },
    { now: NOW }
  );

  assert.equal(empty.data.clean, true);
  assert.deepEqual(empty.data.findings, []);
  assert.deepEqual(empty.data.bySeverity, { high: 0, low: 0, medium: 0 });
  assert.deepEqual(
    [empty.data.stepsChecked, empty.data.variantsChecked],
    [0, 0]
  );
  assert.ok(empty.data.byCheck.every((each) => each.count === 0));
  assert.equal(empty.meta.complete, true);
});

test("copy_audit is refused without the sequence", async () => {
  await assert.rejects(
    single(EMAIL, { sequence: false }).insights.copyAudit(
      { campaign: ref("c1") },
      { now: NOW }
    ),
    (error) =>
      error instanceof OutboundError &&
      error.code === "Unsupported" &&
      error.message.includes("sequence")
  );
});

test("copy_audit picks the channel's checks per campaign on a combined instance", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ data: EMAIL, name: "mailtool", workspaceId: "agency" }),
      memory({ data: LINKEDIN, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [insights()],
  });

  const email = await outbound.insights.copyAudit(
    { campaign: ref("c1", "mailtool") },
    { now: NOW }
  );

  const linkedin = await outbound.insights.copyAudit(
    { campaign: ref("k1", "lntool") },
    { now: NOW }
  );

  assert.deepEqual(
    [email.data.channel, email.data.findings.length],
    ["email", 11]
  );
  assert.deepEqual(
    [linkedin.data.channel, linkedin.data.findings.length],
    ["linkedin", 2]
  );
});

const linksIn = async (body: string): Promise<string | null> => {
  const result = await single({
    campaigns: [
      {
        id: "c1",
        steps: [{ variants: [{ body, subject: "Quick question" }] }],
      },
    ],
  }).insights.copyAudit({ campaign: ref("c1"), max_links: 0 }, { now: NOW });

  return (
    result.data.findings.find((each) => each.check === "too_many_links")
      ?.finding ?? null
  );
};

test("copy_audit counts a linked URL in an HTML body as one link (OUT-59)", async () => {
  const href = "https://x.example/demo";

  // The way most editors write a link: the address is also the link text.
  assert.equal(
    await linksIn(`<p>See <a href="${href}">${href}</a></p>`),
    "The body has 1 link; the limit is 0."
  );
  assert.equal(
    await linksIn(
      `<a href="${href}">${href}</a> and <a href='https://y.example'>the other one</a>`
    ),
    "The body has 2 links; the limit is 0."
  );
  assert.equal(
    await linksIn(`See ${href} for more.`),
    "The body has 1 link; the limit is 0."
  );
  // A link and a bare address beside it are two.
  assert.equal(
    await linksIn(`<a href="${href}">the demo</a> or https://y.example`),
    "The body has 2 links; the limit is 0."
  );
});
