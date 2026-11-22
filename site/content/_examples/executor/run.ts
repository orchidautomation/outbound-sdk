import { outboundFor, toolsFor } from "./outbound.ts";
import type { LinkedAccounts } from "./outbound.ts";

// What Executor hands a tool call: each linked account, whose key is a
// handle rather than the key itself, and a fetch that swaps the handle for
// the key on the way out. Here the stand-in fetch records each request and
// answers 401, as every vendor did when this app ran in a local Executor
// with made-up keys.
const accounts: LinkedAccounts = {
  emailbison: [
    {
      fields: {
        apiKey: "handle-4",
        baseUrl: "https://send.emailbison.com",
        client: "globex",
      },
      id: "acc_4",
    },
  ],
  heyreach: [{ fields: { apiKey: "handle-3", client: "acme" }, id: "acc_3" }],
  instantly: [{ fields: { apiKey: "handle-1", client: "acme" }, id: "acc_1" }],
  smartlead: [{ fields: { apiKey: "handle-2" }, id: "acc_2" }],
};

const sent: string[] = [];

const executorFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(init?.headers);
  const where = [...headers].find(([, value]) => value.includes("handle-"));

  const inQuery = [...url.searchParams].find(([, value]) =>
    value.startsWith("handle-")
  );

  url.search = "";
  sent.push(
    `${init?.method ?? "GET"} ${url.href}  key in ${
      where === undefined ? `query ${inQuery?.[0]}` : `header ${where[0]}`
    }`
  );

  return Promise.resolve(
    Response.json({ message: "Invalid API key" }, { status: 401 })
  );
};

// Nothing linked: there is no instance, so the app answers without a request.
console.log(
  "nothing linked:",
  outboundFor(
    { emailbison: [], heyreach: [], instantly: [], smartlead: [] },
    executorFetch
  )
);

const outbound = outboundFor(accounts, executorFetch);

if (outbound !== undefined) {
  const tools = await toolsFor(outbound);

  console.log(`${tools.length} tools, for example:`);
  console.log(
    tools
      .slice(0, 6)
      .map((tool) => `  ${tool.name}`)
      .join("\n")
  );

  const overview = tools.find((tool) => tool.name === "campaign_overview");

  // The four reads run at once, so which 401 is reported first can vary.
  const result = await overview?.call({});

  console.log("\ncampaign_overview {}");
  console.log(
    result?.ok === false
      ? `ok: false, ${result.error.code}, retryable: ${result.error.retryable}, requests: ${result.meta?.requests}`
      : result
  );

  console.log("\nwhat left the app, and where the key went:");
  console.log(sent.map((line) => `  ${line}`).join("\n"));
}
