import { getDb } from "../db";
import {
  createItem,
  getEntity,
  updateEntity,
  type ItemData,
  type Entity,
  type ItemType,
} from "../db/entities";
import { createRelationship, getRelationshipsFrom, deleteRelationshipsBetween, RelTypes } from "../db/relationships";
import { getCharacterState, getActiveFlags, addEffect, type EffectType, type EffectDuration } from "../state";

export interface InventoryItem {
  entityId: number;
  name: string;
  description: string;
  quantity: number;
  stats?: Record<string, number>;
  itemType?: ItemType;
  weight?: number;
  equipSlot?: string;
  equipped?: boolean;
}

export interface EquippedItem {
  slot: string;
  itemId: number;
  item: InventoryItem;
}

// Get all items owned by an entity (character)
export function getInventory(ownerId: number): InventoryItem[] {
  const relationships = getRelationshipsFrom(ownerId, RelTypes.OWNS);
  const items: InventoryItem[] = [];

  for (const rel of relationships) {
    const item = getEntity<ItemData>(rel.targetId);
    if (item && item.type === "item") {
      items.push({
        entityId: item.id,
        name: item.name,
        description: item.data.description,
        quantity: (rel.data?.quantity as number) ?? 1,
        stats: item.data.stats,
      });
    }
  }

  return items;
}

// Add item to inventory (creates item if it doesn't exist)
export function addToInventory(
  ownerId: number,
  item: { name: string; description: string; stats?: Record<string, number> },
  quantity = 1,
  worldId?: number
): InventoryItem {
  // Create the item entity
  const itemEntity = createItem(
    item.name,
    {
      description: item.description,
      stats: item.stats,
    },
    worldId
  );

  // Create ownership relationship with quantity
  createRelationship(ownerId, itemEntity.id, RelTypes.OWNS, { quantity });

  return {
    entityId: itemEntity.id,
    name: itemEntity.name,
    description: itemEntity.data.description,
    quantity,
    stats: itemEntity.data.stats,
  };
}

// Add existing item entity to inventory
export function giveItem(
  ownerId: number,
  itemId: number,
  quantity = 1
): boolean {
  const item = getEntity<ItemData>(itemId);
  if (!item || item.type !== "item") return false;

  // Check if already owns this item
  const existing = getRelationshipsFrom(ownerId, RelTypes.OWNS).find(
    (r) => r.targetId === itemId
  );

  if (existing) {
    // Update quantity
    const db = getDb();
    const newQty = ((existing.data?.quantity as number) ?? 1) + quantity;
    const stmt = db.prepare(
      "UPDATE relationships SET data = ? WHERE id = ?"
    );
    stmt.run(JSON.stringify({ quantity: newQty }), existing.id);
  } else {
    // Create new ownership
    createRelationship(ownerId, itemId, RelTypes.OWNS, { quantity });
  }

  return true;
}

// Remove item from inventory
export function removeFromInventory(
  ownerId: number,
  itemId: number,
  quantity = 1
): boolean {
  const relationships = getRelationshipsFrom(ownerId, RelTypes.OWNS);
  const rel = relationships.find((r) => r.targetId === itemId);

  if (!rel) return false;

  const currentQty = (rel.data?.quantity as number) ?? 1;
  const newQty = currentQty - quantity;

  if (newQty <= 0) {
    // Remove ownership entirely
    deleteRelationshipsBetween(ownerId, itemId, RelTypes.OWNS);
  } else {
    // Update quantity
    const db = getDb();
    const stmt = db.prepare(
      "UPDATE relationships SET data = ? WHERE id = ?"
    );
    stmt.run(JSON.stringify({ quantity: newQty }), rel.id);
  }

  return true;
}

// Update item stats
export function updateItemStats(
  itemId: number,
  stats: Record<string, number>
): Entity<ItemData> | null {
  return updateEntity<ItemData>(itemId, {
    data: { stats },
  });
}

// Format inventory for context
export function formatInventoryForContext(ownerId: number, sceneId?: number): string {
  const inventory = getInventory(ownerId);
  if (inventory.length === 0) {
    return "Inventory: Empty";
  }

  const equipped = sceneId !== undefined ? getEquippedItems(ownerId, sceneId) : [];
  const equippedIds = new Set(equipped.map((e) => e.itemId));

  const lines = ["## Inventory"];

  // Show equipped items first
  if (equipped.length > 0) {
    lines.push("**Equipped:**");
    for (const eq of equipped) {
      lines.push(`- [${eq.slot}] ${eq.item.name}`);
    }
    lines.push("");
  }

  // Show unequipped items
  const unequipped = inventory.filter((i) => !equippedIds.has(i.entityId));
  if (unequipped.length > 0) {
    lines.push("**Items:**");
    for (const item of unequipped) {
      let line = `- **${item.name}**`;
      if (item.quantity > 1) {
        line += ` (x${item.quantity})`;
      }
      line += `: ${item.description}`;
      if (item.stats && Object.keys(item.stats).length > 0) {
        const statsStr = Object.entries(item.stats)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        line += ` [${statsStr}]`;
      }
      lines.push(line);
    }
  }

  return lines.join("\n");
}

