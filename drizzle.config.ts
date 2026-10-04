/**
 * @file Drizzle Kit config: push `db/schema.ts` to Neon with `npx drizzle-kit push`.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
