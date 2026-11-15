import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alerts,
  bounceRateAbove,
  memoryAlertDedupe,
  noSends,
  senderNotActive,
} from "../src/alerts/index.ts";
import type { Alert } from "../src/alerts/index.ts";
import { exporter } from "../src/exporter/index.ts";
import type { RowWriter } from "../src/exporter/index.ts";
import { createOutbound } from "../src/index.ts";
import type { JsonObject } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";

// One campaign with a 12% bounce rate, and one sender that is down.
const data = (): MemoryData => ({
  campaigns: [{ id: "bad", name: "Acme agencies" }],
  senders: [
    { address: "ok@example.com", id: "s1" },
    { address: "down@example.com", id: "s2", status: "disconnected" },
  ],
  stats: [
    {
      campaignId: "bad",
      counts: { bounced: 12, contacted: 100, replied: 1, sent: 100 },
      date: "2026-10-05",
    },
  ],
});

// Lets a fire-and-forget notifier run.
const settle = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

test("alerts with a dedupe store notify once per rule and subject, however many reads show it", async () => {
  const rules = [senderNotActive()];
  const loud: Alert[][] = [];
  const once: Alert[][] = [];
  // The caller's own store: here a set, in a real run a table or a key-value store.
  const seen = new Set<string>();

  const store = {
    add: (key: string) => {
      seen.add(key);

      return Promise.resolve();
    },
    has: (key: string) => Promise.resolve(seen.has(key)),
  };

  const repeating = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [
      alerts({
        notify: (fired) => {
          loud.push([...fired]);
        },
        rules,
      }),
    ],
  });

  const deduped = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [
      alerts({
        dedupe: store,
        notify: (fired) => {
          once.push([...fired]);
        },
        rules,
      }),
    ],
  });

  // One run that meets the same paused sender three times: two listings and a lookup.
  for (const outbound of [repeating, deduped]) {
    // oxlint-disable-next-line no-await-in-loop -- the same reads on each instance, in order.
    await Promise.all([outbound.senders.list(), outbound.senders.list()]);
    // oxlint-disable-next-line no-await-in-loop -- the same reads on each instance, in order.
    await outbound.senders.get("s2");
  }

  await settle();
  // The default is unchanged: every read that shows the condition notifies.
  assert.equal(loud.length, 3);
  assert.deepEqual(
    once.map((fired) => fired.map((alert) => alert.subject)),
    [["memory:default:s2"]]
  );
  assert.deepEqual(
    [...seen],
    ["sender-not-active|memory:default:s2|disconnected"]
  );

  // A later run with the same store stays quiet about what it already told.
  const later: Alert[][] = [];

  const resumed = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [
      alerts({
        dedupe: store,
        notify: (fired) => {
          later.push([...fired]);
        },
        rules: [...rules, bounceRateAbove(0.05)],
      }),
    ],
  });

  await resumed.senders.list();
  await resumed.campaign("bad").stats();
  await resumed.campaign("bad").stats();
  await settle();
  assert.deepEqual(
    later.map((fired) => fired.map((alert) => alert.rule)),
    [["bounce-rate-above"]]
  );

  // The store that ships: this process's memory.
  const local: Alert[][] = [];

  const inProcess = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [
      alerts({
        dedupe: memoryAlertDedupe(),
        notify: (fired) => {
          local.push([...fired]);
        },
        rules,
      }),
    ],
  });

  await inProcess.senders.list();
  await inProcess.senders.list();
  await settle();
  assert.equal(local.length, 1);

  // A store that fails cannot fail the read.
  const broken = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [
      alerts({
        dedupe: {
          add: () => {},
          has: () => Promise.reject(new Error("the store is down")),
        },
        notify: () => {},
        rules,
      }),
    ],
  });

  assert.equal((await broken.senders.list()).items.length, 2);
  await settle();
});

// A day on which campaign c1 sent nothing.
const quiet = (date: string) => ({
  campaignId: "c1",
  counts: { contacted: 0, sent: 0 },
  date,
});

test("alerts dedupe by the day of the data point, and by the value of a state", async () => {
  const store = memoryAlertDedupe();
  const told: Alert[][] = [];

  const instance = (seed: MemoryData) =>
    createOutbound({
      adapter: memory({ data: seed }),
      plugins: [
        alerts({
          dedupe: store,
          notify: (fired) => {
            told.push([...fired]);
          },
          rules: [noSends(), senderNotActive()],
        }),
      ],
    });

  // No sends on 11-10: one alert.
  const first = instance({
    campaigns: [{ id: "c1" }],
    stats: [quiet("2026-11-10")],
  });

  await first.campaign("c1").stats({ by: "day" });
  // A repeat run over the same day says nothing new.
  await first.campaign("c1").stats({ by: "day" });
  await settle();

  // The next day is quiet too: a new data point, so a new alert.
  const next = instance({
    campaigns: [{ id: "c1" }],
    stats: [quiet("2026-11-10"), quiet("2026-11-11")],
  });

  await next.campaign("c1").stats({ by: "day" });
  await settle();

  assert.deepEqual(
    told.map((fired) => fired.map((alert) => [alert.rule, alert.day])),
    [[["no-sends", "2026-11-10"]], [["no-sends", "2026-11-11"]]]
  );

  // A sender paused, then in error: a state that changed alerts again.
  told.length = 0;

  const paused = instance({
    senders: [{ address: "a@example.com", id: "s1", status: "paused" }],
  });

  await paused.senders.list();
  await paused.senders.list();

  const broken = instance({
    senders: [{ address: "a@example.com", id: "s1", status: "error" }],
  });

  await broken.senders.list();
  await settle();

  assert.deepEqual(
    told.map((fired) => fired.map((alert) => alert.value)),
    [["paused"], ["error"]]
  );
});

// A writer that keeps what it is given.
const collect = () => {
  const rows: JsonObject[] = [];

  const writer: RowWriter = {
    close: () => Promise.resolve(),
    write: (row) => {
      rows.push(row);

      return Promise.resolve();
    },
  };

  return { rows, writer };
};

test("exporter gives a writer the same columns a file gets: `columns` and `includeRaw` apply to it", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [exporter()],
  });

  const chosen = collect();

  const result = await outbound.export(outbound.senders.listAll(), {
    columns: ["ref", "address", "missing"],
    to: chosen.writer,
  });

  assert.deepEqual(result.columns, ["ref", "address", "missing"]);
  // Exactly the requested columns, in order; one the record lacks is null.
  assert.deepEqual(chosen.rows, [
    { address: "ok@example.com", missing: null, ref: "memory:default:s1" },
    { address: "down@example.com", missing: null, ref: "memory:default:s2" },
  ]);
  assert.deepEqual(Object.keys(chosen.rows[0] ?? {}), result.columns);

  const plain = collect();

  const defaults = await outbound.export(outbound.senders.listAll(), {
    to: plain.writer,
  });

  assert.ok(!defaults.columns.includes("raw"));
  assert.ok(plain.rows.every((row) => !("raw" in row)));
  assert.deepEqual(Object.keys(plain.rows[0] ?? {}), defaults.columns);

  const raw = collect();

  await outbound.export(outbound.senders.listAll(), {
    includeRaw: true,
    to: raw.writer,
  });
  assert.ok(raw.rows.every((row) => "raw" in row));
});
