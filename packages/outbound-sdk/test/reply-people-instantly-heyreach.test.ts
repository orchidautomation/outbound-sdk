// reply_samples by person over Instantly and HeyReach fixtures: a person who
// replied by email in Instantly and on LinkedIn in HeyReach is one row, joined
// by the LinkedIn profile Instantly holds in a custom field (OUT-178, #114).

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../src/index.ts";
import { createTools } from "../src/tools/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import { createClock } from "./helpers/clock.ts";
import { fixture } from "./helpers/fixtures.ts";
import { createFetch, json } from "./helpers/http.ts";
import { LEAD as PROFILE, suite as heyreach } from "./heyreach/suite.ts";
import { suite as instantly } from "./instantly/suite.ts";

const build = (profile: string | null) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fixtures = fixtureHandler([instantly, heyreach], unrouted);

  const http = createFetch((request, index) => {
    const url = new URL(request.url);

    // Every Instantly lead read one by one carries the profile in a custom
    // field named as live workspaces name it.
    if (
      url.origin === instantly.origin &&
      request.method === "GET" &&
      /^\/api\/v2\/leads\/[^/]+$/u.test(url.pathname)
    ) {
      const lead = fixture("instantly", "getLead.json") as Record<
        string,
        unknown
      >;

      return json({
        ...lead,
        id: decodeURIComponent(url.pathname.split("/").at(-1) ?? ""),
        payload: profile === null ? {} : { "LinkedIn URL": profile },
      });
    }

    return fixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: combine([instantly.make(), heyreach.make()]),
    fetch: http.fetch,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  const tool = createTools(outbound).find(
    (each) => each.name === "reply_samples"
  );

  assert.ok(tool !== undefined);

  return { clock, tool, unrouted };
};

interface ByPerson {
  readonly linkedAcrossTools: number | null;
  readonly linkedBy: readonly string[] | null;
  readonly uniquePeople: number | null;
  readonly people: readonly { readonly tools: readonly string[] }[];
}

const call = async (profile: string | null) => {
  const { clock, tool, unrouted } = build(profile);

  const result = await clock.settle(
    tool.call({ by: "person", limit: 50, since: "2020-01-01" })
  );

  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(unrouted, []);

  return { data: result.data as unknown as ByPerson, meta: result.meta };
};

test("an Instantly replier whose custom field holds a HeyReach replier's profile is one row across both tools", async () => {
  const { data, meta } = await call(PROFILE);
  const across = data.people.filter((person) => person.tools.length > 1);

  assert.ok((data.linkedAcrossTools ?? 0) >= 1, JSON.stringify(data.people));
  assert.equal(across.length, data.linkedAcrossTools);
  assert.ok(
    across.every(
      (person) =>
        person.tools.some((one) => one.startsWith("instantly:")) &&
        person.tools.some((one) => one.startsWith("heyreach:"))
    )
  );
  assert.ok(data.linkedBy?.includes("linkedin"));
  assert.ok(
    meta.notes.some((note) => /replied in two or more tools/u.test(note)),
    JSON.stringify(meta.notes)
  );
});

test("with no profile in the custom fields, the same people stay apart and more rows are counted", async () => {
  const joined = await call(PROFILE);
  const apart = await call(null);

  assert.equal(apart.data.linkedAcrossTools, 0);
  assert.ok(
    (apart.data.uniquePeople ?? 0) > (joined.data.uniquePeople ?? 0),
    `${String(apart.data.uniquePeople)} apart, ${String(joined.data.uniquePeople)} joined`
  );
});
