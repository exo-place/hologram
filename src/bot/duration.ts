/**
 * Shared duration parsing utilities for mute commands.
 * Used by /mute and any other command needing free-form human duration input.
 */

// =============================================================================
// parseDuration
// =============================================================================

type ParseDurationResult =
  | { ok: true; expiresAt: string | null }
  | { ok: false };

const UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  wk: 604_800_000,
  wks: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/**
 * Parse a human-readable duration string into an expiresAt SQLite timestamp.
 *
 * Accepts:
 *   - "forever" | "permanent" | "perm" → { ok: true, expiresAt: null } (indefinite)
 *   - One or more "<number> <unit>" segments, e.g. "30s", "10m", "1h30m", "1 hour 30 minutes"
 *
 * Returns { ok: false } for unparseable, zero, or negative input.
 * Returns { ok: true, expiresAt: "YYYY-MM-DD HH:MM:SS" } on success.
 */
export function parseDuration(input: string): ParseDurationResult {
  const s = input.trim().toLowerCase();
  if (!s) return { ok: false };

  // Forever / permanent
  if (s === "forever" || s === "permanent" || s === "perm") {
    return { ok: true, expiresAt: null };
  }

  // Match one or more <number> (optional space) <unit> segments
  // Allow optional whitespace/commas between segments
  // Require the string to be entirely composed of <number><unit> pairs optionally
  // separated by whitespace/commas. No leading junk allowed (e.g. "-5m" rejected).
  // Each segment: optional leading whitespace/comma, then digit(s), optional space, unit letters.
  const fullRe = /^(?:[\s,]*\d+(?:\.\d+)?\s*[a-z]+)+[\s,]*$/;
  if (!fullRe.test(s)) return { ok: false };

  const segRe = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let totalMs = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = segRe.exec(s)) !== null) {
    const amount = parseFloat(match[1]!);
    const unit = match[2]!;
    const ms = UNIT_MS[unit];
    if (ms === undefined) return { ok: false }; // Unknown unit
    if (!isFinite(amount) || amount < 0) return { ok: false };
    totalMs += amount * ms;
    lastIndex = segRe.lastIndex;
  }

  // Reject if nothing was parsed or there's trailing non-whitespace garbage
  if (totalMs === 0 && lastIndex === 0) return { ok: false };
  const trailing = s.slice(lastIndex).replace(/[\s,]+/g, "");
  if (trailing.length > 0) return { ok: false };
  if (totalMs <= 0) return { ok: false };

  const expiresAt = new Date(Date.now() + totalMs)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  return { ok: true, expiresAt };
}

// =============================================================================
// discordRelative
// =============================================================================

/**
 * Convert a SQLite UTC timestamp string ("YYYY-MM-DD HH:MM:SS") to a Discord
 * relative timestamp mention (<t:UNIX:R>).
 *
 * CRITICAL: the stored timestamp has a space separator, not "T". Parse as UTC
 * by appending "Z" after converting the space to "T".
 */
export function discordRelative(expiresAt: string): string {
  const date = new Date(expiresAt.replace(" ", "T") + "Z");
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:R>`;
}

/**
 * Convert a SQLite UTC timestamp string to a Discord full+relative timestamp pair.
 * Returns e.g. "<t:1234:F> (<t:1234:R>)".
 */
export function discordTimestamp(expiresAt: string): string {
  const date = new Date(expiresAt.replace(" ", "T") + "Z");
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}
