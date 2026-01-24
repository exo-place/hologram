import { getDb } from "../db";
import { getEntity, type Entity } from "../db/entities";
import {
  getRelationshipsFrom,
  getRelationshipsTo,
  type Relationship,
} from "../db/relationships";

export interface GraphNode {
  entity: Entity;
  relationships: {
    outgoing: Array<{ relationship: Relationship; target: Entity }>;
    incoming: Array<{ relationship: Relationship; source: Entity }>;
  };
}

// Get an entity with all its direct relationships
export function getEntityWithRelationships(entityId: number): GraphNode | null {
  const entity = getEntity(entityId);
  if (!entity) return null;

  const outgoingRels = getRelationshipsFrom(entityId);
  const incomingRels = getRelationshipsTo(entityId);

  const outgoing: Array<{ relationship: Relationship; target: Entity }> = [];
  for (const rel of outgoingRels) {
    const target = getEntity(rel.targetId);
    if (target) {
      outgoing.push({ relationship: rel, target });
    }
  }

  const incoming: Array<{ relationship: Relationship; source: Entity }> = [];
  for (const rel of incomingRels) {
    const source = getEntity(rel.sourceId);
    if (source) {
      incoming.push({ relationship: rel, source });
    }
  }

  return {
    entity,
    relationships: { outgoing, incoming },
  };
}

// Find all entities connected within N hops
export function getConnectedEntities(
  entityId: number,
  maxHops = 2
): Map<number, { entity: Entity; distance: number }> {
  const visited = new Map<number, { entity: Entity; distance: number }>();
  const queue: Array<{ id: number; distance: number }> = [
    { id: entityId, distance: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current.id)) continue;
    if (current.distance > maxHops) continue;

    const entity = getEntity(current.id);
    if (!entity) continue;

    visited.set(current.id, { entity, distance: current.distance });

    if (current.distance < maxHops) {
      // Add connected entities to queue
      const outgoing = getRelationshipsFrom(current.id);
      const incoming = getRelationshipsTo(current.id);

      for (const rel of outgoing) {
        if (!visited.has(rel.targetId)) {
          queue.push({ id: rel.targetId, distance: current.distance + 1 });
        }
      }

      for (const rel of incoming) {
        if (!visited.has(rel.sourceId)) {
          queue.push({ id: rel.sourceId, distance: current.distance + 1 });
        }
      }
    }
  }

  return visited;
}

// Find path between two entities (BFS)
export function findPath(
  fromId: number,
  toId: number,
  maxHops = 5
): Array<{ entity: Entity; relationship?: Relationship }> | null {
  if (fromId === toId) {
    const entity = getEntity(fromId);
    return entity ? [{ entity }] : null;
  }

  const visited = new Set<number>();
  const queue: Array<{
    id: number;
    path: Array<{ entity: Entity; relationship?: Relationship }>;
  }> = [];

  const startEntity = getEntity(fromId);
  if (!startEntity) return null;

  queue.push({ id: fromId, path: [{ entity: startEntity }] });
  visited.add(fromId);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.path.length > maxHops) continue;

    const outgoing = getRelationshipsFrom(current.id);
    const incoming = getRelationshipsTo(current.id);

    const neighbors = [
      ...outgoing.map((r) => ({ rel: r, neighborId: r.targetId })),
      ...incoming.map((r) => ({ rel: r, neighborId: r.sourceId })),
    ];

    for (const { rel, neighborId } of neighbors) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);

      const neighborEntity = getEntity(neighborId);
      if (!neighborEntity) continue;

      const newPath = [
        ...current.path,
        { entity: neighborEntity, relationship: rel },
      ];

      if (neighborId === toId) {
        return newPath;
      }

      queue.push({ id: neighborId, path: newPath });
    }
  }

  return null;
}

// Get entities by relationship type
export function getEntitiesByRelationship(
  entityId: number,
  relationshipType: string,
  direction: "outgoing" | "incoming" | "both" = "both"
): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<number>();

  if (direction === "outgoing" || direction === "both") {
    const outgoing = getRelationshipsFrom(entityId, relationshipType);
    for (const rel of outgoing) {
      if (!seen.has(rel.targetId)) {
        const entity = getEntity(rel.targetId);
        if (entity) {
          entities.push(entity);
          seen.add(rel.targetId);
        }
      }
    }
  }

  if (direction === "incoming" || direction === "both") {
    const incoming = getRelationshipsTo(entityId, relationshipType);
    for (const rel of incoming) {
      if (!seen.has(rel.sourceId)) {
        const entity = getEntity(rel.sourceId);
        if (entity) {
          entities.push(entity);
          seen.add(rel.sourceId);
        }
      }
    }
  }

  return entities;
}

// Format graph context for a character
export function formatGraphContextForEntity(entityId: number): string {
  const node = getEntityWithRelationships(entityId);
  if (!node) return "";

  const lines: string[] = [];

  if (node.relationships.outgoing.length > 0) {
    lines.push("### Known Connections");
    for (const { relationship, target } of node.relationships.outgoing) {
      const relData = relationship.data
        ? ` (${JSON.stringify(relationship.data)})`
        : "";
      lines.push(`- ${relationship.type} → ${target.name}${relData}`);
    }
  }

  if (node.relationships.incoming.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("### Others' Connections");
    for (const { relationship, source } of node.relationships.incoming) {
      lines.push(`- ${source.name} → ${relationship.type}`);
    }
  }

  return lines.join("\n");
}

// Search entities by name (fuzzy)
export function searchEntitiesByName(
  query: string,
  limit = 10
): Entity[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, world_id as worldId, type, name, data, created_at as createdAt
    FROM entities
    WHERE name LIKE ?
    ORDER BY
      CASE WHEN name = ? THEN 0
           WHEN name LIKE ? THEN 1
           ELSE 2
      END,
      name
    LIMIT ?
  `);

  const rows = stmt.all(
    `%${query}%`,
    query,
    `${query}%`,
    limit
  ) as Array<{
    id: number;
    worldId: number | null;
    type: string;
    name: string;
    data: string;
    createdAt: number;
  }>;

  return rows.map((row) => ({
    ...row,
    data: JSON.parse(row.data),
  })) as Entity[];
}
