/**
 * Shared test database setup. Creates an in-memory SQLite database with the
 * real production schema from schema.ts, ensuring tests always match the
 * actual database structure.
 *
 * Imports from schema.ts (not index.ts) so it works even when index.ts is
 * mocked via mock.module in tests.
 *
 * Usage:
 *   import { createTestDb } from "./test-utils";   // or "../db/test-utils"
 *   let testDb: Database;
 *   beforeEach(() => { testDb = createTestDb(); });
 *
 * By default, embedding tables are created as plain BLOB tables (no sqlite-vec
 * required). Pass `{ useVec0: true }` if the test loads the sqlite-vec extension.
 */
import { Database } from "bun:sqlite";
import { load } from "sqlite-vec";
import { initSchema } from "./schema";

export function createTestDb({ useVec0 = false } = {}): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  if (useVec0) {
    load(db);
  }
  initSchema(db, { useVec0 });
  return db;
}
