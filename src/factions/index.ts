import { getDb } from "../db";
import {
  createEntity,
  getEntity,
  getEntitiesByType,
  type Entity,
  type FactionData,
} from "../db/entities";
import {
  createRelationship,
  getRelationshipsBetween,
} from "../db/relationships";

export interface FactionMember {
  id: number;
  factionId: number;
  characterId: number;
  rank: string | null;
  standing: number;
  isPublic: boolean;
  joinedAt: number;
}

export interface FactionRelation {
  factionId: number;
  otherFactionId: number;
  standing: number;   // -100 to +100
  status: "allied" | "neutral" | "hostile" | "war";
}

// === Faction CRUD ===

/** Create a new faction */
export function createFaction(
  name: string,
  data: FactionData,
  worldId?: number
): Entity<FactionData> {
  return createEntity("faction", name, data, worldId) as Entity<FactionData>;
}

/** Get a faction by ID */
export function getFaction(id: number): Entity<FactionData> | null {
  const entity = getEntity<FactionData>(id);
  if (!entity || entity.type !== "faction") return null;
  return entity;
}

/** List all factions in a world */
export function listFactions(worldId?: number): Entity<FactionData>[] {
  return getEntitiesByType<FactionData>("faction", worldId);
}

/** Update a faction's data */
export function updateFaction(id: number, data: Partial<FactionData>): boolean {
  const existing = getFaction(id);
  if (!existing) return false;

  const merged = { ...existing.data, ...data };
  const db = getDb();
  db.prepare("UPDATE entities SET data = ? WHERE id = ?")
    .run(JSON.stringify(merged), id);
  return true;
}

// === Membership ===

/** Add a character to a faction */
export function joinFaction(
  factionId: number,
  characterId: number,
  options?: { rank?: string; standing?: number; isPublic?: boolean }
): FactionMember {
  const db = getDb();
  const row = db.prepare(`
    INSERT INTO faction_members (faction_id, character_id, rank, standing, is_public)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(faction_id, character_id) DO UPDATE SET
      rank = excluded.rank, standing = excluded.standing, is_public = excluded.is_public
    RETURNING id, faction_id, character_id, rank, standing, is_public, joined_at
  `).get(
    factionId,
    characterId,
    options?.rank ?? null,
    options?.standing ?? 0,
    options?.isPublic !== false ? 1 : 0
  ) as {
    id: number;
    faction_id: number;
    character_id: number;
    rank: string | null;
    standing: number;
    is_public: number;
    joined_at: number;
  };

  return mapMemberRow(row);
}

/** Remove a character from a faction */
export function leaveFaction(factionId: number, characterId: number): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM faction_members WHERE faction_id = ? AND character_id = ?"
  ).run(factionId, characterId);
  return result.changes > 0;
}

/** Get all members of a faction */
export function getFactionMembers(factionId: number): FactionMember[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, faction_id, character_id, rank, standing, is_public, joined_at
    FROM faction_members WHERE faction_id = ?
    ORDER BY standing DESC, joined_at ASC
  `).all(factionId) as Array<{
    id: number;
    faction_id: number;
    character_id: number;
    rank: string | null;
    standing: number;
    is_public: number;
    joined_at: number;
  }>;

  return rows.map(mapMemberRow);
}

/** Get all factions a character belongs to */
export function getCharacterFactions(characterId: number): Array<{
  faction: Entity<FactionData>;
  membership: FactionMember;
}> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, faction_id, character_id, rank, standing, is_public, joined_at
    FROM faction_members WHERE character_id = ?
  `).all(characterId) as Array<{
    id: number;
    faction_id: number;
    character_id: number;
    rank: string | null;
    standing: number;
    is_public: number;
    joined_at: number;
  }>;

  const results: Array<{ faction: Entity<FactionData>; membership: FactionMember }> = [];
  for (const row of rows) {
    const faction = getFaction(row.faction_id);
    if (faction) {
      results.push({ faction, membership: mapMemberRow(row) });
    }
  }
  return results;
}

/** Get a specific membership */
export function getMembership(
  factionId: number,
  characterId: number
): FactionMember | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, faction_id, character_id, rank, standing, is_public, joined_at FROM faction_members WHERE faction_id = ? AND character_id = ?"
  ).get(factionId, characterId) as {
    id: number;
    faction_id: number;
    character_id: number;
    rank: string | null;
    standing: number;
    is_public: number;
    joined_at: number;
  } | null;

  return row ? mapMemberRow(row) : null;
}

/** Modify a member's standing within a faction */
export function modifyMemberStanding(
  factionId: number,
  characterId: number,
  amount: number
): FactionMember | null {
  const member = getMembership(factionId, characterId);
  if (!member) return null;

  const newStanding = Math.max(-100, Math.min(100, member.standing + amount));
  const db = getDb();
  db.prepare(
    "UPDATE faction_members SET standing = ? WHERE faction_id = ? AND character_id = ?"
  ).run(newStanding, factionId, characterId);

  return { ...member, standing: newStanding };
}

/** Set a member's rank */
export function setMemberRank(
  factionId: number,
  characterId: number,
  rank: string | null
): boolean {
  const db = getDb();
  const result = db.prepare(
    "UPDATE faction_members SET rank = ? WHERE faction_id = ? AND character_id = ?"
  ).run(rank, factionId, characterId);
  return result.changes > 0;
}

