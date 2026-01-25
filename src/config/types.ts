/**
 * World configuration - all features are optional
 */

// === Chronicle/Memory ===
export interface ChronicleConfig {
  enabled: boolean;
  autoExtract: boolean; // LLM extracts from every exchange
  extractImportance: number; // Min importance to auto-extract (1-10)
  periodicSummary: boolean; // Summarize every N messages
  summaryInterval: number; // Messages between summaries
  explicitMarkers: boolean; // Recognize ```memory blocks
  perspectiveAware: boolean; // Filter by who knows what
}

// === Scenes ===
export interface SceneBoundaryConfig {
  onLocationChange: "new_scene" | "continue" | "ask";
  onTimeSkip: "new_scene" | "continue" | "ask";
  timeSkipThreshold: number; // Hours to count as "skip"
}

export interface SceneConfig {
  enabled: boolean;
  autoPause: boolean; // Pause after inactivity
  pauseAfterMinutes: number;
  boundaries: SceneBoundaryConfig;
}

// === Inventory ===
export interface InventoryConfig {
  enabled: boolean;
  useCapacity: boolean;
  maxWeight?: number;
  maxSlots?: number;
  useEquipment: boolean;
  equipmentSlots: string[]; // ["mainhand", "offhand", "head", "body", ...]
  useDurability: boolean;
}

// === Locations ===
export interface LocationConfig {
  enabled: boolean;
  useRegions: boolean; // Locations can be inside regions
  useZones: boolean; // Regions can be inside zones
  useConnections: boolean; // Track which locations connect
  connectionTypes: string[]; // ["door", "path", "portal", "hidden", ...]
  trackProperties: boolean;
  properties: string[]; // ["indoor", "safe", "dark", "underwater", ...]
  useTravelTime: boolean;
  defaultTravelTime: number; // Minutes between adjacent locations
}

// === Time ===
export interface CalendarConfig {
  hoursPerDay: number;
  daysPerWeek?: number;
  weeksPerMonth?: number;
  monthsPerYear?: number;
  monthNames?: string[];
  dayNames?: string[];
  yearOffset?: number; // Add to year display (e.g., 2846 to start at "Year 2847")
  era?: string; // Era suffix (e.g., "AE", "After Eclipse", "Cycle")
  seasons?: Array<{
    name: string;
    startMonth: number;
    weather?: string[];
  }>;
}

export interface TimePeriod {
  name: string; // "dawn", "morning", "noon", etc.
  startHour: number;
  lightLevel?: string; // "dark", "dim", "bright"
}

export interface TimeConfig {
  enabled: boolean;
  mode: "realtime" | "narrative" | "manual";
  realtimeRatio: number; // Game hours per real hour
  useCalendar: boolean;
  calendar?: CalendarConfig;
  useDayNight: boolean;
  periods: TimePeriod[];
  useScheduledEvents: boolean;
  useRealtimeSync: boolean; // Auto-advance game time based on real-time gap
  narrateTimeSkips: boolean; // LLM narrates what happened during absence
  timeSkipNarrationThreshold: number; // Real minutes before narrating (default 60)
}

// === Character State ===
export interface CharacterStateConfig {
  enabled: boolean;
  useAttributes: boolean;
  attributes: string[]; // ["health", "mana", "hunger", ...]
  attributeRanges: Record<string, [min: number, max: number]>;
  useForms: boolean;
  bodySchema: string[]; // ["species", "height", "hair", "eyes", ...]
  useEffects: boolean;
  effectTypes: string[]; // ["buff", "debuff", "curse", "transformation", ...]
}

// === Dice ===
export interface DiceConfig {
  enabled: boolean;
  syntax: "simple" | "standard" | "advanced";
  useCombat: boolean;
  turnOrder: "initiative" | "round_robin" | "simultaneous" | "narrative";
  useHP: boolean;
  useAC: boolean;
}

// === Relationships ===
export interface RelationshipConfig {
  enabled: boolean;
  useAffinity: boolean;
  affinityRange: [min: number, max: number];
  affinityLabels: Record<number, string>;
  useFactions: boolean;
  relationshipTypes: string[];
}

// === Context Assembly ===
export interface ContextConfig {
  maxTokens: number;
  historyMessages: number;
  ragResults: number;
  includeWorldLore: boolean;
  includeWorldRules: boolean;
  dynamicPriority: boolean; // Adjust based on query

  // Inter-message timestamps
  showTimestamps: boolean; // Inject time markers between messages in context
  timestampFormat: "relative" | "absolute" | "calendar" | "both";
  // relative:  "[3 hours later]"
  // absolute:  "[Day 3, 14:30]" (game time)
  // calendar:  "[Moonday, 15th of Frostfall, 14:30]" (custom calendar, falls back to absolute)
  // both:      "[3 hours later — Moonday, 15th of Frostfall, 14:30]"
  timestampThreshold: number; // Only show if gap > N real seconds (default 300 = 5 min)
}

// === Master Configuration ===
export interface WorldConfig {
  // Output mode
  multiCharMode: "tagged" | "webhooks" | "narrator" | "auto";

  // Subsystems
  chronicle: ChronicleConfig;
  scenes: SceneConfig;
  inventory: InventoryConfig;
  locations: LocationConfig;
  time: TimeConfig;
  characterState: CharacterStateConfig;
  dice: DiceConfig;
  relationships: RelationshipConfig;
  context: ContextConfig;
}

// Deep partial for config overrides
export type PartialWorldConfig = {
  [K in keyof WorldConfig]?: WorldConfig[K] extends object
    ? Partial<WorldConfig[K]>
    : WorldConfig[K];
};
