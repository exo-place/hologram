/**
 * Typed API client — thin fetch wrapper over the REST API.
 *
 * All methods return the unwrapped `data` field on success,
 * or throw an Error with the server's error message on failure.
 */

import type {
  ApiEntity,
  ApiFact,
  ApiEntityConfig,
  ApiMemory,
  ApiWebChannel,
  ApiDiscordChannel,
  ApiMessage,
  ApiBindingGraph,
  ApiEvalError,
  ApiEmbeddingStatus,
  ApiEntityTrace,
  ApiResponseSimulation,
  CreateEntityBody,
  UpdateEntityBody,
  CreateFactBody,
  UpdateFactBody,
  CreateChannelBody,
  UpdateChannelBody,
  SendMessageBody,
  CreateMemoryBody,
} from "@api/types";

// Re-export for convenience
export type {
  ApiEntity,
  ApiFact,
  ApiEntityConfig,
  ApiMemory,
  ApiWebChannel,
  ApiDiscordChannel,
  ApiMessage,
  ApiBindingGraph,
  ApiEvalError,
  ApiEmbeddingStatus,
  ApiEntityTrace,
  ApiResponseSimulation,
};

type ApiOkResponse<T> = { ok: true; data: T };
type ApiErrResponse = { ok: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await res.json()) as ApiOkResponse<T> | ApiErrResponse;
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

function get<T>(path: string) {
  return request<T>(path, { method: "GET" });
}

