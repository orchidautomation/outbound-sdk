import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, ref, refused } from "./senders-helpers.ts";

const PASSING = { dkim: true, dmarc: true, mx: true, spf: true };

const DATA: MemoryData = {
  senders: [
    {
      address: "D@Good.example",
      health: {
        ...PASSING,
        blacklisted: false,
        connected: true,
        warmup: { sent: 80, spam: 2 },
      },
      id: "s4",
    },
    {
      address: "a@bad.example",
      health: {
        ...PASSING,
        blacklisted: false,
        connected: true,
        spf: false,
        warmup: { sent: 100, spam: 5 },
      },
      id: "s1",
    },
    {
      address: "b@bad.example",
      health: {
        ...PASSING,
        blacklisted: true,
        connected: true,
        issues: ["Listed on a block list"],
        warmup: { sent: 100, spam: 25 },
      },
      id: "s2",
      status: "error",
    },
    // No sent count: the spam is counted against inbox plus spam, 45 + 5.
    {
      address: "c@mid.example",
      health: {
        ...PASSING,
        blacklisted: false,
        connected: false,
        dmarc: false,
        warmup: { inbox: 45, spam: 5 },
      },
      id: "s3",
    },
    { address: "e@quiet.example", id: "s5" },
    { address: "f@part.example", health: { spf: true }, id: "s6" },
    {
      health: { connected: true },
      id: "s8",
      linkedinUrl: "https://www.linkedin.com/in/seat-8",
      name: "Seat Eight",
    },
    {
      health: { connected: false, issues: ["Session expired"] },
      id: "s7",
      linkedinUrl: "https://www.linkedin.com/in/seat-7",
      status: "disconnected",
    },
    { id: "s9", linkedinUrl: "https://www.linkedin.com/in/seat-9" },
    { id: "s10", name: "No address" },
  ],
};

test("domain_health groups mailboxes by domain and ranks the domains worst first", async () => {
  const result = await single(DATA).insights.domainHealth({}, { now: NOW });
  const { domains, totals } = result.data;

  assert.equal(result.insight, "domain_health");
  assert.deepEqual(
    domains.map((domain) => [domain.domain, domain.risk]),
    [
      ["bad.example", "high"],
      ["mid.example", "medium"],
      // Both low with no reasons: the one with a known spam rate comes first.
      ["good.example", "low"],
      ["part.example", "low"],
      ["quiet.example", "unknown"],
    ]
  );

  const [bad, mid, good, part, quiet] = domains;

  assert.deepEqual(bad?.reasons, [
    "1 of 2 mailboxes are on a block list",
    "SPF failing",
    // 5 + 25 spam of 100 + 100 sent.
    "30 of 200 warmup emails landed in spam (0.15, over 0.1)",
  ]);
  assert.deepEqual(bad?.failingDns, ["spf"]);
  assert.equal(bad?.blacklisted, 1);
  assert.equal(bad?.disconnected, 0);
  assert.deepEqual(bad?.warmup, {
    interval: { high: 0.2061, low: 0.1071 },
    mailboxes: 2,
    sent: 200,
    spam: 30,
    spamRate: 0.15,
  });
  assert.deepEqual(bad?.notReported, []);
  assert.deepEqual(bad?.mailboxes, [
    {
      address: "a@bad.example",
      blacklisted: false,
      connected: true,
      failingDns: ["spf"],
      issues: [],
      sender: ref("s1"),
      status: "active",
    },
    {
      address: "b@bad.example",
      blacklisted: true,
      connected: true,
      failingDns: [],
      issues: ["Listed on a block list"],
      sender: ref("s2"),
      status: "error",
    },
  ]);

  assert.deepEqual(mid?.reasons, [
    "DMARC failing",
    "1 of 1 mailboxes are disconnected",
  ]);
  // 5 of 50 is exactly the threshold, which is not over it.
  assert.deepEqual(mid?.warmup, {
    interval: { high: 0.2136, low: 0.0435 },
    mailboxes: 1,
    sent: 50,
    spam: 5,
    spamRate: 0.1,
  });
  assert.equal(mid?.disconnected, 1);

  assert.equal(good?.warmup.spamRate, 0.025);
  assert.deepEqual(good?.reasons, []);
  assert.equal(good?.mailboxes[0]?.address, "d@good.example");

  assert.deepEqual(part?.notReported, [
    "dkim",
    "dmarc",
    "mx",
    "connection",
    "blocklist",
    "warmup",
  ]);

  assert.deepEqual(totals, {
    domains: 5,
    high: 1,
    linkedinSeats: 3,
    low: 2,
    medium: 1,
    senders: 10,
    unknown: 1,
  });
  assert.equal(quiet?.risk, "unknown");
  assert.equal(result.meta.complete, true);
});

