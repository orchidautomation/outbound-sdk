import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

const outbound = createOutbound({ adapter: memory({ data: demoData() }) });

const sender = outbound.sender("mbx_2");

const record = await sender.get();

console.log(record.address, record.kind, record.status, record.dailyLimit);

// `warmup` returns the two fields as they are, with no `meta`.
console.log(await sender.warmup());

const health = await sender.health();

console.log(health.domain, health.dns, health.issues);

console.log(health.warmup);

// The demo data has no per-sender stats, so there are no rows. No rows is
// not the same as a row of zeros.
const stats = await sender.stats();

console.log("rows:", stats.rows.length);
