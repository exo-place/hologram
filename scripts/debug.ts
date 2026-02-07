/**
 * CLI entrypoint for debug inspection tools.
 *
 * Usage:
 *   bun run debug embeddings [status|test|sim|coverage|rag] [args...]
 *   bun run debug state [bindings|memories|errors|effects|messages] [args...]
 *   bun run debug eval [trace|respond] [args...]
 */

import { info, error, configureLogger } from "../src/logger";
import { getDb } from "../src/db/index";
import { getEntityByName } from "../src/db/entities";
import {
  getEmbeddingStatus,
  testEmbed,
  testSimilarity,
  getEmbeddingCoverage,
  testRagRetrieval,
  getBindingGraph,
  getMemoryStats,
  getEvalErrors,
  getActiveEffectsDebug,
  getMessageStats,
  traceFacts,
  simulateResponse,
} from "../src/debug/index";

// Enable debug logging for CLI
configureLogger({ level: "info" });

// Initialize database
getDb();

const [, , group, subcommand, ...rest] = process.argv;

function resolveEntityId(arg: string | undefined): number | null {
  if (!arg) return null;
  const id = parseInt(arg);
  if (!isNaN(id)) return id;
  const entity = getEntityByName(arg);
  return entity?.id ?? null;
}

function getArg(flag: string): string | undefined {
  const idx = rest.indexOf(flag);
  if (idx === -1 || idx + 1 >= rest.length) return undefined;
  return rest[idx + 1];
}

function usage(): void {
  info("Usage:");
  info("  bun run debug embeddings [status|test|sim|coverage|rag] [args...]");
  info("  bun run debug state [bindings|memories|errors|effects|messages] [args...]");
  info("  bun run debug eval [trace|respond] [args...]");
  info("");
  info("Embeddings:");
  info("  status                        Show embedding model and cache status");
  info("  test <text>                   Test embedding generation timing");
  info("  sim <text-a> <text-b>         Test similarity between two texts");
  info("  coverage <entity>             Show embedding coverage for entity");
  info("  rag <entity> <query>          Test RAG retrieval");
  info("");
  info("State:");
  info("  bindings [--guild ID] [--channel ID]   Show binding graph");
  info("  memories <entity>                      Show memory stats");
  info("  errors [entity] [--limit N]            Show eval errors");
  info("  effects <entity>                       Show active effects");
  info("  messages <channel-id>                  Show message stats");
  info("");
  info("Eval:");
  info("  trace <entity> --channel <id>          Trace fact evaluation");
  info("  respond --channel <id> [--guild ID]    Simulate response decisions");
  info("");
  info("Entity args accept name or numeric ID.");
}