function post<T>(path: string, body: unknown) {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

function put<T>(path: string, body: unknown) {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

function patch<T>(path: string, body: unknown) {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

function del<T>(path: string) {
  return request<T>(path, { method: "DELETE" });
}

// ============================================================================
// Entities
// ============================================================================

export const entities = {
  list: (params?: { q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString() ? `?${qs}` : "";
    return get<ApiEntity[]>(`/api/entities${query}`);
  },
  create: (body: CreateEntityBody) => post<ApiEntity>("/api/entities", body),
  get: (id: number) => get<ApiEntity & { facts: ApiFact[] }>(`/api/entities/${id}`),
  rename: (id: number, body: UpdateEntityBody) => put<ApiEntity>(`/api/entities/${id}`, body),
  delete: (id: number) => del<{ deleted: boolean }>(`/api/entities/${id}`),

  // Facts
  listFacts: (id: number) => get<ApiFact[]>(`/api/entities/${id}/facts`),
  addFact: (id: number, body: CreateFactBody) => post<ApiFact>(`/api/entities/${id}/facts`, body),
  updateFact: (id: number, fid: number, body: UpdateFactBody) =>
    put<ApiFact>(`/api/entities/${id}/facts/${fid}`, body),
  deleteFact: (id: number, fid: number) =>
    del<{ deleted: boolean }>(`/api/entities/${id}/facts/${fid}`),

  // Config
  getConfig: (id: number) => get<ApiEntityConfig>(`/api/entities/${id}/config`),
  patchConfig: (id: number, body: Partial<ApiEntityConfig>) =>
    patch<ApiEntityConfig>(`/api/entities/${id}/config`, body),

  // Templates
  getTemplate: (id: number) => get<{ template: string | null }>(`/api/entities/${id}/template`),
  setTemplate: (id: number, template: string | null) =>
    put<{ template: string | null }>(`/api/entities/${id}/template`, { template }),
  getSystemTemplate: (id: number) =>
    get<{ system_template: string | null }>(`/api/entities/${id}/system-template`),
  setSystemTemplate: (id: number, system_template: string | null) =>
    put<{ system_template: string | null }>(`/api/entities/${id}/system-template`, { system_template }),

  // Memories
  listMemories: (id: number) => get<ApiMemory[]>(`/api/entities/${id}/memories`),
  addMemory: (id: number, body: CreateMemoryBody) =>
    post<ApiMemory>(`/api/entities/${id}/memories`, body),
  deleteMemory: (id: number, mid: number) =>
    del<{ deleted: boolean }>(`/api/entities/${id}/memories/${mid}`),
};

// ============================================================================
// Channels
// ============================================================================

export const channels = {
  list: () => get<ApiWebChannel[]>("/api/channels"),
  create: (body: CreateChannelBody) => post<ApiWebChannel>("/api/channels", body),
  update: (id: string, body: UpdateChannelBody) =>
    patch<ApiWebChannel>(`/api/channels/${id}`, body),
  delete: (id: string) => del<{ deleted: boolean }>(`/api/channels/${id}`),
  listMessages: (id: string, limit = 50) =>
    get<ApiMessage[]>(`/api/channels/${id}/messages?limit=${limit}`),
  sendMessage: (id: string, body: SendMessageBody) =>
    post<{ message: ApiMessage; ai_response: null }>(`/api/channels/${id}/messages`, body),
  forget: (id: string) =>
    request<{ forget_at: string }>(`/api/channels/${id}/forget`, { method: "POST" }),
  trigger: (id: string) =>
    request<{ triggered: true }>(`/api/channels/${id}/trigger`, { method: "POST" }),
};

// ============================================================================
// Discord Channels (read-only browse)
// ============================================================================

export const discordChannels = {
  list: () => get<ApiDiscordChannel[]>("/api/discord-channels"),
  listMessages: (id: string, limit = 50) =>
    get<ApiMessage[]>(`/api/discord-channels/${id}/messages?limit=${limit}`),
  sendMessage: (id: string, body: { content: string; entity_id?: number; author_name?: string; is_dm?: boolean }) =>
    post<{ sent: boolean }>(`/api/discord-channels/${id}/messages`, body),
};

// ============================================================================
// Entities — trigger
// ============================================================================

export const entityTrigger = {
  trigger: (id: number, channelId: string, verb?: string, authorName?: string) =>
    post<{ triggered: boolean }>(`/api/entities/${id}/trigger`, { channel_id: channelId, verb, author_name: authorName }),
};

// ============================================================================
// Auth
// ============================================================================

export interface ApiUser {
  id: string;
  username: string;
  avatar: string | null;
}

export const auth = {
  me: () => request<ApiUser>("/api/auth/me"),
  loginUrl: () => "/api/auth/discord/login",
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
};

// ============================================================================
// Moderation
// ============================================================================

export interface ApiMute {
  id: number;
  scope_type: "entity" | "owner" | "channel" | "guild";
  scope_id: string;
  guild_id: string | null;
  channel_id: string | null;
  expires_at: string | null;
  created_by: string;
  reason: string | null;
  created_at: string;
}

export const moderation = {
  listMutes: (params?: { scope_type?: string; scope_id?: string; guild_id?: string; channel_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.scope_type) qs.set("scope_type", params.scope_type);
    if (params?.scope_id) qs.set("scope_id", params.scope_id);
    if (params?.guild_id != null) qs.set("guild_id", params.guild_id);
    if (params?.channel_id != null) qs.set("channel_id", params.channel_id);
    const query = qs.toString() ? `?${qs}` : "";
    return get<ApiMute[]>(`/api/mutes${query}`);
  },
  createMute: (body: {
    scope_type: string;
    scope_id: string;
    guild_id?: string | null;
    channel_id?: string | null;
    expires_at?: string | null;
    reason?: string | null;
  }) => post<ApiMute>("/api/mutes", body),
  deleteMute: (id: number) => del<{ removed: boolean }>(`/api/mutes/${id}`),
  bulkClear: (params: { guild_id?: string; scope_type?: string }) =>
    post<{ removed: number }>("/api/mutes/bulk-clear", params),
};

// ============================================================================
// Audit
// ============================================================================

export interface ApiModEvent {
  id: number;
  event_type: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  channel_id: string | null;
  guild_id: string | null;
  details: string | null;
  created_at: string;
}

export const auditLog = {
  list: (params?: {
    guild_id?: string;
    channel_id?: string;
    event_type?: string;
    target_id?: string;
    hours?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.guild_id) qs.set("guild_id", params.guild_id);
    if (params?.channel_id) qs.set("channel_id", params.channel_id);
    if (params?.event_type) qs.set("event_type", params.event_type);
    if (params?.target_id) qs.set("target_id", params.target_id);
    if (params?.hours != null) qs.set("hours", String(params.hours));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs}` : "";
    return get<ApiModEvent[]>(`/api/audit${query}`);
  },
};

// ============================================================================
// Server config
// ============================================================================

export interface ApiDiscordConfig {
  raw: {
    discord_id: string;
    discord_type: string;
    config_bind: string | null;
    config_persona: string | null;
    config_blacklist: string | null;
    config_chain_limit: number | null;
    config_rate_channel_per_min: number | null;
    config_rate_owner_per_min: number | null;
  } | null;
  resolved: {
    bind: string[] | null;
    persona: string[] | null;
    blacklist: string[] | null;
    chainLimit: number | null;
    rateChannel: number | null;
    rateOwner: number | null;
  };
}

export const serverConfig = {
  getGuildConfig: (guildId: string) => get<ApiDiscordConfig>(`/api/guilds/${guildId}/config`),
  patchGuildConfig: (guildId: string, body: { config_chain_limit?: number | null; config_rate_channel_per_min?: number | null; config_rate_owner_per_min?: number | null }) =>
    patch<{ updated: boolean }>(`/api/guilds/${guildId}/config`, body),
  getChannelConfig: (channelId: string) => get<ApiDiscordConfig>(`/api/channels/${channelId}/config`),
  patchChannelConfig: (channelId: string, body: { config_chain_limit?: number | null; config_rate_channel_per_min?: number | null; config_rate_owner_per_min?: number | null }) =>
    patch<{ updated: boolean }>(`/api/channels/${channelId}/config`, body),
};

// ============================================================================
// Debug
// ============================================================================

export const debug = {
  bindings: (params?: { guild?: string; channel?: string }) => {
    const qs = new URLSearchParams();
    if (params?.guild) qs.set("guild", params.guild);
    if (params?.channel) qs.set("channel", params.channel);
    const query = qs.toString() ? `?${qs}` : "";
    return get<ApiBindingGraph>(`/api/debug/bindings${query}`);
  },
  errors: (params?: { entity?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.entity != null) qs.set("entity", String(params.entity));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs}` : "";
    return get<ApiEvalError[]>(`/api/debug/errors${query}`);
  },
  embeddingStatus: () => get<ApiEmbeddingStatus>(`/api/debug/embedding-status`),
  embeddingCoverage: (entityId: number) =>
    get<unknown>(`/api/debug/embeddings?entity=${entityId}`),
  trace: (entityId: number, channelId?: string) => {
    const qs = channelId ? `?channel=${encodeURIComponent(channelId)}` : "";
    return get<ApiEntityTrace>(`/api/debug/trace/${entityId}${qs}`);
  },
  simulate: (channelId: string, guildId?: string) => {
    const qs = guildId ? `?guild=${guildId}` : "";
    return get<ApiResponseSimulation[]>(
      `/api/debug/simulate/${encodeURIComponent(channelId)}${qs}`
    );
  },
};
