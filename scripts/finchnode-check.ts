/**
 * @file Live FinchNode check (SPEC.md §7.2): loads the synthetic patient's records the way the app does
 * with `USE_MOCK=false` and prints where they came from, counts per provider and category, and warnings.
 *
 * Uses `FINCHNODE_API_KEY` from `.env.local` when set (sandbox Connect), else FinchNode's demo API.
 * Run with `npm run finchnode:check`. Exits non-zero if no records load.
 */
import { loadLiveRecords } from "../lib/finchnode/live";

/**
 * Runs the check.
 *
 * @returns Resolves when done.
 */
async function main(): Promise<void> {
  const started = Date.now();
  const r = await loadLiveRecords({ externalId: "finchnode-check" });
  console.log(`Origin: ${r.origin} (subject ${r.subject}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const p of r.providers) {
    const mine = r.records.filter((x) => x.provider === p);
    const byCat = Object.entries(Object.groupBy(mine, (x) => x.category)).map(([c, xs]) => `${c} ${xs?.length ?? 0}`);
    console.log(`  ${p}: ${mine.length} records (${byCat.join(", ")})`);
  }
  for (const w of r.warnings) console.log(`  ! ${w}`);
  if (!r.records.length) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
