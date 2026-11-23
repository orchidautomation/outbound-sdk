// `outbound person`, and the person tools on the CLI's tool list, over two
// in-memory tools combined: an email tool and a LinkedIn tool.

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { combine } from "../src/combine/index.ts";
import type { Adapter } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { EMAIL_TOOL, LINKEDIN_TOOL, PROFILE } from "./insights/helpers.ts";

// The answer inside the envelope: a list's records, or the data itself.
const answerOf = (text: string): never => {
  const { data } = JSON.parse(text) as { data: { items?: unknown } | null };

  return (data?.items ?? data) as never;
};

const cliOn = async (adapter: Adapter, ...argv: string[]) => {
  const out: string[] = [];

  const code = await run([...argv, "--compact"], {
    adapter,
    stderr: () => {},
    stdout: (text) => {
      out.push(text);
    },
  });

  return { code, json: () => answerOf(out.join("")) };
};

const twoTools = () =>
  combine([
    memory({ data: EMAIL_TOOL, name: "mailtool", workspaceId: "agency" }),
    memory({ data: LINKEDIN_TOOL, name: "lntool", workspaceId: "acme" }),
  ]);

test("person finds one person in every tool, from an email or a LinkedIn URL", async () => {
  const person = async (...argv: string[]) => {
    const out: string[] = [];

    const code = await run(["person", ...argv, "--compact"], {
      adapter: twoTools(),
      stderr: () => {},
      stdout: (text) => {
        out.push(text);
      },
    });

    return { code, data: (JSON.parse(out.join("")) as { data: never }).data };
  };

  for (const identifier of ["person1@example.com", PROFILE]) {
    const { code, data } = await person(identifier);

    const summary = data as {
      found: boolean;
      identifiers: string[];
      campaigns: { provider: string }[];
    };

    assert.equal(code, 0);
    assert.equal(summary.found, true);
    assert.deepEqual(summary.identifiers, [
      "email:person1@example.com",
      "linkedin:example-person-1",
    ]);
    assert.deepEqual(
      [...new Set(summary.campaigns.map((entry) => entry.provider))].toSorted(),
      ["lntool", "mailtool"],
      `${identifier} reaches both tools`
    );
  }

  const missing = await run(["person"], {
    adapter: twoTools(),
    stderr: () => {},
    stdout: () => {},
  });

  assert.equal(missing, 1);
});

test("person takes a lead ref another command printed, and refuses one no tool reads (OUT-138)", async () => {
  const lead = await cliOn(twoTools(), "person", "mailtool:agency:l1");
  const summary = lead.json() as { found: boolean; identifiers: string[] };

  assert.equal(lead.code, 0);
  assert.equal(summary.found, true);
  assert.ok(summary.identifiers.includes("email:person1@example.com"));

  const typed = await cliOn(
    twoTools(),
    "insight",
    "person_summary",
    "--input",
    '{"lead_ref":"mailtool:agency:l1"}'
  );

  assert.equal(typed.code, 0);

  const out: string[] = [];

  const elsewhere = await run(["person", "mailtool:other:l1", "--compact"], {
    adapter: twoTools(),
    stderr: () => {},
    stdout: (text) => {
      out.push(text);
    },
  });

  const { error } = JSON.parse(out.join("")) as {
    error: { code: string; message: string };
  };

  assert.equal(elsewhere, 1);
  assert.equal(error.code, "Invalid");
  assert.match(
    error.message,
    /is a lead ref from mailtool workspace other, but no tool on this combined instance is that one/u
  );
});

test("tools offers the person tools, as outbound mcp does", async () => {
  const names = new Set(
    ((await cliOn(twoTools(), "tools")).json() as { name: string }[]).map(
      (tool) => tool.name
    )
  );

  // person is made of person_summary, cross_channel_lead and account_summary.
  assert.ok(names.has("person"), "identity and the insights are offered");
  assert.equal(
    (
      await cliOn(
        twoTools(),
        "tool",
        "person",
        "--input",
        '{"person":"nobody@example.com"}'
      )
    ).code,
    0
  );
});
