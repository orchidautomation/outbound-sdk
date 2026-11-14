import { createOutbound, OutboundError } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { insights } from "outbound-sdk/insights";

import { asVendor } from "../_shared/as-vendor.ts";
import { acmeEmail, acmeLinkedin, globexEmail } from "./seed.ts";

const outbound = createOutbound({
  adapter: combine([
    asVendor("instantly", acmeEmail, "acme"),
    asVendor("heyreach", acmeLinkedin, "acme"),
    asVendor("instantly", globexEmail, "globex"),
  ]),
  plugins: [insights()],
});

// The workspaces of a combined instance are its members. No request is made.
const workspaces = await outbound.workspaces.list();

console.log(workspaces.items.map((workspace) => workspace.ref));

// One member carries "globex", so the scope is that member: a bare id works.
const globex = outbound.workspace("globex");
const campaign = await globex.campaigns.get("cmp_1");

console.log(globex.provider, globex.workspaceId, "-", campaign.name);

// Two members carry "acme", so the scope is those two, still combined.
const acme = outbound.workspace("acme");
const campaigns = await acme.campaigns.listAll().toArray();

console.log(acme.provider, "-", campaigns.map((item) => item.ref).join(", "));

// The scope keeps the plugins of the instance it came from.
const ranking = await globex.insights.campaignRanking({});

console.log("insight ran on:", ranking.meta.provider);

const attempt = async <Result>(
  label: string,
  read: () => Promise<Result> | Result
) => {
  try {
    await read();
    console.log(label, "- ok");
  } catch (error) {
    if (!OutboundError.is(error)) {
      throw error;
    }

    console.log(label, "-", error.code, "-", error.message);
  }
};

await attempt("combined native", () => outbound.native.read("workspace"));

await attempt("combined raw", () => outbound.raw.get("/campaigns"));

await attempt("combined thread", () => outbound.thread("thr_1").messages());

await attempt("acme native", () => acme.native.read("workspace"));

await attempt("unknown label", () => outbound.workspace("initech"));
