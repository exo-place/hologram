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
  sendMessage: (id: string, body: { content: string; entity_id?: number; author_name?: string }) =>
    post<{ sent: boolean }>(`/api/discord-channels/${id}/messages`, body),
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