async function main() {
  if (!group) {
    usage();
    process.exit(0);
  }

  if (group === "embeddings") {
    const cmd = subcommand ?? "status";

    if (cmd === "status") {
      const status = getEmbeddingStatus();
      info("Embedding Status", status);
    } else if (cmd === "test") {
      const text = rest[0];
      if (!text) { error("Usage: bun run debug embeddings test <text>"); process.exit(1); }
      const result = await testEmbed(text);
      info("Embed Test", result);
    } else if (cmd === "sim") {
      const a = rest[0];
      const b = rest[1];
      if (!a || !b) { error("Usage: bun run debug embeddings sim <text-a> <text-b>"); process.exit(1); }
      const result = await testSimilarity(a, b);
      info("Similarity Test", result);
    } else if (cmd === "coverage") {
      const entityId = resolveEntityId(rest[0]);
      if (!entityId) { error("Usage: bun run debug embeddings coverage <entity>"); process.exit(1); }
      const result = getEmbeddingCoverage(entityId);
      info("Embedding Coverage", {
        entityId: result.entityId,
        facts: `${result.facts.withEmbedding}/${result.facts.total}`,
        factsMissing: result.facts.missingIds,
        memories: `${result.memories.withEmbedding}/${result.memories.total}`,
        memoriesMissing: result.memories.missingIds,
      });
    } else if (cmd === "rag") {
      const entityId = resolveEntityId(rest[0]);
      const query = rest[1];
      if (!entityId || !query) { error("Usage: bun run debug embeddings rag <entity> <query>"); process.exit(1); }
      const results = await testRagRetrieval(entityId, query);
      info("RAG Results", { query, count: results.length });
      for (const r of results) {
        info(`  [${r.type}:${r.id}] sim=${(r.similarity * 100).toFixed(1)}%`, { content: r.content });
      }
    } else {
      error(`Unknown embeddings subcommand: ${cmd}`);
      process.exit(1);
    }
  } else if (group === "state") {
    const cmd = subcommand ?? "bindings";

    if (cmd === "bindings") {
      const guildId = getArg("--guild");
      const channelId = getArg("--channel");
      const result = getBindingGraph(guildId, channelId);
      info("Binding Graph", { total: result.total });
      for (const b of result.bindings) {
        info(`  ${b.discordType}:${b.discordId} → ${b.entityName ?? "?"} [${b.entityId}]`, {
          scopeGuild: b.scopeGuildId,
          scopeChannel: b.scopeChannelId,
        });
      }
    } else if (cmd === "memories") {
      const entityId = resolveEntityId(rest[0]);
      if (!entityId) { error("Usage: bun run debug state memories <entity>"); process.exit(1); }
      const stats = getMemoryStats(entityId);
      info("Memory Stats", {
        entityId: stats.entityId,
        total: stats.total,
        frecency: stats.frecency,
        scopes: stats.scopeBreakdown,
        embeddings: stats.embeddingCount,
      });
    } else if (cmd === "errors") {
      const entityId = resolveEntityId(rest[0]);
      const limitStr = getArg("--limit");
      const limit = limitStr ? parseInt(limitStr) : 50;
      const errors = getEvalErrors(entityId ?? undefined, limit);
      info("Eval Errors", { count: errors.length });
      for (const e of errors) {
        info(`  [${e.entityName ?? "?"}] ${e.errorMessage}`, {
          condition: e.condition,
          created: e.createdAt,
          notified: e.notifiedAt,
        });
      }
    } else if (cmd === "effects") {
      const entityId = resolveEntityId(rest[0]);
      if (!entityId) { error("Usage: bun run debug state effects <entity>"); process.exit(1); }
      const effects = getActiveEffectsDebug(entityId);
      info("Active Effects", { count: effects.length });
      for (const e of effects) {
        const remainSec = Math.round(e.remainingMs / 1000);
        info(`  [${e.id}] ${e.content}`, {
          source: e.source,
          remaining: `${remainSec}s`,
          expires: e.expiresAt,
        });
      }
    } else if (cmd === "messages") {
      const channelId = rest[0];
      if (!channelId) { error("Usage: bun run debug state messages <channel-id>"); process.exit(1); }
      const stats = getMessageStats(channelId);
      info("Message Stats", {
        channel: stats.channelId,
        total: stats.totalMessages,
        postForget: stats.postForgetCount,
        forgetTime: stats.forgetTime,
      });
      for (const a of stats.authorBreakdown) {
        info(`  ${a.name}: ${a.count}`);
      }
    } else {
      error(`Unknown state subcommand: ${cmd}`);
      process.exit(1);
    }
  } else if (group === "eval") {
    const cmd = subcommand ?? "trace";

    if (cmd === "trace") {
      const entityId = resolveEntityId(rest[0]);
      const channelId = getArg("--channel");
      if (!entityId || !channelId) {
        error("Usage: bun run debug eval trace <entity> --channel <id>");
        process.exit(1);
      }
      const guildId = getArg("--guild");
      const result = traceFacts(entityId, channelId, guildId);
      if (!result) { error("Entity not found"); process.exit(1); }

      info(`Fact Trace: ${result.entityName} [${result.entityId}]`);
      for (const t of result.traces) {
        const status = t.included ? "+" : "-";
        const expr = t.expression ? ` [${t.expression} → ${t.expressionResult}]` : "";
        const err = t.expressionError ? ` ERROR: ${t.expressionError}` : "";
        info(`  ${status} (${t.category}) ${t.raw}${expr}${err}`);
      }
      info("Evaluated Result", {
        shouldRespond: result.evaluated.shouldRespond,
        respondSource: result.evaluated.respondSource,
        factCount: result.evaluated.facts.length,
        memoryScope: result.evaluated.memoryScope,
        modelSpec: result.evaluated.modelSpec,
      });
    } else if (cmd === "respond") {
      const channelId = getArg("--channel");
      if (!channelId) {
        error("Usage: bun run debug eval respond --channel <id> [--guild <id>]");
        process.exit(1);
      }
      const guildId = getArg("--guild");
      const results = simulateResponse(channelId, guildId);
      info("Response Simulation", { count: results.length });
      for (const r of results) {
        const icon = r.shouldRespond ? "yes" : "no";
        info(`  ${r.entityName} [${r.entityId}]: ${icon}`, { reason: r.reason });
      }
    } else {
      error(`Unknown eval subcommand: ${cmd}`);
      process.exit(1);
    }
  } else {
    error(`Unknown group: ${group}`);
    usage();
    process.exit(1);
  }
}

main().catch(err => {
  error("Debug CLI error", err);
  process.exit(1);
});
