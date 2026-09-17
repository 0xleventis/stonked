import { config } from "dotenv";
config({ path: ".env.local" });
import { scanDormantBatch } from "../lib/scan";
import { listDormant } from "../lib/store";

const result = await scanDormantBatch();
console.log("scan result:", result);
const entries = await listDormant();
console.log(`${entries.length} dormant tokens currently tracked:`);
for (const e of entries.slice(0, 20)) {
  console.log(`  ${e.symbol.padEnd(12)} pendingTax=$${e.pendingTaxUsd.toFixed(2).padStart(10)} holders=${e.holderCount} mint=${e.mint}`);
}
process.exit(0);
