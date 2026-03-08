/**
 * Pure helper functions for command processing.
 * Extracted into a separate module to allow unit testing without Discord dependencies.
 */

// =============================================================================
// Text Helpers
// =============================================================================

/**
 * Split text into chunks fitting maxLen, breaking at newlines when possible.
 */
export function chunkContent(content: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1) {
      // No newline within maxLen — hard split, preserve the character at the boundary
      chunks.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    } else {
      // Split at newline, skip the newline itself
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt + 1);
    }
  }
  return chunks;
}

export const MAX_OUTPUT_CHARS = 8000;
export const ELISION_MARKER = "\n... (elided) ...\n";

/**
 * Elide text that exceeds the max length, keeping beginning and end.
 */
export function elideText(text: string, maxLen = MAX_OUTPUT_CHARS): string {
  if (text.length <= maxLen) return text;
  const keepLen = maxLen - ELISION_MARKER.length;
  const halfKeep = Math.floor(keepLen / 2);
  return text.slice(0, halfKeep) + ELISION_MARKER + text.slice(-halfKeep);
}

// =============================================================================
// Permission UI Helpers
// =============================================================================

/**
 * Build default_values array for a mentionable select from DB value.
 * Skips username entries (can't pre-populate those in a select).
 */
export function buildDefaultValues(value: string[] | "@everyone" | null): Array<{ id: string; type: "user" | "role" }> {
  if (!value || value === "@everyone" || !Array.isArray(value)) return [];
  const defaults: Array<{ id: string; type: "user" | "role" }> = [];
  for (const entry of value) {
    if (entry.startsWith("role:")) {
      defaults.push({ id: entry.slice(5), type: "role" });
    } else if (/^\d{17,19}$/.test(entry)) {
      defaults.push({ id: entry, type: "user" });
    }
    // Skip username strings — can't pre-populate in select
  }
  return defaults;
}

/**
 * Minimal resolved data type for buildEntries (subset of InteractionDataResolved).
 * Uses Map<bigint, unknown> to avoid importing full Discordeno types in tests.
 */
export interface ResolvedData {
  roles?: { has(key: bigint): boolean };
  users?: { has(key: bigint): boolean };
}

/**
 * Build permission entries from mentionable select values, using Discord's
 * resolved data to distinguish roles from users.
 *
 * Security: IDs not present in either resolved.roles or resolved.users are
 * dropped — prevents injection of arbitrary IDs that weren't actually selected.
 */
export function buildEntries(values: string[], resolved: ResolvedData | undefined): string[] {
  if (!resolved) return [];
  const result: string[] = [];
  for (const id of values) {
    const bigId = BigInt(id);
    if (resolved.roles?.has(bigId)) {
      result.push(`role:${id}`);
    } else if (resolved.users?.has(bigId)) {
      result.push(id);
    }
    // ID found in neither resolved.roles nor resolved.users → drop (security fix)
  }
  return result;
}