// === Equipment Management ===

/** Get equipped items for a character in a scene */
export function getEquippedItems(
  characterId: number,
  sceneId: number
): EquippedItem[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT slot, item_id FROM character_equipment
    WHERE character_id = ? AND scene_id = ?
  `);

  const rows = stmt.all(characterId, sceneId) as Array<{
    slot: string;
    item_id: number;
  }>;

  const items: EquippedItem[] = [];
  for (const row of rows) {
    const itemEntity = getEntity<ItemData>(row.item_id);
    if (itemEntity) {
      items.push({
        slot: row.slot,
        itemId: row.item_id,
        item: {
          entityId: itemEntity.id,
          name: itemEntity.name,
          description: itemEntity.data.description,
          quantity: 1,
          stats: itemEntity.data.stats,
          itemType: itemEntity.data.type,
          weight: itemEntity.data.weight,
          equipSlot: itemEntity.data.equipSlot,
          equipped: true,
        },
      });
    }
  }

  return items;
}

/** Check if an item is equipped */
export function isEquipped(
  characterId: number,
  sceneId: number,
  itemId: number
): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT 1 FROM character_equipment
    WHERE character_id = ? AND scene_id = ? AND item_id = ?
  `);
  return stmt.get(characterId, sceneId, itemId) !== undefined;
}

/** Check equipment requirements against character state */
export function checkRequirements(
  characterId: number,
  sceneId: number,
  item: Entity<ItemData>
): { canEquip: boolean; reasons: string[] } {
  const requirements = item.data.requirements;
  if (!requirements) {
    return { canEquip: true, reasons: [] };
  }

  const reasons: string[] = [];
  const state = getCharacterState(characterId, sceneId);
  const body = state?.body ?? {};
  const attrs = state?.attributes ?? {};
  const flags = getActiveFlags(characterId, sceneId);

  // Check species
  if (requirements.species && requirements.species.length > 0) {
    const species = body.species as string | undefined;
    if (!species || !requirements.species.includes(species)) {
      reasons.push(`Requires species: ${requirements.species.join(" or ")}`);
    }
  }

  // Check body type
  if (requirements.bodyType && requirements.bodyType.length > 0) {
    const bodyType = body.bodyType as string | undefined;
    if (!bodyType || !requirements.bodyType.includes(bodyType)) {
      reasons.push(`Requires body type: ${requirements.bodyType.join(" or ")}`);
    }
  }

  // Check size
  if (requirements.size && requirements.size.length > 0) {
    const size = body.size as string | undefined;
    if (!size || !requirements.size.includes(size)) {
      reasons.push(`Requires size: ${requirements.size.join(" or ")}`);
    }
  }

  // Check attributes
  if (requirements.attributes) {
    for (const [attr, minValue] of Object.entries(requirements.attributes)) {
      const current = attrs[attr] ?? 0;
      if (current < minValue) {
        reasons.push(`Requires ${attr} >= ${minValue} (have ${current})`);
      }
    }
  }

  // Check required flags
  if (requirements.flags && requirements.flags.length > 0) {
    for (const flag of requirements.flags) {
      if (!flags.includes(flag)) {
        reasons.push(`Requires: ${flag}`);
      }
    }
  }

  // Check forbidden flags
  if (requirements.notFlags && requirements.notFlags.length > 0) {
    for (const flag of requirements.notFlags) {
      if (flags.includes(flag)) {
        reasons.push(`Cannot have: ${flag}`);
      }
    }
  }

  return { canEquip: reasons.length === 0, reasons };
}

