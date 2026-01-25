import { retrieveFactsHybrid, storeFact, formatFactsForContext } from "./rag";
import { formatGraphContextForEntity } from "./graph";

// Tier 1: Ephemeral (in-memory recent messages)
// Managed by plugins/core (message history)

// Tier 2: Session (working memory for current scene)
interface SessionMemory {
  sceneDescription?: string;
  recentEvents: string[];
  activeEntities: number[];
  tempFacts: string[];
}

const channelSessions = new Map<string, SessionMemory>();

export function getSessionMemory(channelId: string): SessionMemory {
  let session = channelSessions.get(channelId);
  if (!session) {
    session = {
      recentEvents: [],
      activeEntities: [],
      tempFacts: [],
    };
    channelSessions.set(channelId, session);
  }
  return session;
}

export function setSceneDescription(
  channelId: string,
  description: string
): void {
  const session = getSessionMemory(channelId);
  session.sceneDescription = description;
}

export function addEvent(channelId: string, event: string): void {
  const session = getSessionMemory(channelId);
  session.recentEvents.push(event);
  // Keep last 10 events
  if (session.recentEvents.length > 10) {
    session.recentEvents.shift();
  }
}

export function addTempFact(channelId: string, fact: string): void {
  const session = getSessionMemory(channelId);
  session.tempFacts.push(fact);
  if (session.tempFacts.length > 20) {
    session.tempFacts.shift();
  }
}

export function clearSession(channelId: string): void {
  channelSessions.delete(channelId);
}

// Tier 3: Persistent (database - facts, entities, relationships)
// Managed by db/facts.ts, db/entities.ts, db/relationships.ts

// Assemble all memory tiers for context
export async function assembleMemoryContext(
  channelId: string,
  query: string,
  activeCharacterId?: number
): Promise<string> {
  const sections: string[] = [];

  // Session memory
  const session = getSessionMemory(channelId);

  if (session.sceneDescription) {
    sections.push(`## Current Scene\n${session.sceneDescription}`);
  }

  if (session.recentEvents.length > 0) {
    sections.push(
      `## Recent Events\n${session.recentEvents.map((e) => `- ${e}`).join("\n")}`
    );
  }

  if (session.tempFacts.length > 0) {
    sections.push(
      `## Session Notes\n${session.tempFacts.map((f) => `- ${f}`).join("\n")}`
    );
  }

  // Knowledge graph context for active character
  if (activeCharacterId) {
    const graphContext = formatGraphContextForEntity(activeCharacterId);
    if (graphContext) {
      sections.push(graphContext);
    }
  }

  // RAG - retrieve relevant facts
  const retrievedFacts = await retrieveFactsHybrid(query, {
    semanticLimit: 8,
    importanceThreshold: 7,
    importanceLimit: 5,
    maxTotal: 10,
  });

  if (retrievedFacts.length > 0) {
    sections.push(formatFactsForContext(retrievedFacts));
  }

  return sections.join("\n\n");
}

// Extract and store important information from a message exchange
export async function processMessageForMemory(
  channelId: string,
  userMessage: string,
  assistantResponse: string,
  entityId?: number
): Promise<void> {
  // Simple heuristics for what to remember
  // In a more sophisticated system, you'd use an LLM to extract facts

  // Check for explicit memory markers
  const rememberPatterns = [
    /remember(?:s|ed)? that (.+)/i,
    /important(?:ly)?[,:]? (.+)/i,
    /note(?:s|d)?[,:]? (.+)/i,
  ];

  for (const pattern of rememberPatterns) {
    const match = assistantResponse.match(pattern);
    if (match) {
      await storeFact(match[1], entityId, 6);
    }
  }

  // Store significant events (messages with certain keywords)
  const eventKeywords = [
    "discovered",
    "found",
    "learned",
    "realized",
    "decided",
    "promised",
    "agreed",
    "refused",
    "attacked",
    "defeated",
    "escaped",
    "arrived",
    "left",
    "died",
    "born",
    "married",
  ];

  const lowerResponse = assistantResponse.toLowerCase();
  for (const keyword of eventKeywords) {
    if (lowerResponse.includes(keyword)) {
      // Extract sentence containing the keyword
      const sentences = assistantResponse.split(/[.!?]+/);
      for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(keyword) && sentence.length > 20) {
          addEvent(channelId, sentence.trim());
          break;
        }
      }
      break;
    }
  }
}

// Format session for debugging/display
export function formatSessionDebug(channelId: string): string {
  const session = getSessionMemory(channelId);
  return JSON.stringify(session, null, 2);
}
