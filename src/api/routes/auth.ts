/**
 * Discord OAuth 2.0 authentication routes.
 *
 * Required env vars:
 *   DISCORD_CLIENT_ID     — OAuth app client ID
 *   DISCORD_CLIENT_SECRET — OAuth app client secret
 *   DISCORD_REDIRECT_URI  — must match Discord app redirect URI (e.g. https://host/api/auth/discord/callback)
 *   COOKIE_SECRET         — 32+ byte secret for HMAC session cookie signing
 *
 * Routes:
 *   GET /api/auth/discord/login     → redirect to Discord OAuth
 *   GET /api/auth/discord/callback  → exchange code, write session, set cookie
 *   GET /api/auth/me                → return current session info
 *   POST /api/auth/logout           → invalidate session
 */

import { getDb } from "../../db";
import { debug, warn } from "../../logger";
import type { RouteHandler } from "../helpers";

const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI ?? "";
const _COOKIE_SECRET = process.env.COOKIE_SECRET ?? "hologram-dev-secret-change-me";

const SESSION_TTL_DAYS = 7;
const DISCORD_API = "https://discord.com/api/v10";

export interface WebSession {
  id: string;
  discord_user_id: string;
  discord_username: string;
  discord_avatar: string | null;
  discord_access_token: string;
  created_at: string;
  expires_at: string;
}

// =============================================================================
// Session helpers
// =============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

function sqliteNow(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function createSession(
  discordUserId: string,
  discordUsername: string,
  discordAvatar: string | null,
  discordAccessToken: string,
): WebSession {
  const db = getDb();
  const id = generateId();
  const expiresAt = sqliteNow(SESSION_TTL_DAYS);
  return db.prepare(`
    INSERT INTO web_sessions (id, discord_user_id, discord_username, discord_avatar, discord_access_token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(id, discordUserId, discordUsername, discordAvatar ?? null, discordAccessToken, expiresAt) as WebSession;
}

export function getSession(id: string): WebSession | null {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM web_sessions
    WHERE id = ? AND expires_at > datetime('now')
  `).get(id) as WebSession | null;
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM web_sessions WHERE id = ?`).run(id);
}

/** Parse session ID from Cookie header. Returns null if missing or invalid. */
export function getSessionFromCookie(req: Request): string | null {
  const cookie = req.headers.get("Cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return match?.[1] ?? null;
}

/**
 * Returns the authenticated user ID for a request, or null if not authenticated.
 *
 * If OAuth is not configured (no DISCORD_CLIENT_ID), returns "local" so that
 * private deployments can use moderation routes without logging in.
 */
export function requireAuth(req: Request): string | null {
  if (!CLIENT_ID) return "local";
  return resolveSession(req)?.discord_user_id ?? null;
}

/** Resolve the authenticated session for a request. Returns null if not authenticated. */
export function resolveSession(req: Request): WebSession | null {
  const id = getSessionFromCookie(req);
  if (!id) return null;
  return getSession(id);
}

function sessionCookieHeader(id: string, maxAgeSecs: number): string {
  return `session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSecs}`;
}

// =============================================================================
// OAuth helpers
// =============================================================================

function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function exchangeCode(code: string): Promise<DiscordTokenResponse | null> {
  try {
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!res.ok) {
      warn("Discord token exchange failed", { status: res.status });
      return null;
    }
    return res.json() as Promise<DiscordTokenResponse>;
  } catch (err) {
    warn("Discord token exchange error", { err });
    return null;
  }
}

interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
  global_name?: string | null;
}

async function fetchDiscordUser(accessToken: string): Promise<DiscordUser | null> {
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return res.json() as Promise<DiscordUser>;
  } catch {
    return null;
  }
}

// =============================================================================
// Route handler
// =============================================================================

export const authRoutes: RouteHandler = async (req, url) => {
  // GET /api/auth/discord/login
  if (url.pathname === "/api/auth/discord/login" && req.method === "GET") {
    if (!CLIENT_ID || !REDIRECT_URI) {
      return Response.json({ ok: false, error: "Discord OAuth not configured (missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI)" }, { status: 503 });
    }
    const state = generateId();
    const authUrl = buildAuthUrl(state);
    debug("Discord OAuth login redirect", { state });
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
        "Set-Cookie": `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=300`,
      },
    });
  }

  // GET /api/auth/discord/callback
  if (url.pathname === "/api/auth/discord/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = (req.headers.get("Cookie") ?? "").match(/oauth_state=([^;]+)/)?.[1];

    if (!code) {
      return Response.json({ ok: false, error: "Missing code" }, { status: 400 });
    }
    if (state && cookieState && state !== cookieState) {
      warn("OAuth state mismatch — possible CSRF");
      return Response.json({ ok: false, error: "State mismatch" }, { status: 400 });
    }

    const tokens = await exchangeCode(code);
    if (!tokens) {
      return Response.json({ ok: false, error: "Failed to exchange code" }, { status: 502 });
    }

    const user = await fetchDiscordUser(tokens.access_token);
    if (!user) {
      return Response.json({ ok: false, error: "Failed to fetch Discord user" }, { status: 502 });
    }

    const session = createSession(user.id, user.username, user.avatar, tokens.access_token);
    debug("Discord OAuth session created", { userId: user.id, username: user.username });

    const redirectTo = url.searchParams.get("redirect") ?? "/";
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectTo,
        "Set-Cookie": sessionCookieHeader(session.id, SESSION_TTL_DAYS * 86_400),
      },
    });
  }

  // GET /api/auth/me
  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const session = resolveSession(req);
    if (!session) {
      return Response.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }
    return Response.json({
      ok: true,
      data: {
        id: session.discord_user_id,
        username: session.discord_username,
        avatar: session.discord_avatar,
      },
    });
  }

  // POST /api/auth/logout
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const id = getSessionFromCookie(req);
    if (id) deleteSession(id);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      },
    });
  }

  return null;
};
