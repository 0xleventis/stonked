// Permissionless Token-2022 fee harvester — sweeps withheld transfer-tax out of a mint's own holder
// token accounts into the mint's reserve, for one or more reward-launch tokens on stonk.fun. This is
// HarvestWithheldTokensToMint, which needs no signature/authority from the accounts being harvested — the
// only signer required is whoever pays the transaction's network fee. It does NOT withdraw anything out of
// the mint or pay holders; that step (WithdrawWithheldTokensFromMint) needs stonk.fun's own authority key,
// which this script has no access to and cannot substitute for. See README section below before running.
//
// Usage:
//   npx tsx scripts/harvestCrank.ts --keypair ~/.config/solana/id.json <mint> [<mint> ...]
//   npx tsx scripts/harvestCrank.ts --keypair ./my-crank-key.json --live <mint>
//
// Defaults to a DRY RUN (simulates every transaction, sends nothing) — pass --live to actually broadcast.
// --keypair must point to a local Solana CLI-format keypair JSON file (a plain array of 64 bytes). Never
// pass a raw secret key on the command line or paste one into a chat — only a file path, read locally.

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync } from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createHarvestWithheldTokensToMintInstruction } from "@solana/spl-token";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
// Conservative — keeps each transaction comfortably under Solana's ~1232-byte limit even with a
// ComputeBudget instruction and the mint account included (32 bytes/account + a few bytes overhead each).
const ACCOUNTS_PER_BATCH = 20;
// Refuses to touch more than this many accounts for a single mint in one run without an explicit
// override — a sanity ceiling, not a hard protocol limit, so a mistyped mint or an unexpectedly large
// holder set doesn't silently fire off hundreds of transactions.
const MAX_ACCOUNTS_PER_MINT = 500;

function parseArgs(argv: string[]) {
  const args = { live: false, keypairPath: undefined as string | undefined, mints: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--keypair") args.keypairPath = argv[++i];
    else if (a && !a.startsWith("--")) args.mints.push(a);
  }
  return args;
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path} doesn't look like a Solana CLI keypair file (expected a JSON array of bytes).`);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Every Token-2022 account for this mint, regardless of current balance or whether it actually has
 * anything withheld right now — HarvestWithheldTokensToMint is a no-op (not an error) for an account with
 * nothing withheld, so it's simpler and just as correct to include every account than to first decode each
 * one's TransferFeeAmount extension to check. offset 0 in a Token/Token-2022 account is always the mint
 * pubkey, the one part of the layout that predates all extensions. */
async function fetchAllTokenAccounts(connection: Connection, mint: PublicKey): Promise<PublicKey[]> {
  const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
    dataSlice: { offset: 0, length: 0 }, // only need pubkeys, not full account data
  });
  return accounts.map((a) => a.pubkey);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.keypairPath) {
    console.error("Missing --keypair <path-to-solana-cli-keypair.json>. This pays the network fee — nothing else.");
    process.exit(1);
  }
  if (args.mints.length === 0) {
    console.error("Provide at least one mint address to harvest.");
    process.exit(1);
  }

  const payer = loadKeypair(args.keypairPath);
  const connection = new Connection(RPC_URL, "confirmed");

  console.log(`Fee payer: ${payer.publicKey.toBase58()}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Mode: ${args.live ? "LIVE — will broadcast real transactions" : "DRY RUN — simulate only, nothing will be sent"}`);
  console.log("");

  const balanceLamports = await connection.getBalance(payer.publicKey);
  console.log(`Fee payer balance: ${(balanceLamports / 1e9).toFixed(4)} SOL`);
  if (args.live && balanceLamports < 5_000_000) {
    console.warn("⚠️  Under 0.005 SOL — likely not enough to cover more than a couple of transactions. Fund the wallet before running --live.");
  }
  console.log("");

  for (const mintStr of args.mints) {
    let mint: PublicKey;
    try {
      mint = new PublicKey(mintStr);
    } catch {
      console.error(`Skipping "${mintStr}" — not a valid Solana address.`);
      continue;
    }

    console.log(`=== ${mintStr} ===`);
    const accounts = await fetchAllTokenAccounts(connection, mint);
    console.log(`Found ${accounts.length} Token-2022 account(s) for this mint.`);

    if (accounts.length === 0) {
      console.log("Nothing to harvest.\n");
      continue;
    }
    if (accounts.length > MAX_ACCOUNTS_PER_MINT) {
      console.warn(`⚠️  ${accounts.length} accounts exceeds the safety ceiling of ${MAX_ACCOUNTS_PER_MINT} — skipping this mint. Raise MAX_ACCOUNTS_PER_MINT in the script if this is genuinely intended.`);
      continue;
    }

    const batches = chunk(accounts, ACCOUNTS_PER_BATCH);
    console.log(`Splitting into ${batches.length} transaction(s) of up to ${ACCOUNTS_PER_BATCH} accounts each.`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 + batch.length * 3_000 }));
      tx.add(createHarvestWithheldTokensToMintInstruction(mint, batch, TOKEN_2022_PROGRAM_ID));
      tx.feePayer = payer.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;

      if (!args.live) {
        const sim = await connection.simulateTransaction(tx, [payer]);
        if (sim.value.err) {
          console.log(`  batch ${i + 1}/${batches.length}: SIMULATION FAILED — ${JSON.stringify(sim.value.err)}`);
          (sim.value.logs ?? []).slice(-8).forEach((l) => console.log(`    ${l}`));
        } else {
          console.log(`  batch ${i + 1}/${batches.length}: simulation OK (${batch.length} accounts, ${sim.value.unitsConsumed ?? "?"} compute units) — nothing sent.`);
        }
        continue;
      }

      tx.sign(payer);
      try {
        const sig = await sendAndConfirmRawTransaction(connection, tx.serialize(), { commitment: "confirmed" });
        console.log(`  batch ${i + 1}/${batches.length}: ✅ https://solscan.io/tx/${sig}`);
      } catch (err) {
        console.log(`  batch ${i + 1}/${batches.length}: ❌ ${err instanceof Error ? err.message : err}`);
      }
      void lastValidBlockHeight;
    }
    console.log("");
  }

  console.log(
    args.live
      ? "Done. This harvested withheld tax into each mint's own reserve — it does NOT withdraw or pay out holders; that step needs stonk.fun's own authority key."
      : "Dry run complete — re-run with --live to actually broadcast."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