// === Faction-to-Faction Relations ===

/** Set or update relation between two factions */
export function setFactionRelation(
  factionId1: number,
  factionId2: number,
  standing: number,
  status: FactionRelation["status"]
): void {
  // Use the existing relationships table with type "faction_relation"
  const existing = getRelationshipsBetween(factionId1, factionId2)
    .find((r) => r.type === "faction_relation");

  const data = { standing, status };
  const db = getDb();

  if (existing) {
    db.prepare("UPDATE relationships SET data = ? WHERE id = ?")
      .run(JSON.stringify(data), existing.id);
  } else {
    createRelationship(factionId1, factionId2, "faction_relation", data);
  }
}

/** Get the relation between two factions */
export function getFactionRelation(
  factionId1: number,
  factionId2: number
): FactionRelation | null {
  const rels = getRelationshipsBetween(factionId1, factionId2)
    .filter((r) => r.type === "faction_relation");

  if (rels.length === 0) return null;

  const rel = rels[0];
  const data = (rel.data ?? {}) as { standing?: number; status?: string };

  return {
    factionId: rel.sourceId,
    otherFactionId: rel.targetId,
    standing: data.standing ?? 0,
    status: (data.status as FactionRelation["status"]) ?? "neutral",
  };
}

/** Get all relations for a faction */
export function getFactionRelations(factionId: number): Array<{
  faction: Entity<FactionData>;
  relation: FactionRelation;
}> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, source_id, target_id, data
    FROM relationships
    WHERE (source_id = ? OR target_id = ?) AND type = 'faction_relation'
  `).all(factionId, factionId) as Array<{
    id: number;
    source_id: number;
    target_id: number;
    data: string | null;
  }>;

  const results: Array<{ faction: Entity<FactionData>; relation: FactionRelation }> = [];
  for (const row of rows) {
    const otherId = row.source_id === factionId ? row.target_id : row.source_id;
    const faction = getFaction(otherId);
    if (!faction) continue;

    const data = row.data ? JSON.parse(row.data) : {};
    results.push({
      faction,
      relation: {
        factionId: row.source_id,
        otherFactionId: row.target_id,
        standing: data.standing ?? 0,
        status: data.status ?? "neutral",
      },
    });
  }

  return results;
}

// === Formatting ===

/** Format faction info for Discord display */
export function formatFactionForDisplay(faction: Entity<FactionData>): string {
  const lines: string[] = [];
  lines.push(`**${faction.name}**`);
  if (faction.data.description) {
    lines.push(faction.data.description);
  }
  if (faction.data.motto) {
    lines.push(`*"${faction.data.motto}"*`);
  }
  if (faction.data.alignment) {
    lines.push(`Alignment: ${faction.data.alignment}`);
  }

  const members = getFactionMembers(faction.id);
  if (members.length > 0) {
    lines.push(`\nMembers (${members.length}):`);
    for (const m of members.slice(0, 10)) {
      const entity = getEntity(m.characterId);
      const name = entity?.name ?? `Character ${m.characterId}`;
      let line = `- **${name}**`;
      if (m.rank) line += ` (${m.rank})`;
      line += ` | Standing: ${m.standing}`;
      if (!m.isPublic) line += " [Secret]";
      lines.push(line);
    }
    if (members.length > 10) {
      lines.push(`  ...and ${members.length - 10} more`);
    }
  }

  const relations = getFactionRelations(faction.id);
  if (relations.length > 0) {
    lines.push("\nRelations:");
    for (const { faction: other, relation } of relations) {
      const statusEmoji = {
        allied: "🤝",
        neutral: "➖",
        hostile: "⚠️",
        war: "⚔️",
      }[relation.status];
      lines.push(`- ${statusEmoji} **${other.name}**: ${relation.status} (${relation.standing})`);
    }
  }

  return lines.join("\n");
}

/** Format factions for AI context */
export function formatFactionsForContext(
  characterId: number
): string | null {
  const memberships = getCharacterFactions(characterId);
  if (memberships.length === 0) return null;

  const lines: string[] = ["## Faction Affiliations"];

  for (const { faction, membership } of memberships) {
    let line = `- **${faction.name}**`;
    if (membership.rank) line += ` (${membership.rank})`;
    line += ` | Standing: ${membership.standing}`;
    if (!membership.isPublic) line += " [Secret membership]";

    if (faction.data.description) {
      line += `\n  ${faction.data.description}`;
    }

    lines.push(line);

    // Include faction relations that might be relevant
    const relations = getFactionRelations(faction.id);
    for (const { faction: other, relation } of relations) {
      if (relation.status !== "neutral") {
        lines.push(`  - ${relation.status} with **${other.name}**`);
      }
    }
  }

  return lines.join("\n");
}

function mapMemberRow(row: {
  id: number;
  faction_id: number;
  character_id: number;
  rank: string | null;
  standing: number;
  is_public: number;
  joined_at: number;
}): FactionMember {
  return {
    id: row.id,
    factionId: row.faction_id,
    characterId: row.character_id,
    rank: row.rank,
    standing: row.standing,
    isPublic: row.is_public === 1,
    joinedAt: row.joined_at,
  };
}
