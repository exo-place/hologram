import { embed } from "../ai/embeddings";
import {
  searchFactsByEmbedding,
  getImportantFacts,
  createFactWithEmbedding,
  type Fact,
} from "../db/facts";
import { getEntity } from "../db/entities";

export interface RetrievedFact {
  fact: Fact;
  relevanceScore: number;
  entityName?: string;
}

// Retrieve relevant facts using semantic search
export async function retrieveRelevantFacts(
  query: string,
  limit = 10
): Promise<RetrievedFact[]> {
  // Generate query embedding
  const queryEmbedding = await embed(query);

  // Search by embedding similarity
  const results = searchFactsByEmbedding(queryEmbedding, limit);

  // Convert distance to relevance score (lower distance = higher relevance)
  // sqlite-vec uses L2 distance by default, so we convert to similarity
  return results.map((r) => {
    const entity = r.entityId ? getEntity(r.entityId) : null;
    return {
      fact: r,
      relevanceScore: 1 / (1 + r.distance), // Convert distance to 0-1 score
      entityName: entity?.name,
    };
  });
}

// Retrieve facts with hybrid approach (semantic + importance)
export async function retrieveFactsHybrid(
  query: string,
  options: {
    semanticLimit?: number;
    importanceThreshold?: number;
    importanceLimit?: number;
    maxTotal?: number;
  } = {}
): Promise<RetrievedFact[]> {
  const {
    semanticLimit = 10,
    importanceThreshold = 7,
    importanceLimit = 10,
    maxTotal = 15,
  } = options;

  // Get semantically relevant facts
  const semanticFacts = await retrieveRelevantFacts(query, semanticLimit);

  // Get important facts (always relevant context)
  const importantFacts = getImportantFacts(importanceThreshold, importanceLimit);

  // Merge and deduplicate
  const seenIds = new Set<number>();
  const merged: RetrievedFact[] = [];

  // Add semantic results first (higher priority for relevance)
  for (const rf of semanticFacts) {
    if (!seenIds.has(rf.fact.id)) {
      seenIds.add(rf.fact.id);
      merged.push(rf);
    }
  }

  // Add important facts that weren't already included
  for (const fact of importantFacts) {
    if (!seenIds.has(fact.id)) {
      seenIds.add(fact.id);
      const entity = fact.entityId ? getEntity(fact.entityId) : null;
      merged.push({
        fact,
        relevanceScore: fact.importance / 10, // Normalize importance to 0-1
        entityName: entity?.name,
      });
    }
  }

  // Sort by combined score and limit
  merged.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return merged.slice(0, maxTotal);
}

// Store a new memory/fact with automatic embedding
export async function storeFact(
  content: string,
  entityId?: number,
  importance = 5
): Promise<Fact> {
  const embedding = await embed(content);
  return createFactWithEmbedding(content, embedding, entityId, importance);
}

// Format retrieved facts for context
export function formatFactsForContext(facts: RetrievedFact[]): string {
  if (facts.length === 0) return "";

  const lines = ["## Relevant Memories"];

  for (const rf of facts) {
    let line = `- ${rf.fact.content}`;
    if (rf.entityName) {
      line = `- [${rf.entityName}] ${rf.fact.content}`;
    }
    if (rf.fact.importance >= 8) {
      line += " (important)";
    }
    lines.push(line);
  }

  return lines.join("\n");
}
