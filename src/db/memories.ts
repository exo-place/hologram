/**
 * Entity Memories - LLM-curated long-term memory with frecency-based retrieval.
 *
 * Memories are saved by LLMs for important events worth recalling.
 * Retrieved via frecency pre-filter + vector similarity search.
 */

import { getDb } from "./index";
import { embed, similarityMatrix } from "../ai/embeddings";

// =============================================================================
// Types
// =============================================================================

export interface Memory {
  id: number;
  entity_id: number;
  content: string;
  source_message_id: string | null;
  source_channel_id: string | null;
  source_guild_id: string | null;
  frecency: number;
  created_at: string;
  updated_at: string;
}

export type MemoryScope = "none" | "channel" | "guild" | "global";

/** Minimum cosine similarity for a memory to be included in retrieval results */
const MIN_SIMILARITY_THRESHOLD = 0.2;

// =============================================================================
// Retrieval Caches
// =============================================================================

/**
 * Two-level cache for memory retrieval:
 *
 * Level 1 — Memory embedding cache (per entity×scope):
 *   Caches loaded Memory objects + Float32Array embeddings from DB.
 *   Avoids N individual DB queries per retrieval.
 *   Invalidated on any memory mutation for that entity.
 *
 * Level 2 — Similarity result cache (per entity×scope×channel):
 *   Caches per-memory max-similarity scores and which messages contributed.
 *   On new message: compute 1×N dot products instead of full M×N matrix.
 *   Invalidated on memory change or message removal (context shrink, /forget).
 */

/** Max number of entities to cache embeddings for */
export let memoryCacheMaxEntities = 50;

/** Set the max number of entities to cache embeddings for */
export function setMemoryCacheMaxEntities(max: number): void {
  memoryCacheMaxEntities = max;
}

// --- Level 1: Memory embedding cache ---

interface EmbeddingCacheEntry {
  memories: Memory[];
  embeddings: Float32Array[];
  memoryIdSet: Set<number>; // for fast membership checks
}

const embeddingCache = new Map<string, EmbeddingCacheEntry>();

function embeddingCacheKey(entityId: number, scope: MemoryScope, channelId?: string, guildId?: string): string {
  if (scope === "global") return `${entityId}:global`;
  if (scope === "guild") return `${entityId}:guild:${guildId}`;
  if (scope === "channel") return `${entityId}:channel:${channelId}`;
  return `${entityId}:none`;
}

function getOrLoadEmbeddings(
  entityId: number, scope: MemoryScope, channelId?: string, guildId?: string,
): EmbeddingCacheEntry | null {
  const key = embeddingCacheKey(entityId, scope, channelId, guildId);
  const cached = embeddingCache.get(key);
  if (cached) return cached;

  const candidates = getMemoriesForScope(entityId, scope, channelId, guildId);
  if (candidates.length === 0) return null;

  const memories: Memory[] = [];
  const embeddings: Float32Array[] = [];
  const memoryIdSet = new Set<number>();
  for (const memory of candidates) {
    const embedding = getMemoryEmbedding(memory.id);
    if (embedding) {
      memories.push(memory);
      embeddings.push(embedding);
      memoryIdSet.add(memory.id);
    }
  }
  if (memories.length === 0) return null;

  const entry: EmbeddingCacheEntry = { memories, embeddings, memoryIdSet };

  // Evict oldest if at capacity
  if (embeddingCache.size >= memoryCacheMaxEntities) {
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey) embeddingCache.delete(firstKey);
  }
  embeddingCache.set(key, entry);
  return entry;
}

// --- Level 2: Similarity result cache ---

interface SimilarityCacheEntry {
  /** Per-message similarity vectors: message content → similarity per memory (parallel to embedding cache) */
  messageScores: Map<string, Float32Array>;
  /** Pre-computed max across all messages per memory */
  maxSims: Float32Array;
  /** Memory ID set snapshot — if memories change, invalidate */
  memoryIdSnapshot: Set<number>;
}

const similarityCache = new Map<string, SimilarityCacheEntry>();

