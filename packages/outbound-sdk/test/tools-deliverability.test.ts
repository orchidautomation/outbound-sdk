// deliverability_check screens every sender of a campaign before it checks
// `limit` of them in full, and says how much it covered (OUT-93).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound } from "../src/index.ts";
import type { Outbound } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemorySender } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { fixture } from "./helpers/fixtures.ts";
import { CAMPAIGN, suite } from "./instantly/suite.ts";

interface Result {
  readonly all_checked: boolean;
  readonly checked: number;
  readonly screened: number;
  readonly senders: readonly { address: string; problems: string[] }[];
  readonly total: number | null;
  readonly with_problems: number;
}

const check = async (
  outbound: Outbound,
  input: Record<string, string | number> = {}
) => {
  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "deliverability_check"
  );

  assert.ok(tool, "deliverability_check is offered");
  const result = await tool.call(input);
  assert.ok(result.ok, JSON.stringify(result));

  return { data: result.data as unknown as Result, next: result.next };
};

const onMemory = (
  senders: readonly MemorySender[],
  capabilities: Record<string, boolean> = {}
) => createOutbound({ adapter: memory({ capabilities, data: { senders } }) });

const mailboxes = (
  count: number,
  at: (index: number) => Partial<MemorySender> = () => ({})
) =>
  Array.from({ length: count }, (_, index) => ({
    address: `sender${index + 1}@example.com`,
    id: `s${index + 1}`,
    status: "active" as const,
    warmup: { enabled: true, score: 90 },
    ...at(index + 1),
  }));

test("deliverability_check finds a disconnected sender past limit in a campaign that names its senders by tag", async () => {
  const account = fixture("instantly", "listAccounts.json") as {
    items: Record<string, unknown>[];
  };

  const template = account.items[0] ?? {};

  // Thirty mailboxes in the campaign's one tag; the 28th has lost its connection.
  const accounts = Array.from({ length: 30 }, (_, index) => ({
    ...template,
    email: `sender${index + 1}@example.com`,
    status: index + 1 === 28 ? -1 : 1,
    status_message: null,
  }));

  const { outbound, requests, settle } = harness(suite, (request) => {
    const { pathname } = new URL(request.url);

    if (pathname === `/api/v2/campaigns/${CAMPAIGN}`) {
      return Response.json({
        ...(fixture("instantly", "getCampaign.json") as object),
        email_list: [],
        email_tag_list: ["tag-2025"],
      });
    }

    if (request.method === "GET" && pathname === "/api/v2/accounts") {
      return Response.json({ items: accounts });
    }

    const one = /^\/api\/v2\/accounts\/(?<email>[^/]+)$/u.exec(pathname);

    const found = accounts.find(
      (candidate) =>
        candidate.email === decodeURIComponent(one?.groups?.email ?? "")
    );

    return request.method === "GET" && found !== undefined
      ? Response.json(found)
      : undefined;
  });

  const { data, next } = await settle(check(outbound, { campaign: CAMPAIGN }));

  assert.equal(
    new URL(
      requests.find(
        (request) => new URL(request.url).pathname === "/api/v2/accounts"
      )?.url ?? ""
    ).searchParams.get("tag_ids"),
    "tag-2025",
    "the campaign's senders come from its tag"
  );
  assert.equal(data.total, 30);
  assert.equal(data.screened, 30);
  assert.equal(data.checked, 10);
  assert.equal(data.all_checked, false);
  assert.equal(data.senders.length, 10);
  assert.ok(data.with_problems >= 1);

  const [first] = data.senders;
  assert.equal(
    first?.address,
    "sender28@example.com",
    "the broken sender is checked first"
  );
  assert.ok(first?.problems.includes("status is disconnected"));
  assert.ok(
    first?.problems.includes("the vendor cannot sign in to this sender")
  );
  assert.match(next, /Only 10 of 30 senders were checked in full/u);
});

test("deliverability_check counts problems on senders it screened but did not check in full", async () => {
  const outbound = onMemory(
    mailboxes(30, (n) => {
      if (n === 12 || n === 27 || n === 30) {
        return { status: "disconnected" };
      }

      if (n === 20) {
        return { status: "error" };
      }

      return n === 5 ? { warmup: { enabled: true, score: 0 } } : {};
    })
  );

  const { data, next } = await check(outbound, { limit: 2 });

  assert.equal(
    data.with_problems,
    5,
    "three disconnected, one failing, one at warmup 0"
  );
  assert.equal(data.checked, 2);
  assert.equal(data.total, 30);
  assert.equal(data.all_checked, false);
  assert.ok(
    data.senders.every((sender) => sender.problems.length > 0),
    "the senders checked in full are ones with a problem"
  );
  assert.match(next, /Only 2 of 30/u);
});

test("deliverability_check never reports no problems on a partial check without saying so", async () => {
  const { data, next } = await check(onMemory(mailboxes(12)), { limit: 3 });

  assert.equal(data.with_problems, 0);
  assert.equal(data.all_checked, false);
  assert.match(next, /Only 3 of 12 senders were checked in full/u);
});

test("deliverability_check says all were checked, with no note, when limit covers every sender", async () => {
  const { data, next } = await check(onMemory(mailboxes(4)), { limit: 10 });

  assert.equal(data.all_checked, true);
  assert.equal(data.checked, 4);
  assert.equal(data.total, 4);
  assert.equal(data.with_problems, 0);
  assert.doesNotMatch(next, /checked in full|not screened/u);
});

test("deliverability_check leaves total null and says so when there are more senders than it screens", async () => {
  const { data, next } = await check(onMemory(mailboxes(501)), { limit: 1 });

  assert.equal(data.screened, 500);
  assert.equal(data.total, null);
  assert.equal(data.all_checked, false);
  assert.match(next, /More than 500 senders exist/u);
});

test("deliverability_check keeps its coverage note when a tool its usual hint names is not on offer", async () => {
  const { data, next } = await check(
    onMemory(mailboxes(12), { "campaigns.settings": false }),
    { limit: 3 }
  );

  assert.equal(data.all_checked, false);
  assert.match(next, /Only 3 of 12 senders were checked in full/u);
});
