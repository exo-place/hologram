/**
 * Shared API types for server routes and frontend client.
 * The frontend imports these directly via Vite alias.
 */

// ============================================================================
// Entity types
// ============================================================================

export interface ApiEntity {
  id: number;
  name: string;
  owned_by: string | null;
  created_at: string;
  template: string | null;
  system_template: string | null;
}

export interface ApiFact {
  id: number;
  entity_id: number;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ApiEntityConfig {
  config_context: string | null;
  config_model: string | null;
  config_respond: string | null;
  config_stream_mode: string | null;
  config_stream_delimiters: string | null;
  config_avatar: string | null;
  config_memory: string | null;
  config_freeform: number;
  config_strip: string | null;
  config_view: string | null;
  config_edit: string | null;
  config_use: string | null;
  config_blacklist: string | null;
  config_thinking: string | null;
  config_collapse: string | null;
  config_keywords: string | null;
}

export interface ApiMemory {
  id: number;
  entity_id: number;
  content: string;
  source_message_id: string | null;
  source_channel_id: string | null;
  source_guild_id: string | null;
  frecency: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Web channel / message types
// ============================================================================

export interface ApiWebChannel {
  id: string;
  name: string | null;
  entity_ids: number[];
  created_at: string;
}

export interface ApiDiscordChannel {
  id: string;           // Discord snowflake string
  name: string | null;  // Channel name from Discord (cached in discord_channel_meta)
  entity_ids: number[];
  entity_names: string[];
  latest_message: { author_name: string; content: string; created_at: string } | null;
}

export interface ApiMessage {
  id: number;
  channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  discord_message_id: string | null;
  data: string | null;
  created_at: string;
}

// ============================================================================
// Request bodies
// ============================================================================

export interface CreateEntityBody {
  name: string;
  owned_by?: string;
}

export interface UpdateEntityBody {
  name: string;
}

export interface CreateFactBody {
  content: string;
}

export interface UpdateFactBody {
  content: string;
}

export interface CreateChannelBody {
  name?: string;
  entity_ids: number[];
}

export interface UpdateChannelBody {
  name?: string;
  entity_ids?: number[];
}

export interface SendMessageBody {
  content: string;
  author_id?: string;
  author_name?: string;
}

export interface CreateMemoryBody {
  content: string;
}

// ============================================================================
// Response wrappers
// ============================================================================

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiError;

// ============================================================================
// Debug types
// ============================================================================

export interface ApiBindingEntry {
  id: number;
  discord_id: string;
  discord_type: string;
  entity_id: number;
  entity_name: string;
  scope_guild_id: string | null;
  scope_channel_id: string | null;
}

export interface ApiBindingGraph {
  bindings: ApiBindingEntry[];
  total: number;
}

export interface ApiEvalError {
  id: number;
  entity_id: number;
  entity_name: string;
  owner_id: string;
  error_message: string;
  condition: string | null;
  created_at: string;
  notified_at: string | null;
}

export interface ApiEmbeddingStatus {
  model: string | null;
  total_facts: number;
  embedded_facts: number;
  total_memories: number;
  embedded_memories: number;
}

export interface ApiFactTrace {
  raw: string;
  conditional: boolean;
  expression: string | null;
  result: boolean | null;
  error: string | null;
  category: string;
  included: boolean;
}

export interface ApiEntityTrace {
  entity_id: number;
  entity_name: string;
  traces: ApiFactTrace[];
}

export interface ApiResponseSimulation {
  entity_id: number;
  entity_name: string;
  should_respond: boolean;
  respond_source: string | null;
  reason: string;
}

// SSE stream event — type discriminator matches src/ai/streaming.ts StreamEvent
export interface ApiStreamEvent {
  type: string;
  [key: string]: unknown;
}
