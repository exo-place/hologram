/**
 * Plugin system types
 *
 * Plugins are the fundamental unit of extensibility. Each plugin can:
 * - Register middleware (pre/post LLM processing)
 * - Register extractors (post-response state extraction)
 * - Register formatters (context assembly contributions)
 * - Register commands (slash commands)
 * - Declare config schema additions
 */

import type { CreateApplicationCommand } from "@discordeno/bot";
import type { HologramBot, HologramInteraction } from "../bot/types";
import type { Scene } from "../scene";
import type { Message } from "../ai/context";

// =============================================================================
// Core Context (shared state flowing through middleware)
// =============================================================================

/** Mutable context passed through the middleware chain */
export interface PluginContext {
  // Identity
  channelId: string;
  guildId: string | undefined;
  authorId: string;
  authorName: string;

  // Input (may be rewritten by proxy middleware)
  originalContent: string;
  content: string;
  effectiveName: string;

  // Scene state (set by scene middleware)
  scene: Scene | null;
  worldId: number | undefined;

  // Character state (set by character middleware)
  activeCharacterIds: number[];

  // Message history
  history: Message[];

  // LLM I/O (set by LLM middleware)
  systemPrompt: string;
  response: string | null;

  // Narration parts (accumulated by time/event middleware)
  narrationParts: string[];

  // User context (persona/proxy description for context)
  userContext: string | undefined;

  // Bot mention flag
  isBotMentioned: boolean;

  // Arbitrary plugin data (plugins can store state here)
  data: Map<string, unknown>;

  // Config for the active world (if any)
  config: import("../config/types").WorldConfig | null;
}

// =============================================================================
// Middleware
// =============================================================================

/** Middleware priority levels (lower = runs first) */
export const MiddlewarePriority = {
  /** Rewrite identity (proxy interception) */
  IDENTITY: 100,
  /** Load scene/world state */
  SCENE: 200,
  /** Time synchronization */
  TIME: 300,
  /** Random events */
  EVENTS: 400,
  /** Parser interception (for MUD-style commands) */
  PARSER: 500,
  /** Context assembly */
  CONTEXT: 800,
  /** LLM call */
  LLM: 900,
  /** Post-response extraction */
  EXTRACTION: 1000,
  /** Response delivery */
  DELIVERY: 1100,
} as const;

export type MiddlewarePriorityValue =
  (typeof MiddlewarePriority)[keyof typeof MiddlewarePriority];

/** Middleware function signature */
export type MiddlewareFn = (
  ctx: PluginContext,
  next: () => Promise<void>
) => Promise<void>;

/** Middleware registration */
export interface Middleware {
  name: string;
  priority: number;
  fn: MiddlewareFn;
}

// =============================================================================
// Extractors (post-response state extraction)
// =============================================================================

/** Extractor function - extracts state changes from LLM response */
export type ExtractorFn = (ctx: PluginContext) => Promise<void>;

/** Extractor registration */
export interface Extractor {
  name: string;
  /** Only run if this returns true */
  shouldRun: (ctx: PluginContext) => boolean;
  fn: ExtractorFn;
}

// =============================================================================
// Context Formatters (context assembly contributions)
// =============================================================================

/** Priority levels for context sections */
export const ContextPriority = {
  SYSTEM_RULES: 100,
  CHARACTER_PERSONA: 200,
  USER_PERSONA: 250,
  WORLD_STATE: 300,
  LOCATION: 350,
  INVENTORY: 400,
  OTHER_CHARACTERS: 450,
  RELATIONSHIPS: 500,
  CHRONICLE: 600,
  WORLD_LORE: 700,
} as const;

export type ContextPriorityValue =
  (typeof ContextPriority)[keyof typeof ContextPriority];

/** Context section produced by a formatter */
export interface ContextSection {
  name: string;
  content: string;
  priority: number;
  /** Can this section be truncated if over budget? */
  canTruncate: boolean;
  /** Minimum tokens to keep if truncating */
  minTokens?: number;
}

/** Formatter function - produces context sections */
export type FormatterFn = (
  ctx: PluginContext
) => Promise<ContextSection[]> | ContextSection[];

/** Formatter registration */
export interface Formatter {
  name: string;
  /** Only run if this returns true */
  shouldRun: (ctx: PluginContext) => boolean;
  fn: FormatterFn;
}

// =============================================================================
// Commands
// =============================================================================

/** Command handler function */
export type CommandHandler = (
  bot: HologramBot,
  interaction: HologramInteraction
) => Promise<void>;

/** Component handler function (buttons, selects, modals) */
export type ComponentHandler = (
  bot: HologramBot,
  interaction: HologramInteraction
) => Promise<boolean>; // Returns true if handled

/** Command registration */
export interface Command {
  definition: CreateApplicationCommand;
  handler: CommandHandler;
  /** Optional component handler for this command's UI */
  componentHandler?: ComponentHandler;
  /** Prefix for component custom_ids this handler responds to */
  componentPrefix?: string;
}

// =============================================================================
// Plugin Interface
// =============================================================================

/** Full plugin definition */
export interface Plugin {
  /** Unique plugin identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Plugin description */
  description?: string;

  /** Dependencies (other plugin IDs that must be loaded first) */
  dependencies?: string[];

  /**
   * Initialize the plugin.
   * Called once when the plugin is loaded.
   * Can return cleanup function.
   */
  init?: () => Promise<void | (() => void)> | void | (() => void);

  /** Middleware to register */
  middleware?: Middleware[];

  /** Extractors to register */
  extractors?: Extractor[];

  /** Context formatters to register */
  formatters?: Formatter[];

  /** Commands to register */
  commands?: Command[];
}

// =============================================================================
// Mode (plugin preset)
// =============================================================================

/** A mode is a named collection of plugins with optional config overrides */
export interface Mode {
  id: string;
  name: string;
  description?: string;
  /** Plugin IDs to enable */
  plugins: string[];
  /** Config overrides to apply */
  config?: import("../config/types").PartialWorldConfig;
}
