import { getDb, closeDb } from "./db";
import { startBot } from "./bot/client";
import { info } from "./logger";

// Initialize database
info("Initializing database");
getDb();

// Start bot
await startBot();

// Handle graceful shutdown
process.on("SIGINT", () => {
  info("Shutting down (SIGINT)");
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  info("Shutting down (SIGTERM)");
  closeDb();
  process.exit(0);
});
