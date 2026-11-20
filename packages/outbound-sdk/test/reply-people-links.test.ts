// reply_samples by person: on an instance reading two tools, one person's
// email replies in one tool and LinkedIn replies in the other are one row,
// joined by the profile their leads carry, and the answer says what joined
// them (OUT-178).

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createOutbound } from "../src/index.ts";
import type { Adapter } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { redact } from "../src/redact/index.ts";
import { createTools } from "../src/tools/index.ts";

const PROFILE = "https://www.linkedin.com/in/example-person-7";

const reply = (id: string, leadId: string, campaignId: string) => ({
  campaignId,
  direction: "in" as const,
  id,
  leadId,
  sentAt: "2026-11-10T10:00:00.000Z",
  threadId: `t-${id}`,
});

// Email: one lead that carries a profile (on Instantly, from a custom field), one without.
const email = (): Adapter =>
  memory({
    data: {
      campaigns: [{ id: "e1", name: "Email" }],
      leads: [
        {
          campaignId: "e1",
          email: "person7@example.com",
          id: "a1",
          linkedinUrl: PROFILE,
        },
        { campaignId: "e1", email: "person8@example.com", id: "a2" },
      ],
      messages: [reply("m1", "a1", "e1"), reply("m2", "a2", "e1")],
    },
    workspaceId: "email",
  });

// LinkedIn: the same person by profile, with no address.
const linkedin = (profile = `${PROFILE}/`): Adapter =>
  memory({
    data: {
      campaigns: [{ channel: "linkedin", id: "l1", name: "LinkedIn" }],
      leads: [{ campaignId: "l1", id: "b1", linkedinUrl: profile }],
      messages: [reply("m3", "b1", "l1")],
    },
    workspaceId: "linkedin",
  });

const byPerson = async (adapter: Adapter, masked = false) => {
  const outbound = createOutbound({
    adapter,
    plugins: masked ? [redact({})] : [],
  });

  const tool = createTools(outbound).find(
    (each) => each.name === "reply_samples"
  );

  assert.ok(tool !== undefined);

  const result = await tool.call({ by: "person", limit: 10 });
  assert.ok(result.ok, JSON.stringify(result));

  return result as typeof result & {
    readonly data: {
      readonly uniquePeople: number | null;
      readonly linkedAcrossTools: number | null;
      readonly linkedBy: readonly string[] | null;
      readonly people: readonly {
        readonly leads: readonly string[];
        readonly tools: readonly string[];
        readonly linkedinUrl: string | null;
        readonly messages: number;
      }[];
    };
  };
};

test("one person's email and LinkedIn replies are one row, joined by the profile on their leads", async () => {
  const { data, meta } = await byPerson(combine([email(), linkedin()]));

  assert.equal(data.uniquePeople, 2);
  assert.equal(data.linkedAcrossTools, 1);
  // Memory fills both on every lead, as a vendor that is searched by them does.
  assert.deepEqual(data.linkedBy, ["email", "linkedin"]);

  const joined = data.people.find((person) => person.leads.length === 2);
  assert.ok(joined !== undefined, JSON.stringify(data.people));
  assert.equal(joined.messages, 2);
  assert.deepEqual(joined.tools, ["memory:email", "memory:linkedin"]);
  assert.equal(meta.complete, true);
  assert.ok(
    meta.notes.some((note) =>
      /1 person replied in two or more tools .* joined by .*linkedin/u.test(
        note
      )
    ),
    JSON.stringify(meta.notes)
  );
});

test("under redact the masked profiles still join, since one profile gets one token", async () => {
  const { data } = await byPerson(combine([email(), linkedin()]), true);

  assert.equal(data.uniquePeople, 2);
  assert.equal(data.linkedAcrossTools, 1);
  assert.ok(
    data.people.every(
      (person) => !(person.linkedinUrl ?? "").includes("linkedin.com")
    ),
    "no profile is shown"
  );
});

test("people with no address or profile in common stay apart, and the note says none replied in two tools", async () => {
  const noProfile = memory({
    data: {
      campaigns: [{ id: "l1" }],
      leads: [{ campaignId: "l1", id: "b1" }],
      messages: [reply("m3", "b1", "l1")],
    },
    workspaceId: "linkedin",
  });

  const { data, meta } = await byPerson(combine([email(), noProfile]));

  assert.equal(data.uniquePeople, 3);
  assert.equal(data.linkedAcrossTools, 0);
  assert.ok(
    meta.notes.some((note) => note.includes("none of these 3 people did")),
    JSON.stringify(meta.notes)
  );
});

test("one tool reads no lead to answer by person", async () => {
  const { data, meta } = await byPerson(email());

  assert.equal(data.uniquePeople, 2);
  assert.equal(data.linkedAcrossTools, null);
  assert.equal(data.linkedBy, null);
  assert.equal(meta.notes.length, 0);
});