test("domain_health keeps what the vendor does not report as null, and a silent domain as unknown", async () => {
  const result = await single(DATA).insights.domainHealth({});
  const quiet = result.data.domains.at(-1);

  assert.deepEqual(quiet?.warmup, {
    interval: null,
    mailboxes: 0,
    sent: null,
    spam: null,
    spamRate: null,
  });
  assert.deepEqual(quiet?.notReported, [
    "spf",
    "dkim",
    "dmarc",
    "mx",
    "connection",
    "blocklist",
    "warmup",
  ]);
  assert.deepEqual(quiet?.mailboxes[0], {
    address: "e@quiet.example",
    blacklisted: null,
    connected: null,
    failingDns: [],
    issues: [],
    sender: ref("s5"),
    status: "active",
  });
  assert.equal(quiet?.blacklisted, 0);
});

test("domain_health lists LinkedIn seats apart, disconnected first, and mailboxes with no domain", async () => {
  const { data } = await single(DATA).insights.domainHealth({});

  assert.deepEqual(data.linkedinSeats, [
    {
      connected: false,
      issues: ["Session expired"],
      linkedinUrl: "https://www.linkedin.com/in/seat-7",
      name: null,
      sender: ref("s7"),
      status: "disconnected",
    },
    {
      connected: null,
      issues: [],
      linkedinUrl: "https://www.linkedin.com/in/seat-9",
      name: null,
      sender: ref("s9"),
      status: "active",
    },
    {
      connected: true,
      issues: [],
      linkedinUrl: "https://www.linkedin.com/in/seat-8",
      name: "Seat Eight",
      sender: ref("s8"),
      status: "active",
    },
  ]);
  assert.deepEqual(data.mailboxesWithoutDomain, [ref("s10")]);
});

test("domain_health moves a domain to high risk when the spam threshold drops under its rate", async () => {
  const risks = async (threshold: number) => {
    const { data } = await single(DATA).insights.domainHealth({
      spam_rate_threshold: threshold,
    });

    return Object.fromEntries(
      data.domains.map((domain) => [domain.domain, domain.risk])
    );
  };

  // mid.example is at 0.1 and good.example at 0.025.
  assert.deepEqual(await risks(0.05), {
    "bad.example": "high",
    "good.example": "low",
    "mid.example": "high",
    "part.example": "low",
    "quiet.example": "unknown",
  });
  assert.equal((await risks(0.02))["good.example"], "high");

  const loose = await single(DATA).insights.domainHealth({
    spam_rate_threshold: 0.2,
  });

  assert.deepEqual(loose.data.domains[0]?.reasons, [
    "1 of 2 mailboxes are on a block list",
    "SPF failing",
  ]);
});

test("domain_health has nothing to say about a workspace with no senders", async () => {
  const result = await single({}).insights.domainHealth({});

  assert.deepEqual(result.data, {
    domains: [],
    linkedinSeats: [],
    mailboxesWithoutDomain: [],
    totals: {
      domains: 0,
      high: 0,
      linkedinSeats: 0,
      low: 0,
      medium: 0,
      senders: 0,
      unknown: 0,
    },
  });
  assert.equal(result.meta.complete, true);
});

test("domain_health says so when max_senders stops the read", async () => {
  const result = await single(DATA).insights.domainHealth({ max_senders: 3 });

  assert.equal(result.data.totals.senders, 3);
  assert.deepEqual(
    result.data.domains.map((domain) => domain.domain),
    ["bad.example", "good.example"]
  );
  assert.equal(result.meta.complete, false);
  assert.ok(
    result.meta.notes.includes(
      "Only the first 3 senders were read; more exist."
    )
  );

  const exact = await single(DATA).insights.domainHealth({ max_senders: 10 });
  assert.equal(
    exact.meta.complete,
    true,
    "a cap equal to the count cuts nothing"
  );
});

test("domain_health is refused when the adapter cannot list senders or read their health", async () => {
  await refused(
    () => single(DATA, { "senders.health": false }).insights.domainHealth({}),
    "senders.health"
  );
  await refused(
    () => single(DATA, { "senders.list": false }).insights.domainHealth({}),
    "senders.list"
  );
});

test("domain_health pools one domain's mailboxes across two tools", async () => {
  const outbound = pair(
    {
      senders: [
        {
          address: "a@shared.example",
          health: { warmup: { sent: 60, spam: 3 } },
          id: "m1",
        },
      ],
    },
    {
      senders: [
        {
          address: "b@shared.example",
          health: { connected: false, warmup: { sent: 40, spam: 9 } },
          id: "m2",
        },
        { id: "seat", linkedinUrl: "https://www.linkedin.com/in/seat-1" },
      ],
    }
  );

  const { data, meta } = await outbound.insights.domainHealth({});
  const [shared] = data.domains;

  assert.equal(data.domains.length, 1);
  assert.deepEqual(
    shared?.mailboxes.map((mailbox) => mailbox.sender),
    ["mailtool:agency:m1", "lntool:agency:m2"]
  );
  // 3 + 9 spam of 60 + 40 sent: 0.12 is over the default 0.1.
  assert.equal(shared?.warmup.spamRate, 0.12);
  assert.equal(shared?.risk, "high");
  assert.deepEqual(shared?.reasons, [
    "12 of 100 warmup emails landed in spam (0.12, over 0.1)",
    "1 of 2 mailboxes are disconnected",
  ]);
  assert.equal(data.linkedinSeats[0]?.sender, "lntool:agency:seat");
  assert.equal(meta.provider, "combined");
});