function similarityCacheKey(entityId: number, scope: MemoryScope, channelId?: string, guildId?: string): string {
  return embeddingCacheKey(entityId, scope, channelId, guildId);
}

/** Recompute maxSims from individual message score vectors */
function recomputeMaxSims(messageScores: Map<string, Float32Array>, N: number): Float32Array {
  const maxSims = new Float32Array(N).fill(-Infinity);
  for (const scores of messageScores.values()) {
    for (let j = 0; j < N; j++) {
      if (scores[j] > maxSims[j]) maxSims[j] = scores[j];
    }
  }
  return maxSims;
}

// --- Invalidation ---

/** Invalidate all caches for an entity (called on memory mutations) */
function invalidateEntityCaches(entityId: number): void {
  for (const key of embeddingCache.keys()) {
    if (key.startsWith(`${entityId}:`)) embeddingCache.delete(key);
  }
  for (const key of similarityCache.keys()) {
    if (key.startsWith(`${entityId}:`)) similarityCache.delete(key);
  }
}

/** Clear all retrieval caches (e.g. for testing or bulk operations) */
export function clearRetrievalCaches(): void {
  embeddingCache.clear();
  similarityCache.clear();
}

/** Get cache statistics for debugging */
export function getRetrievalCacheStats(): { embeddingEntries: number; similarityEntries: number; maxEntities: number } {
  return {
    embeddingEntries: embeddingCache.size,
    similarityEntries: similarityCache.size,
    maxEntities: memoryCacheMaxEntities,
  };
}

/** Detailed similarity cache state for /debug rag */
export interface SimilarityCacheDebugInfo {
  cacheKey: string;
  memoriesCount: number;
  messagesCount: number;
  entries: Array<{
    memoryId: number;
    memoryContent: string;
    maxSimilarity: number;
    messageScores: Array<{ message: string; similarity: number }>;
  }>;
}

