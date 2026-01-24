import { getDb } from "./index";
import { VectorDatabase } from "./vector";

export interface Fact {
  id: number;
  entityId: number | null;
  content: string;
  importance: number;
  createdAt: number;
}

let vectorDb: VectorDatabase | null = null;

function getVectorDb(): VectorDatabase {
  if (!vectorDb) {
    vectorDb = new VectorDatabase(getDb());
  }
  return vectorDb;
}

// Create a fact
export function createFact(
  content: string,
  entityId?: number,
  importance = 5
): Fact {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO facts (entity_id, content, importance)
    VALUES (?, ?, ?)
    RETURNING id, entity_id as entityId, content, importance, created_at as createdAt
  `);
  return stmt.get(entityId ?? null, content, importance) as Fact;
}

// Create fact with embedding
export async function createFactWithEmbedding(
  content: string,
  embedding: Float32Array | number[],
  entityId?: number,
  importance = 5
): Promise<Fact> {
  const fact = createFact(content, entityId, importance);

  // Store embedding
  const vdb = getVectorDb();
  vdb.insert("fact_embeddings", fact.id, embedding);

  return fact;
}

// Get fact by ID
export function getFact(id: number): Fact | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, entity_id as entityId, content, importance, created_at as createdAt
    FROM facts WHERE id = ?
  `);
  return stmt.get(id) as Fact | null;
}

// Get facts for an entity
export function getFactsForEntity(
  entityId: number,
  limit = 100
): Fact[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, entity_id as entityId, content, importance, created_at as createdAt
    FROM facts
    WHERE entity_id = ?
    ORDER BY importance DESC, created_at DESC
    LIMIT ?
  `);
  return stmt.all(entityId, limit) as Fact[];
}

// Get most important facts globally
export function getImportantFacts(
  minImportance = 7,
  limit = 50
): Fact[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, entity_id as entityId, content, importance, created_at as createdAt
    FROM facts
    WHERE importance >= ?
    ORDER BY importance DESC, created_at DESC
    LIMIT ?
  `);
  return stmt.all(minImportance, limit) as Fact[];
}

// Search facts by embedding similarity
export function searchFactsByEmbedding(
  embedding: Float32Array | number[],
  limit = 10
): Array<Fact & { distance: number }> {
  const vdb = getVectorDb();
  const results = vdb.search("fact_embeddings", embedding, limit);

  const facts: Array<Fact & { distance: number }> = [];
  for (const result of results) {
    const fact = getFact(result.rowid);
    if (fact) {
      facts.push({ ...fact, distance: result.distance });
    }
  }

  return facts;
}

// Update fact importance
export function updateFactImportance(id: number, importance: number): boolean {
  const db = getDb();
  const stmt = db.prepare("UPDATE facts SET importance = ? WHERE id = ?");
  const result = stmt.run(importance, id);
  return result.changes > 0;
}

// Delete fact (and its embedding)
export function deleteFact(id: number): boolean {
  const db = getDb();

  // Delete embedding first
  const vdb = getVectorDb();
  vdb.delete("fact_embeddings", id);

  // Delete fact
  const stmt = db.prepare("DELETE FROM facts WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

// Get recent facts
export function getRecentFacts(limit = 20): Fact[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, entity_id as entityId, content, importance, created_at as createdAt
    FROM facts
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Fact[];
}

// Batch create facts with embeddings
export async function createFactsWithEmbeddings(
  facts: Array<{
    content: string;
    embedding: Float32Array | number[];
    entityId?: number;
    importance?: number;
  }>
): Promise<Fact[]> {
  const db = getDb();
  const vdb = getVectorDb();

  const createdFacts: Fact[] = [];

  const insertFact = db.prepare(`
    INSERT INTO facts (entity_id, content, importance)
    VALUES (?, ?, ?)
    RETURNING id, entity_id as entityId, content, importance, created_at as createdAt
  `);

  const transaction = db.transaction(() => {
    for (const f of facts) {
      const fact = insertFact.get(
        f.entityId ?? null,
        f.content,
        f.importance ?? 5
      ) as Fact;
      createdFacts.push(fact);
    }
  });

  transaction();

  // Insert embeddings
  const embeddings = facts.map((f, i) => ({
    rowId: createdFacts[i].id,
    embedding: f.embedding,
  }));
  vdb.insertBatch("fact_embeddings", embeddings);

  return createdFacts;
}
