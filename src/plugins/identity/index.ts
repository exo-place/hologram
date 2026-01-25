/**
 * Identity Plugin
 *
 * Handles user identity:
 * - Proxy interception (PluralKit-style character switching)
 * - Persona lookup (SillyTavern-style user identity)
 */

import type { Plugin, Middleware, Formatter } from "../types";
import { MiddlewarePriority, ContextPriority } from "../types";
import { parseProxyMessage, formatProxyForContext } from "../../proxies";
import { getPersona, formatPersonaForContext } from "../../personas";

// =============================================================================
// Middleware
// =============================================================================

/** Intercept proxy messages and rewrite identity */
const proxyMiddleware: Middleware = {
  name: "identity:proxy",
  priority: MiddlewarePriority.IDENTITY,
  fn: async (ctx, next) => {
    // Check if message matches a proxy pattern
    const proxyMatch = parseProxyMessage(ctx.authorId, ctx.content, ctx.worldId);

    if (proxyMatch) {
      ctx.effectiveName = proxyMatch.proxy.name;
      ctx.content = proxyMatch.content;
      ctx.userContext = formatProxyForContext(proxyMatch.proxy);
    } else {
      // No proxy - check for user persona
      const persona = getPersona(ctx.authorId, ctx.worldId);
      if (persona) {
        ctx.effectiveName = persona.name;
        ctx.userContext = formatPersonaForContext(persona);
      }
    }

    await next();
  },
};

// =============================================================================
// Formatters
// =============================================================================

/** Format user persona/proxy context */
const userContextFormatter: Formatter = {
  name: "identity:user",
  shouldRun: (ctx) => ctx.userContext !== undefined,
  fn: (ctx) => {
    if (!ctx.userContext) return [];

    return [
      {
        name: "identity:user",
        content: ctx.userContext,
        priority: ContextPriority.USER_PERSONA,
        canTruncate: true,
        minTokens: 30,
      },
    ];
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const identityPlugin: Plugin = {
  id: "identity",
  name: "Identity",
  description: "Proxy and persona handling for user identity",
  dependencies: ["core"],

  middleware: [proxyMiddleware],
  formatters: [userContextFormatter],
};

export default identityPlugin;
