/**
 * @file Drizzle Kit config. `npm run db:generate` writes SQL migrations from `db/schema.ts` into
 * `db/migrations/`; `npm run db:migrate` applies them to Neon; `npm run db:studio` browses data.
 */
import { defineConfig } from "drizzle-kit";
import { loadLocalEnv } from "./scripts/env";

loadLocalEnv();

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  },
});
