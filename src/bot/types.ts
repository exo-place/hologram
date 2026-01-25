import type { bot } from "./client";

// Bot type inferred from the actual bot instance (includes desiredProperties)
export type HologramBot = typeof bot;

// Interaction type inferred from the bot's transformers (matches desiredProperties)
export type HologramInteraction = typeof bot.transformers.$inferredTypes.interaction;
