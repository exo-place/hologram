import { getDb } from "../db";
import { getEntity } from "../db/entities";
import {
  createRelationship,
  getRelationshipsBetween,
  getRelationshipsFrom,
  getRelationshipsTo,
  type Relationship,
} from "../db/relationships";
import type { RelationshipConfig } from "../config";

// Extended relationship data stored in the JSON `data` field
export interface RelationshipData {
  affinity?: number;       // -100 to +100
  trust?: number;          // 0 to 100
  familiarity?: number;    // 0 to 100
  status?: "active" | "estranged" | "secret" | "former";
  flags?: string[];        // ["romantic", "professional", "family"]
  notes?: string;
  history?: RelationshipHistoryEntry[];
}

export interface RelationshipHistoryEntry {
  event: string;
  affinityChange?: number;
  timestamp: number; // unixepoch
}

// Re-export for convenience
export type { Relationship } from "../db/relationships";

/** Get the primary relationship between two entities (first found) */
export function getRelationship(
  entityId1: number,
  entityId2: number,
  type?: string
): (Relationship & { relData: RelationshipData }) | null {
  const rels = getRelationshipsBetween(entityId1, entityId2);
  const filtered = type ? rels.filter((r) => r.type === type) : rels;
  if (filtered.length === 0) return null;

  const rel = filtered[0];
  return {
    ...rel,
    relData: parseRelData(rel.data),
  };
}

/** Get all enhanced relationships for an entity */
export function getEnhancedRelationships(
  entityId: number,
  direction: "from" | "to" | "both" = "both"
): Array<Relationship & { relData: RelationshipData }> {
  const rels: Relationship[] = [];

  if (direction === "from" || direction === "both") {
    rels.push(...getRelationshipsFrom(entityId));
  }
  if (direction === "to" || direction === "both") {
    rels.push(...getRelationshipsTo(entityId));
  }

  // Deduplicate by ID
  const seen = new Set<number>();
  const unique: Relationship[] = [];
  for (const r of rels) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      unique.push(r);
    }
  }

  return unique.map((rel) => ({
    ...rel,
    relData: parseRelData(rel.data),
  }));
}

/** Set or create a relationship with enhanced data */
export function setRelationshipData(
  sourceId: number,
  targetId: number,
  type: string,
  relData: Partial<RelationshipData>
): Relationship & { relData: RelationshipData } {
  const existing = getRelationshipsBetween(sourceId, targetId)
    .find((r) => r.type === type && r.sourceId === sourceId && r.targetId === targetId);

  if (existing) {
    // Merge with existing data
    const currentData = parseRelData(existing.data);
    const merged: RelationshipData = {
      ...currentData,
      ...relData,
      flags: relData.flags ?? currentData.flags,
      history: relData.history ?? currentData.history,
    };

    const db = getDb();
    db.prepare("UPDATE relationships SET data = ? WHERE id = ?")
      .run(JSON.stringify(merged), existing.id);

    return {
      ...existing,
      data: merged as Record<string, unknown>,
      relData: merged,
    };
  }

  // Create new
  const data: RelationshipData = {
    affinity: 0,
    trust: 50,
    familiarity: 0,
    status: "active",
    flags: [],
    history: [],
    ...relData,
  };

  const rel = createRelationship(sourceId, targetId, type, data as Record<string, unknown>);
  return {
    ...rel,
    relData: data,
  };
}

/** Modify affinity between two entities, clamped to configured range */
export function modifyAffinity(
  entityId1: number,
  entityId2: number,
  amount: number,
  eventDescription?: string,
  config?: RelationshipConfig
): { relationship: Relationship & { relData: RelationshipData }; newAffinity: number } | null {
  const rels = getRelationshipsBetween(entityId1, entityId2);
  if (rels.length === 0) return null;

  const rel = rels[0];
  const relData = parseRelData(rel.data);
  const range = config?.affinityRange ?? [-100, 100];

  const oldAffinity = relData.affinity ?? 0;
  const newAffinity = Math.max(range[0], Math.min(range[1], oldAffinity + amount));
  relData.affinity = newAffinity;

  // Add history entry
  if (eventDescription) {
    if (!relData.history) relData.history = [];
    relData.history.push({
      event: eventDescription,
      affinityChange: amount,
      timestamp: Math.floor(Date.now() / 1000),
    });

    // Keep history manageable (last 50 entries)
    if (relData.history.length > 50) {
      relData.history = relData.history.slice(-50);
    }
  }

  const db = getDb();
  db.prepare("UPDATE relationships SET data = ? WHERE id = ?")
    .run(JSON.stringify(relData), rel.id);

  return {
    relationship: { ...rel, data: relData as Record<string, unknown>, relData },
    newAffinity,
  };
}

/** Modify trust between two entities */
export function modifyTrust(
  entityId1: number,
  entityId2: number,
  amount: number,
  eventDescription?: string
): { relationship: Relationship & { relData: RelationshipData }; newTrust: number } | null {
  const rels = getRelationshipsBetween(entityId1, entityId2);
  if (rels.length === 0) return null;

  const rel = rels[0];
  const relData = parseRelData(rel.data);

  const oldTrust = relData.trust ?? 50;
  const newTrust = Math.max(0, Math.min(100, oldTrust + amount));
  relData.trust = newTrust;

  if (eventDescription) {
    if (!relData.history) relData.history = [];
    relData.history.push({
      event: eventDescription,
      timestamp: Math.floor(Date.now() / 1000),
    });
    if (relData.history.length > 50) {
      relData.history = relData.history.slice(-50);
    }
  }

  const db = getDb();
  db.prepare("UPDATE relationships SET data = ? WHERE id = ?")
    .run(JSON.stringify(relData), rel.id);

  return {
    relationship: { ...rel, data: relData as Record<string, unknown>, relData },
    newTrust,
  };
}

