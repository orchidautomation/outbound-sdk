import { outbound } from "./agency.ts";
import { blockListReport, collisionReport } from "./overlap.ts";

console.log(await collisionReport(outbound));

console.log(`\n${await blockListReport(outbound)}`);
