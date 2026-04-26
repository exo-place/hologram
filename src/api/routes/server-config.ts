/**
 * Server/channel configuration API routes.
 *
 * GET  /api/guilds/:guildId/config         — get guild-scoped discord_config
 * PATCH /api/guilds/:guildId/config        — update guild-scoped config
 * GET  /api/channels/:channelId/config     — get channel-scoped discord_config
 * PATCH /api/channels/:channelId/config    — update channel-scoped config
 */

import { ok, err, parseBody } from "../helpers";
import type { RouteHandler } from "../helpers";
import { requireAuth } from "./auth";
import { getDiscordConfig, setDiscordConfig, resolveDiscordConfig } from "../../db/discord";
import { recordModEvent } from "../../db/moderation";

export const serverConfigRoutes: RouteHandler = async (req, url) => {
  // GET /api/guilds/:guildId/config
  const guildMatch = url.pathname.match(/^\/api\/guilds\/([^/]+)\/config$/);
  if (guildMatch) {
    const guildId = guildMatch[1]!;

    if (req.method === "GET") {
      const userId = requireAuth(req);
      if (!userId) return err("Not authenticated", 401);
      const config = getDiscordConfig(guildId, "guild");
      const resolved = resolveDiscordConfig(undefined, guildId);
      return ok({ raw: config, resolved });
    }

    if (req.method === "PATCH") {
      const userId = requireAuth(req);
      if (!userId) return err("Not authenticated", 401);

      const body = await parseBody<{
        config_chain_limit?: number | null;
        config_rate_channel_per_min?: number | null;
        config_rate_owner_per_min?: number | null;
      }>(req);
      if (!body) return err("Invalid request body");

      setDiscordConfig(guildId, "guild", {
        config_chain_limit: body.config_chain_limit,
        config_rate_channel_per_min: body.config_rate_channel_per_min,
        config_rate_owner_per_min: body.config_rate_owner_per_min,
      });

      recordModEvent({
        event_type: "config_changed",
        actor_id: userId,
        target_type: "guild",
        target_id: guildId,
        guild_id: guildId,
        details: body,
      });

      return ok({ updated: true });
    }
  }

  // GET/PATCH /api/channels/:channelId/config
  const channelConfigMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/config$/);
  if (channelConfigMatch) {
    const channelId = channelConfigMatch[1]!;

    if (req.method === "GET") {
      const userId = requireAuth(req);
      if (!userId) return err("Not authenticated", 401);
      const config = getDiscordConfig(channelId, "channel");
      const resolved = resolveDiscordConfig(channelId, undefined);
      return ok({ raw: config, resolved });
    }

    if (req.method === "PATCH") {
      const userId = requireAuth(req);
      if (!userId) return err("Not authenticated", 401);

      const body = await parseBody<{
        config_chain_limit?: number | null;
        config_rate_channel_per_min?: number | null;
        config_rate_owner_per_min?: number | null;
      }>(req);
      if (!body) return err("Invalid request body");

      setDiscordConfig(channelId, "channel", {
        config_chain_limit: body.config_chain_limit,
        config_rate_channel_per_min: body.config_rate_channel_per_min,
        config_rate_owner_per_min: body.config_rate_owner_per_min,
      });

      recordModEvent({
        event_type: "config_changed",
        actor_id: userId,
        target_type: "channel",
        target_id: channelId,
        channel_id: channelId,
        details: body,
      });

      return ok({ updated: true });
    }
  }

  return null;
};
