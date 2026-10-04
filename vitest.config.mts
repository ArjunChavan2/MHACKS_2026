/**
 * @file Vitest configuration: Node environment and the `@/` import alias (SPEC.md §5.7).
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // hookTimeout: the PGlite suites run all migrations in beforeAll, which can exceed the default 10 s
  // when every test file runs in parallel.
  test: { environment: "node", include: ["tests/**/*.test.ts"], hookTimeout: 30_000 },
});