/** Equip an item to a slot */
export function equipItem(
  characterId: number,
  sceneId: number,
  itemId: number,
  slot?: string
): { success: boolean; error?: string } {
  const item = getEntity<ItemData>(itemId);
  if (!item || item.type !== "item") {
    return { success: false, error: "Item not found" };
  }

  // Check if item is in inventory
  const inventory = getInventory(characterId);
  if (!inventory.find((i) => i.entityId === itemId)) {
    return { success: false, error: "Item not in inventory" };
  }

  // Determine slot
  const targetSlot = slot ?? item.data.equipSlot;
  if (!targetSlot) {
    return { success: false, error: "Item cannot be equipped (no slot)" };
  }

  // Check requirements
  const reqCheck = checkRequirements(characterId, sceneId, item);
  if (!reqCheck.canEquip) {
    const incompatible = item.data.incompatible ?? "cannot_equip";
    if (incompatible === "cannot_equip") {
      return { success: false, error: reqCheck.reasons.join("; ") };
    }
    // Other modes allow equipping with penalties (handled elsewhere)
  }

  // Unequip current item in slot if any
  const db = getDb();
  db.prepare(`
    DELETE FROM character_equipment
    WHERE character_id = ? AND scene_id = ? AND slot = ?
  `).run(characterId, sceneId, targetSlot);

  // Equip new item
  db.prepare(`
    INSERT INTO character_equipment (character_id, scene_id, slot, item_id)
    VALUES (?, ?, ?, ?)
  `).run(characterId, sceneId, targetSlot, itemId);

  return { success: true };
}

/** Unequip an item from a slot */
export function unequipItem(
  characterId: number,
  sceneId: number,
  slot: string
): { success: boolean; itemId?: number } {
  const db = getDb();

  // Get current item in slot
  const current = db.prepare(`
    SELECT item_id FROM character_equipment
    WHERE character_id = ? AND scene_id = ? AND slot = ?
  `).get(characterId, sceneId, slot) as { item_id: number } | undefined;

  if (!current) {
    return { success: false };
  }

  // Remove from slot
  db.prepare(`
    DELETE FROM character_equipment
    WHERE character_id = ? AND scene_id = ? AND slot = ?
  `).run(characterId, sceneId, slot);

  return { success: true, itemId: current.item_id };
}

// === Consumable Items ===

/** Use a consumable item */
export function useItem(
  characterId: number,
  sceneId: number | null,
  itemId: number
): { success: boolean; message: string } {
  const item = getEntity<ItemData>(itemId);
  if (!item || item.type !== "item") {
    return { success: false, message: "Item not found" };
  }

  // Check if consumable
  if (item.data.type !== "consumable") {
    return { success: false, message: "Item is not consumable" };
  }

  // Check uses
  const uses = item.data.uses ?? 1;
  if (uses <= 0) {
    return { success: false, message: "Item has no uses left" };
  }

  // Apply transformation effects if any
  if (item.data.transformation) {
    const tf = item.data.transformation;

    for (const effectData of tf.effects) {
      addEffect(characterId, sceneId, {
        name: effectData.name,
        type: (effectData.type ?? "transformation") as EffectType,
        description: effectData.description,
        duration: (effectData.duration ?? "permanent") as EffectDuration,
        modifiers: effectData.modifiers,
        bodyChanges: effectData.bodyChanges,
        flags: effectData.flags,
      });
    }
  }

  // Decrement uses
  const newUses = uses - 1;
  if (newUses <= 0) {
    // Remove item from inventory
    removeFromInventory(characterId, itemId, 1);
    return { success: true, message: `Used ${item.name}. Item consumed.` };
  } else {
    // Update uses
    updateEntity<ItemData>(itemId, { data: { uses: newUses } });
    return { success: true, message: `Used ${item.name}. ${newUses} uses remaining.` };
  }
}

// === Inventory Capacity ===

/** Calculate total inventory weight */
export function getInventoryWeight(ownerId: number): number {
  const inventory = getInventory(ownerId);
  let total = 0;

  for (const item of inventory) {
    const itemEntity = getEntity<ItemData>(item.entityId);
    const weight = itemEntity?.data.weight ?? 0;
    total += weight * item.quantity;
  }

  return total;
}

/** Check if character can carry more weight */
export function canCarry(
  ownerId: number,
  additionalWeight: number,
  maxCapacity: number
): boolean {
  const current = getInventoryWeight(ownerId);
  return current + additionalWeight <= maxCapacity;
}

// === Formatting ===

/** Format equipped items for display */
export function formatEquipmentForDisplay(
  characterId: number,
  sceneId: number
): string {
  const equipped = getEquippedItems(characterId, sceneId);
  if (equipped.length === 0) {
    return "No equipment.";
  }

  const lines = ["**Equipment:**"];
  for (const eq of equipped) {
    let line = `- [${eq.slot}] **${eq.item.name}**`;
    if (eq.item.stats && Object.keys(eq.item.stats).length > 0) {
      const statsStr = Object.entries(eq.item.stats)
        .map(([k, v]) => `${k}: ${v > 0 ? "+" : ""}${v}`)
        .join(", ");
      line += ` (${statsStr})`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}