/** Add a history entry to a relationship */
export function addRelationshipHistory(
  entityId1: number,
  entityId2: number,
  event: string,
  affinityChange?: number
): boolean {
  const rels = getRelationshipsBetween(entityId1, entityId2);
  if (rels.length === 0) return false;

  const rel = rels[0];
  const relData = parseRelData(rel.data);

  if (!relData.history) relData.history = [];
  relData.history.push({
    event,
    affinityChange,
    timestamp: Math.floor(Date.now() / 1000),
  });

  if (relData.history.length > 50) {
    relData.history = relData.history.slice(-50);
  }

  const db = getDb();
  db.prepare("UPDATE relationships SET data = ? WHERE id = ?")
    .run(JSON.stringify(relData), rel.id);

  return true;
}

/** Get the affinity label for a given value based on config thresholds */
export function getAffinityLabel(
  value: number,
  config?: RelationshipConfig
): string {
  const labels: Record<string, string> = config?.affinityLabels
    ? Object.fromEntries(Object.entries(config.affinityLabels))
    : {
        "-100": "Hatred",
        "-50": "Dislike",
        "0": "Neutral",
        "50": "Friendly",
        "100": "Love",
      };

  // Find the closest label threshold <= value
  const thresholds = Object.keys(labels)
    .map(Number)
    .sort((a, b) => a - b);

  let label = "Unknown";
  for (const t of thresholds) {
    if (value >= t) {
      label = labels[t.toString()];
    }
  }

  return label;
}

/** Format a relationship for Discord display */
export function formatRelationshipForDisplay(
  rel: Relationship & { relData: RelationshipData },
  config?: RelationshipConfig
): string {
  const source = getEntity(rel.sourceId);
  const target = getEntity(rel.targetId);
  const srcName = source?.name ?? `Entity ${rel.sourceId}`;
  const tgtName = target?.name ?? `Entity ${rel.targetId}`;

  const lines: string[] = [];
  lines.push(`**${srcName}** → **${tgtName}**: ${rel.type}`);

  if (rel.relData.status && rel.relData.status !== "active") {
    lines.push(`Status: ${rel.relData.status}`);
  }

  if (rel.relData.affinity !== undefined) {
    const label = getAffinityLabel(rel.relData.affinity, config);
    lines.push(`Affinity: **${rel.relData.affinity}** (${label})`);
  }

  if (rel.relData.trust !== undefined) {
    lines.push(`Trust: **${rel.relData.trust}**/100`);
  }

  if (rel.relData.familiarity !== undefined) {
    lines.push(`Familiarity: **${rel.relData.familiarity}**/100`);
  }

  if (rel.relData.flags && rel.relData.flags.length > 0) {
    lines.push(`Tags: ${rel.relData.flags.join(", ")}`);
  }

  if (rel.relData.notes) {
    lines.push(`Notes: ${rel.relData.notes}`);
  }

  return lines.join("\n");
}

/** Format relationships for AI context consumption */
export function formatRelationshipsForCharacterContext(
  characterId: number,
  presentCharacterIds: number[],
  config?: RelationshipConfig
): string | null {
  const enhanced = getEnhancedRelationships(characterId);
  if (enhanced.length === 0) return null;

  // Prioritize relationships with present characters
  const present = enhanced.filter(
    (r) =>
      presentCharacterIds.includes(r.sourceId === characterId ? r.targetId : r.sourceId)
  );
  const absent = enhanced.filter(
    (r) =>
      !presentCharacterIds.includes(r.sourceId === characterId ? r.targetId : r.sourceId)
  );

  const lines: string[] = ["## Relationships"];

  const formatEntry = (rel: Relationship & { relData: RelationshipData }) => {
    const otherId = rel.sourceId === characterId ? rel.targetId : rel.sourceId;
    const other = getEntity(otherId);
    const name = other?.name ?? "Unknown";

    let line = `- **${name}**: ${rel.type}`;

    if (rel.relData.affinity !== undefined && config?.useAffinity) {
      const label = getAffinityLabel(rel.relData.affinity, config);
      line += ` (${label})`;
    }

    if (rel.relData.status && rel.relData.status !== "active") {
      line += ` [${rel.relData.status}]`;
    }

    // Include last few history events for context
    if (rel.relData.history && rel.relData.history.length > 0) {
      const recent = rel.relData.history.slice(-2);
      for (const h of recent) {
        line += `\n  - ${h.event}`;
      }
    }

    return line;
  };

  if (present.length > 0) {
    lines.push("\n### Present Characters");
    for (const rel of present) {
      lines.push(formatEntry(rel));
    }
  }

  if (absent.length > 0) {
    lines.push("\n### Other Known Characters");
    for (const rel of absent.slice(0, 10)) {
      lines.push(formatEntry(rel));
    }
  }

  return lines.join("\n");
}

function parseRelData(data: Record<string, unknown> | null): RelationshipData {
  if (!data) return {};
  return data as unknown as RelationshipData;
}