/** Get detailed similarity cache for an entity (for debugging) */
export function getSimilarityCacheDebug(
  entityId: number, scope: MemoryScope, channelId?: string, guildId?: string,
): SimilarityCacheDebugInfo | null {
  const simKey = similarityCacheKey(entityId, scope, channelId, guildId);
  const simCached = similarityCache.get(simKey);
  const embKey = embeddingCacheKey(entityId, scope, channelId, guildId);
  const embCached = embeddingCache.get(embKey);

  if (!simCached || !embCached) return null;

  const entries: SimilarityCacheDebugInfo["entries"] = [];
  for (let j = 0; j < embCached.memories.length; j++) {
    const memory = embCached.memories[j];
    const messageScores: Array<{ message: string; similarity: number }> = [];

    for (const [msg, scores] of simCached.messageScores) {
      messageScores.push({ message: msg, similarity: scores[j] });
    }
    messageScores.sort((a, b) => b.similarity - a.similarity);

    entries.push({
      memoryId: memory.id,
      memoryContent: memory.content,
      maxSimilarity: simCached.maxSims[j],
      messageScores,
    });
  }

  entries.sort((a, b) => b.maxSimilarity - a.maxSimilarity);

  return {
    cacheKey: simKey,
    memoriesCount: embCached.memories.length,
    messagesCount: simCached.messageScores.size,
    entries,
  };
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Add a memory for an entity.
 * Automatically generates and stores the embedding.
 */
export async function addMemory(
  entityId: number,
  content: string,
  sourceMessageId?: string,
  sourceChannelId?: string,
  sourceGuildId?: string
): Promise<Memory> {
  const db = getDb();

  const memory = db.prepare(`
    INSERT INTO entity_memories (entity_id, content, source_message_id, source_channel_id, source_guild_id)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    entityId,
    content,
    sourceMessageId ?? null,
    sourceChannelId ?? null,
    sourceGuildId ?? null
  ) as Memory;

  // Generate and store embedding
  const embedding = await embed(content);
  await storeMemoryEmbedding(memory.id, embedding);
  invalidateEntityCaches(entityId);

  return memory;
}

/**
 * Get a memory by ID.
 */
export function getMemory(id: number): Memory | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM entity_memories WHERE id = ?`).get(id) as Memory | null;
}

/**
 * Get all memories for an entity.
 */
export function getMemoriesForEntity(entityId: number): Memory[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM entity_memories
    WHERE entity_id = ?
    ORDER BY frecency DESC, created_at DESC
  `).all(entityId) as Memory[];
}

/**
 * Update a memory by ID.
 * Regenerates the embedding.
 */
export async function updateMemory(id: number, content: string): Promise<Memory | null> {
  const db = getDb();
  const memory = db.prepare(`
    UPDATE entity_memories
    SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    RETURNING *
  `).get(content, id) as Memory | null;

  if (memory) {
    const embedding = await embed(content);
    await storeMemoryEmbedding(memory.id, embedding);
    invalidateEntityCaches(memory.entity_id);
  }

  return memory;
}

/**
 * Update a memory by content match (like facts).
 * Regenerates the embedding.
 */
export async function updateMemoryByContent(
  entityId: number,
  oldContent: string,
  newContent: string
): Promise<Memory | null> {
  const db = getDb();
  const memory = db.prepare(`
    UPDATE entity_memories
    SET content = ?, updated_at = CURRENT_TIMESTAMP
    WHERE entity_id = ? AND content = ?
    RETURNING *
  `).get(newContent, entityId, oldContent) as Memory | null;

  if (memory) {
    const embedding = await embed(newContent);
    await storeMemoryEmbedding(memory.id, embedding);
    invalidateEntityCaches(entityId);
  }

  return memory;
}

/**
 * Remove a memory by ID.
 */
export function removeMemory(id: number): boolean {
  const db = getDb();
  // Look up entity ID for cache invalidation
  const mem = db.prepare(`SELECT entity_id FROM entity_memories WHERE id = ?`).get(id) as { entity_id: number } | null;
  // Remove embedding first
  db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(id);
  const result = db.prepare(`DELETE FROM entity_memories WHERE id = ?`).run(id);
  if (result.changes > 0 && mem) invalidateEntityCaches(mem.entity_id);
  return result.changes > 0;
}

/**
 * Remove a memory by content match.
 */
export function removeMemoryByContent(entityId: number, content: string): boolean {
  const db = getDb();
  // Get the memory ID first for embedding cleanup
  const memory = db.prepare(`
    SELECT id FROM entity_memories WHERE entity_id = ? AND content = ?
  `).get(entityId, content) as { id: number } | null;

  if (!memory) return false;

  db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(memory.id);
  const result = db.prepare(`DELETE FROM entity_memories WHERE id = ?`).run(memory.id);
  if (result.changes > 0) invalidateEntityCaches(entityId);
  return result.changes > 0;
}

/**
 * Set all memories for an entity (clear and replace).
 * Used by /edit command.
 */
export async function setMemories(entityId: number, contents: string[]): Promise<Memory[]> {
  const db = getDb();

  // Get existing memory IDs for embedding cleanup
  const existingIds = db.prepare(`
    SELECT id FROM entity_memories WHERE entity_id = ?
  `).all(entityId) as { id: number }[];

  // Clear existing embeddings and memories
  for (const { id } of existingIds) {
    db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(id);
  }
  db.prepare(`DELETE FROM entity_memories WHERE entity_id = ?`).run(entityId);

  // Add new memories
  const memories: Memory[] = [];
  for (const content of contents) {
    const memory = db.prepare(`
      INSERT INTO entity_memories (entity_id, content)
      VALUES (?, ?)
      RETURNING *
    `).get(entityId, content) as Memory;

    const embedding = await embed(content);
    await storeMemoryEmbedding(memory.id, embedding);
    memories.push(memory);
  }

  invalidateEntityCaches(entityId);
  return memories;
}

// =============================================================================
// Scope-Based Retrieval
// =============================================================================

/**
 * Get memories for an entity filtered by scope.
 */
export function getMemoriesForScope(
  entityId: number,
  scope: MemoryScope,
  channelId?: string,
  guildId?: string
): Memory[] {
  if (scope === "none") return [];

  const db = getDb();

  if (scope === "global") {
    return db.prepare(`
      SELECT * FROM entity_memories
      WHERE entity_id = ?
      ORDER BY frecency DESC
    `).all(entityId) as Memory[];
  }

  if (scope === "guild" && guildId) {
    return db.prepare(`
      SELECT * FROM entity_memories
      WHERE entity_id = ? AND source_guild_id = ?
      ORDER BY frecency DESC
    `).all(entityId, guildId) as Memory[];
  }

  if (scope === "channel" && channelId) {
    return db.prepare(`
      SELECT * FROM entity_memories
      WHERE entity_id = ? AND source_channel_id = ?
      ORDER BY frecency DESC
    `).all(entityId, channelId) as Memory[];
  }

  // Fallback: return empty if scope params missing
  return [];
}

// =============================================================================
// Frecency Operations
// =============================================================================

/**
 * Boost frecency for a memory (called when retrieved/accessed).
 * Uses formula: frecency = frecency * decay + boost
 */
export function boostMemoryFrecency(memoryId: number, boost: number = 0.1): void {
  const db = getDb();
  db.prepare(`
    UPDATE entity_memories
    SET frecency = frecency * 0.95 + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(boost, memoryId);
}

/**
 * Decay all frecency scores (run periodically).
 */
export function decayAllFrecency(decayFactor: number = 0.99): void {
  const db = getDb();
  db.prepare(`
    UPDATE entity_memories
    SET frecency = frecency * ?
  `).run(decayFactor);
}

/**
 * Cleanup memories with very low frecency.
 */
export function cleanupLowFrecencyMemories(threshold: number = 0.01): number {
  const db = getDb();

  // Get IDs of memories to delete
  const toDelete = db.prepare(`
    SELECT id FROM entity_memories WHERE frecency < ?
  `).all(threshold) as { id: number }[];

  // Delete embeddings and memories
  for (const { id } of toDelete) {
    db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(id);
  }

  const result = db.prepare(`DELETE FROM entity_memories WHERE frecency < ?`).run(threshold);
  if (result.changes > 0) clearRetrievalCaches();
  return result.changes;
}

// =============================================================================
// Embedding Operations
// =============================================================================

/**
 * Store embedding for a memory.
 */
export async function storeMemoryEmbedding(memoryId: number, embedding: Float32Array): Promise<void> {
  const db = getDb();

  // Delete existing embedding if any
  db.prepare(`DELETE FROM memory_embeddings WHERE memory_id = ?`).run(memoryId);

  // Insert new embedding
  // vec0 expects the embedding as a blob
  db.prepare(`
    INSERT INTO memory_embeddings (memory_id, embedding)
    VALUES (?, ?)
  `).run(memoryId, embedding);
}

/**
 * Get embedding for a memory.
 */
export function getMemoryEmbedding(memoryId: number): Float32Array | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT embedding FROM memory_embeddings WHERE memory_id = ?
  `).get(memoryId) as { embedding: Uint8Array | Float32Array } | null;

  if (!row?.embedding) return null;
  // sqlite-vec returns Uint8Array blobs — convert to Float32Array
  if (row.embedding instanceof Float32Array) return row.embedding;
  return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Search memories by semantic similarity.
 * Accepts multiple query texts (e.g. individual messages) and uses the max
 * similarity across all queries for each memory — so a single relevant message
 * is enough to surface a memory even if the rest are unrelated.
 *
 * Uses two-level caching:
 *  1. Memory embeddings cached per entity (avoids N DB queries)
 *  2. Similarity results cached incrementally (avoids full M×N matrix multiply
 *     when only new messages are added — computes 1×N per new message instead)
 */
export async function searchMemoriesBySimilarity(
  entityId: number,
  queryTexts: string[],
  scope: MemoryScope,
  channelId?: string,
  guildId?: string,
): Promise<Array<{ memory: Memory; similarity: number }>> {
  if (scope === "none" || queryTexts.length === 0) return [];

  // Level 1: Load memory embeddings (cached per entity×scope)
  const embEntry = getOrLoadEmbeddings(entityId, scope, channelId, guildId);
  if (!embEntry) return [];

  const { memories: memoriesWithEmb, embeddings: memoryEmbeddings, memoryIdSet } = embEntry;
  const N = memoriesWithEmb.length;

  // Level 2: Check similarity cache for incremental update
  const simKey = similarityCacheKey(entityId, scope, channelId, guildId);
  const simCached = similarityCache.get(simKey);
  const querySet = new Set(queryTexts);

  let maxSims: Float32Array;

  if (simCached && setsEqual(simCached.memoryIdSnapshot, memoryIdSet)) {
    // Memory set unchanged — diff messages for incremental update
    const newMessages: string[] = [];
    let dirty = false;

    // Remove scores for messages no longer in context (edited/deleted/aged out)
    for (const msg of simCached.messageScores.keys()) {
      if (!querySet.has(msg)) {
        simCached.messageScores.delete(msg);
        dirty = true;
      }
    }

    // Find messages not yet scored
    for (const msg of queryTexts) {
      if (!simCached.messageScores.has(msg)) newMessages.push(msg);
    }

    if (newMessages.length > 0) {
      // Batch compute new messages × all memories in one matrix multiply
      const newEmbeddings = await Promise.all(newMessages.map(t => embed(t)));
      const newMatrix = similarityMatrix(newEmbeddings, memoryEmbeddings);
      for (let i = 0; i < newMessages.length; i++) {
        simCached.messageScores.set(newMessages[i], newMatrix.slice(i * N, (i + 1) * N));
      }
      dirty = true;
    }

    if (dirty || newMessages.length > 0) {
      maxSims = recomputeMaxSims(simCached.messageScores, N);
      simCached.maxSims = maxSims;
    } else {
      maxSims = simCached.maxSims;
    }
  } else {
    // No cache or memories changed — batch compute full M×N matrix
    const queryEmbeddings = await Promise.all(queryTexts.map(t => embed(t)));
    const fullMatrix = similarityMatrix(queryEmbeddings, memoryEmbeddings);

    // Extract per-message score rows from the flat M×N result
    const messageScores = new Map<string, Float32Array>();
    for (let i = 0; i < queryTexts.length; i++) {
      messageScores.set(queryTexts[i], fullMatrix.slice(i * N, (i + 1) * N));
    }
    maxSims = recomputeMaxSims(messageScores, N);
    similarityCache.set(simKey, { messageScores, maxSims, memoryIdSnapshot: memoryIdSet });
  }

  // Filter by threshold and sort
  const scored: Array<{ memory: Memory; similarity: number }> = [];
  for (let j = 0; j < N; j++) {
    if (maxSims[j] >= MIN_SIMILARITY_THRESHOLD) {
      scored.push({ memory: memoriesWithEmb[j], similarity: maxSims[j] });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored;
}

/** Check if two sets have identical contents */
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * Retrieve relevant memories and boost their frecency.
 * Main entry point for memory retrieval in the message pipeline.
 */
export async function retrieveRelevantMemories(
  entityId: number,
  messages: string[],
  scope: MemoryScope,
  channelId?: string,
  guildId?: string,
): Promise<Memory[]> {
  const results = await searchMemoriesBySimilarity(
    entityId,
    messages,
    scope,
    channelId,
    guildId,
  );

  // Boost frecency for retrieved memories
  for (const { memory } of results) {
    boostMemoryFrecency(memory.id);
  }

  return results.map(r => r.memory);
}

// =============================================================================
// Context Formatting
// =============================================================================

/**
 * Format memories for inclusion in LLM context.
 */
export function formatMemoriesForContext(entityName: string, entityId: number, memories: Memory[]): string {
  if (memories.length === 0) return "";

  const memoryLines = memories.map(m => m.content).join("\n");
  return `<memories entity="${entityName}" id="${entityId}">\n${memoryLines}\n</memories>`;
}
