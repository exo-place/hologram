import { getDb, closeDb } from "./db";
import { info, warn } from "./logger";
import { gcOldEvents, gcExpiredMutes } from "./db/moderation";

// Initialize database
info("Initializing database");
getDb();

// Prune stale moderation data from previous runs
gcOldEvents(7);
gcExpiredMutes();

// Discord bot (optional — requires DISCORD_TOKEN)
if (process.env.DISCORD_TOKEN) {
  const { startBot } = await import("./bot/client");
  await startBot();
} else {
  warn("DISCORD_TOKEN not set — Discord bot will not start");
}

// Web API server (on by default — set WEB=false to disable)
if (process.env.WEB !== "false") {
  const { startApi } = await import("./api/index");
  const port = Number(process.env.WEB_PORT ?? process.env.PORT) || 3000;
  await startApi(port);
} else {
  info("WEB=false — web server will not start");
}

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
