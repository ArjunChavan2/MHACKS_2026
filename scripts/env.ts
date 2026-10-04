/**
 * @file Loads `.env.local` (then `.env`) into `process.env` for command-line scripts; Next.js does
 * this itself for the app. Values already set in the shell win.
 */
import { existsSync } from "node:fs";

/**
 * Loads local env files if present.
 *
 * Side effects: sets missing `process.env` keys from `.env.local` and `.env`.
 */
export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
