import { execSync } from "node:child_process";

/**
 * Applies migrations to the dedicated test database (non-destructive `migrate deploy`).
 * Each suite then reseeds it via `seed()`, which truncates the application tables.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://shopsense:shopsense@localhost:20610/shopsense_test";
  if (!/_test\b|test/.test(new URL(url).pathname)) throw new Error(`Refusing to run tests against non-test database ${url}`);
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" }, stdio: "pipe" });
}
