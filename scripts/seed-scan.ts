import { config } from "dotenv";
config({ path: ".env.local" });
import { scanDormantBatch } from "../lib/scan";
import { listDormant } from "../lib/store";

const rounds = Number(process.argv[2] ?? 10);
for (let i = 0; i < rounds; i++) {
  const r = await scanDormantBatch(15, 60);
  console.log(`round ${i + 1}/${rounds}:`, r);
}
const entries = await listDormant();
console.log(`\n${entries.length} dormant tokens tracked. Top 10 by pending tax:`);
for (const e of entries.slice(0, 10)) {
  console.log(`  ${e.symbol.padEnd(12)} $${e.pendingTaxUsd.toFixed(2)}`);
}
process.exit(0);
