/**
 * @file Applies the committed SQL migrations in `db/migrations/` to the database in `DATABASE_URL`
 * (SPEC.md §5.1). Safe to re-run: applied migrations are recorded in `drizzle.__drizzle_migrations`.
 *
 * Run with `npm run db:migrate`. Exits non-zero if `DATABASE_URL` is missing or a migration fails.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { loadLocalEnv } from "./env";

/**
 * Runs the migrations.
 *
 * Side effects: creates or alters tables in the configured database.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.example).",
    );
  await migrate(drizzle(neon(url)), { migrationsFolder: "db/migrations" });
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
