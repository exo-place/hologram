import { streamText, generateImage, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { getLanguageModel, getImageModel, isDedicatedImageModel, DEFAULT_MODEL, InferenceError, parseModelSpec, buildThinkingOptions, buildSafetyOptions, modelSupportsTools, recordNoToolModel, isToolsNotSupportedError } from "./models";
import { debug, error } from "../logger";
import {
  type EvaluatedEntity,
  type MessageContext,
  normalizeMessagesForProvider,
} from "./context";
import { preparePromptContext } from "./prompt";
import { resolveAttachmentMarkers } from "./attachments";
import { getEntity } from "../db/entities";
import { createTools } from "./tools";
import {
  stripNamePrefixFromStream,
  namePrefixSource,
  NAME_BOUNDARY,
} from "./parsing";
import type { GeneratedFile } from "./handler";

// =============================================================================
// Types
// =============================================================================

export interface StreamingContext extends MessageContext {
  /** Entities to stream for */
  entities: EvaluatedEntity[];
  /** Stream mode */
  streamMode: "lines" | "full";
  /** Custom delimiters (default: newline for lines mode, none for full mode) */
  delimiter?: string[];
}

/** Stream event types */
export type StreamEvent =
  | { type: "delta"; content: string; fullContent: string }
  | { type: "line"; content: string }
  | { type: "line_start" }  // lines full: new line starting
  | { type: "line_delta"; delta: string; content: string }  // lines full: delta within current line
  | { type: "line_end"; content: string }  // lines full: line complete
  | { type: "char_start"; name: string; entityId: number; avatarUrl?: string }
  | { type: "char_delta"; name: string; delta: string; content: string }
  | { type: "char_line"; name: string; content: string }
  | { type: "char_line_start"; name: string }  // lines full: new line starting for entity
  | { type: "char_line_delta"; name: string; delta: string; content: string }  // lines full: delta within current line
  | { type: "char_line_end"; name: string; content: string }  // lines full: line complete for entity
  | { type: "char_end"; name: string; content: string }
  | { type: "files"; files: GeneratedFile[] }
  | { type: "done"; fullText: string }
  /** Emitted (before done) when tool calls were auto-disabled for this model */
  | { type: "tools_auto_disabled"; modelSpec: string };

// =============================================================================
// Delimiter Utilities
// =============================================================================

/**
 * Find the first occurrence of any delimiter in a buffer.
 * Returns the index and length of the matched delimiter, or { index: -1, length: 0 } if none found.
 */
export function findFirstDelimiter(buffer: string, delimiters: string[]): { index: number; length: number } {
  let bestIndex = -1;
  let bestLength = 0;
  for (const delim of delimiters) {
    const idx = buffer.indexOf(delim);
    if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestLength = delim.length;
    }
  }
  return { index: bestIndex, length: bestLength };
}

// =============================================================================
// Streaming Handler
// =============================================================================

/**
 * Handle a message with streaming.
 * Yields events based on stream mode and character count.
 *
 * Single entity:
 * - "lines": yields { type: "line" } for each complete line
 * - "full": yields { type: "delta" } for each text chunk
 * - "lines_full": yields { type: "line" } when line completes, { type: "delta" } within line
 *
 * Multiple entities (heuristic XML parsing):
 * - Parses <Name>...</Name> tags as they stream
 * - yields char_start, char_delta/char_line, char_end events
 */
export async function* handleMessageStreaming(
  ctx: StreamingContext
): AsyncGenerator<StreamEvent, void, unknown> {
  const { channelId, guildId, entities, streamMode, delimiter } = ctx;

  // Prepare prompt context (expand refs, resolve user entity, build messages)
  const { systemPrompt, messages: llmMessages, nonce, contextExpr } = preparePromptContext(
    entities, channelId, guildId, ctx.userId, ctx.entityMemories,
  );

  debug("Calling LLM (streaming)", {
    entities: entities.map(e => e.name),
    streamMode,
    contextExpr,
    messageCount: llmMessages.length,
    hasMemories: !!ctx.entityMemories?.size,
  });

  const modelSpec = entities[0]?.modelSpec ?? DEFAULT_MODEL;
  const { providerName, modelName } = parseModelSpec(modelSpec);
  const thinkingLevel = entities[0]?.thinkingLevel;
  const contentFilters = entities[0]?.contentFilters ?? [];

  // Dedicated image generation models don't stream — call generateImage() and emit files + done
  if (isDedicatedImageModel(modelName)) {
    yield* handleImageGenerationStream(modelSpec, systemPrompt, llmMessages);
    return;
  }

  try {
    const model = getLanguageModel(modelSpec);

    // Resolve attachment markers (HATT → ImagePart / FilePart / text fallback)
    const entityId = entities[0]?.id ?? 0;
    const ownerId = entityId ? (getEntity(entityId)?.owned_by ?? "") : "";
    const resolvedMessages = await resolveAttachmentMarkers(llmMessages, nonce, providerName, entityId, ownerId);

    // Normalize messages for provider-specific restrictions (e.g., Google doesn't have system role)
    const normalizedMessages = normalizeMessagesForProvider(resolvedMessages, providerName);

    const thinkingOptions = buildThinkingOptions(providerName, modelName, thinkingLevel);
    const safetyOptions = buildSafetyOptions(providerName, contentFilters);
    const providerOptions = (thinkingOptions || safetyOptions)
      ? { ...thinkingOptions, ...safetyOptions }
      : undefined;

    const baseStreamOptions = {
      model,
      system: systemPrompt || undefined,
      messages: normalizedMessages,
      providerOptions,
      stopWhen: stepCountIs(5),
    };

    // Retry loop: attempt 0 uses tools (if supported), attempt 1 is the no-tools retry.
    // When "Function calling is not enabled" is detected (empty stream + API error), we record
    // the model and retry without tools in the same response cycle so the user sees no failure.
    let toolsAutoDisabledForModel: string | undefined;

    for (let attempt = 0; attempt <= 1; attempt++) {
      const useTools = attempt === 0 && modelSupportsTools(modelSpec);
      const result = useTools
        ? streamText({ ...baseStreamOptions, tools: createTools(channelId, guildId, ctx.triggerEntityFn) })
        : streamText(baseStreamOptions);

      // Attach early .catch() to result.text to prevent unhandled promise rejection.
      // AI_APICallError (e.g. "Function calling is not enabled") closes the stream silently
      // and rejects result.text rather than throwing through textStream.
      let textPromiseError: Error | null = null;
      const handledTextPromise = Promise.resolve(result.text).catch((err: unknown) => {
        textPromiseError = err instanceof Error ? err : new Error(String(err));
        return "";
      });

      // Wrap textStream to accumulate full text
      let accumulatedText = "";
      const trackedStream = (async function* () {
        for await (const chunk of result.textStream) {
          accumulatedText += chunk;
          yield chunk;
        }
      })();

      // Use different streaming logic based on single vs multiple entities
      // In freeform mode, treat multi-entity like single (no Name: prefix parsing)
      const isFreeform = entities.some(e => e.isFreeform);
      if (entities.length === 1 || isFreeform) {
        yield* streamSingleEntity(trackedStream, streamMode, delimiter, entities[0]?.name);
      } else {
        yield* streamMultiEntityNamePrefix(trackedStream, entities, streamMode, delimiter);
      }

      // Wait for text promise to settle
      await handledTextPromise;
      const streamNoOutput = textPromiseError !== null;

      // Collect generated image files (e.g. from gemini-2.0-flash-image-generation).
      // When streamNoOutput is true, _steps was rejected so result.files also rejects — skip it.
      const generatedFiles: GeneratedFile[] = [];
      if (!streamNoOutput) {
        const rawFiles = await result.files;
        for (const f of rawFiles ?? []) {
          if (f.mediaType.startsWith("image/")) {
            generatedFiles.push({ data: f.uint8Array, mediaType: f.mediaType });
          }
        }
      }

      // Cast to re-assert type — tsgo flow analysis doesn't track async callback assignments
      const capturedError = textPromiseError as Error | null;
      const trimmedAccumulated = accumulatedText.trim();

      // Empty stream + tool-not-supported error on the tools attempt → record and retry
      if (useTools && !trimmedAccumulated && generatedFiles.length === 0 && capturedError !== null && isToolsNotSupportedError(capturedError)) {
        const isNew = recordNoToolModel(modelSpec);
        if (isNew) toolsAutoDisabledForModel = modelSpec;
        continue; // retry without tools (attempt 1)
      }

      // Empty/whitespace-only response is an error unless the model returned image files
      if (!trimmedAccumulated && generatedFiles.length === 0) {
        const errMsg = capturedError !== null
          ? capturedError.message
          : streamNoOutput ? "No output generated" : "Empty response from model";
        throw new InferenceError(errMsg, modelSpec, capturedError ?? undefined);
      }

      // Success — emit events
      if (generatedFiles.length > 0) {
        yield { type: "files" as const, files: generatedFiles };
      }
      if (toolsAutoDisabledForModel !== undefined) {
        yield { type: "tools_auto_disabled" as const, modelSpec: toolsAutoDisabledForModel };
      }
      yield { type: "done" as const, fullText: accumulatedText };
      return;
    }

  } catch (err) {
    error("LLM streaming error", err);
    throw new InferenceError(
      err instanceof Error ? err.message : String(err),
      modelSpec,
      err,
    );
  }
}

// =============================================================================
// Single Entity Streaming
// =============================================================================

/**
 * Stream events for a single entity.
 *
 * Modes:
 * - "lines": new message per delimiter, sent when complete (emits "line" events)
 * - "full" without delimiter: single message, edited progressively (emits "delta" events)
 * - "full" with delimiter: new message per delimiter, each edited progressively
 *   (emits "line_start", "line_delta", "line_end" events)
 */
async function* streamSingleEntity(
  textStream: AsyncIterable<string>,
  streamMode: "lines" | "full",
  delimiter: string[] | undefined,
  entityName?: string
): AsyncGenerator<StreamEvent, void, unknown> {
  debug("streamSingleEntity started", { streamMode, delimiter, entityName });

  // Wrap stream to strip "Name:" prefixes and insert boundary markers
  const processedStream = entityName
    ? stripNamePrefixFromStream(textStream, entityName, NAME_BOUNDARY)
    : textStream;

  let buffer = "";
  let fullContent = "";
  let lineContent = "";  // For full mode with delimiter
  let lineStarted = false;

  // For full mode: split on user delimiters + NAME_BOUNDARY (if entity name present)
  const fullDelimiters = entityName
    ? [...(delimiter ?? []), NAME_BOUNDARY]
    : delimiter;
  const hasFullDelimiter = fullDelimiters !== undefined && fullDelimiters.length > 0;

  for await (const delta of processedStream) {
    buffer += delta;
    fullContent += delta;

    if (streamMode === "full" && !hasFullDelimiter) {
      // Full mode without delimiter: single message, emit every delta
      yield { type: "delta", content: delta, fullContent };
    } else if (streamMode === "full" && hasFullDelimiter) {
      // Full mode with delimiter: new message per chunk, each edited progressively
      let match: { index: number; length: number };
      while ((match = findFirstDelimiter(buffer, fullDelimiters!)).index !== -1) {
        const chunk = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match.length);

        // Complete current line
        lineContent += chunk;
        const trimmed = lineContent.trim();
        if (trimmed && trimmed !== "<none/>") {
          if (!lineStarted) {
            yield { type: "line_start" };
          }
          yield { type: "line_end", content: trimmed };
        }
        lineContent = "";
        lineStarted = false;
      }

      // Emit delta for partial content in buffer
      if (buffer) {
        if (!lineStarted) {
          yield { type: "line_start" };
          lineStarted = true;
        }
        lineContent += buffer;
        const trimmed = lineContent.trim();
        if (trimmed && trimmed !== "<none/>") {
          yield { type: "line_delta", delta: buffer, content: trimmed };
        }
        buffer = "";
      }
    } else {
      // Lines mode: split on delimiter, emit complete chunks
      const effectiveDelims = entityName
        ? [...(delimiter ?? ["\n"]), NAME_BOUNDARY]
        : (delimiter ?? ["\n"]);
      let match: { index: number; length: number };
      while ((match = findFirstDelimiter(buffer, effectiveDelims)).index !== -1) {
        const chunk = buffer.slice(0, match.index).trim();
        buffer = buffer.slice(match.index + match.length);

        if (chunk && chunk !== "<none/>") {
          yield { type: "line", content: chunk };
        }
      }
    }
  }

  // Handle remaining content
  if (streamMode === "lines") {
    const remaining = buffer.trim();
    if (remaining && remaining !== "<none/>") {
      yield { type: "line", content: remaining };
    }
  } else if (streamMode === "full" && hasFullDelimiter) {
    lineContent += buffer;
    const trimmed = lineContent.trim();
    if (trimmed && trimmed !== "<none/>") {
      if (!lineStarted) {
        yield { type: "line_start" };
      }
      yield { type: "line_end", content: trimmed };
    }
  }
  // For full mode without delimiter, already emitted as deltas
}

// =============================================================================
// Multi-Entity Streaming (Name Prefix)
// =============================================================================

/**
 * Stream events for multiple entities using "Name:" prefix format.
 * Detects "Name:" at start of text or after newline to switch between entities.
 * Falls back to emitting as first entity if no Name: prefixes are detected.
 *
 * Modes:
 * - "lines": new message per delimiter, sent when complete (emits "char_line" events)
 * - "full" without delimiter: single message per entity, edited progressively (emits "char_delta" events)
 * - "full" with delimiter: new message per delimiter, each edited progressively
 *   (emits "char_line_start", "char_line_delta", "char_line_end" events)
 */
async function* streamMultiEntityNamePrefix(
  textStream: AsyncIterable<string>,
  entities: EvaluatedEntity[],
  streamMode: "lines" | "full",
  delimiter: string[] | undefined
): AsyncGenerator<StreamEvent, void, unknown> {
  let buffer = "";
  let currentChar: { name: string; entityId: number; avatarUrl?: string; content: string; lineContent: string; lineStarted: boolean } | null = null;
  let detectedFormat: "name_prefix" | "first_entity_fallback" | null = null;

  const hasDelimiter = delimiter !== undefined;

  // Build entity lookup map (case-insensitive)
  const entityMap = new Map<string, EvaluatedEntity>();
  for (const entity of entities) {
    entityMap.set(entity.name.toLowerCase(), entity);
  }

  // Build regex for "Name:" at line start (case-insensitive, handles bold/italic)
  const names = entities.map(e => e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const namePrefixPattern = new RegExp(`^${namePrefixSource(`(${names.join("|")})`)}\\s*`, "im");

  /** Emit content for current character based on stream mode */
  function* emitCharContent(
    char: NonNullable<typeof currentChar>,
    content: string,
    isDelta: boolean
  ): Generator<StreamEvent> {
    if (!content) return;
    char.content += content;

    if (streamMode === "lines") {
      const effectiveDelims = delimiter ?? ["\n"];
      let remaining = char.lineContent + content;
      char.lineContent = "";
      let delimMatch: { index: number; length: number };
      while ((delimMatch = findFirstDelimiter(remaining, effectiveDelims)).index !== -1) {
        const chunk = remaining.slice(0, delimMatch.index).trim();
        remaining = remaining.slice(delimMatch.index + delimMatch.length);
        if (chunk) {
          yield { type: "char_line", name: char.name, content: chunk };
        }
      }
      if (isDelta) {
        char.lineContent = remaining;
      } else {
        const trimmed = remaining.trim();
        if (trimmed) {
          yield { type: "char_line", name: char.name, content: trimmed };
        }
      }
    } else if (streamMode === "full" && hasDelimiter) {
      if (isDelta) {
        let remaining = content;
        let delimMatch: { index: number; length: number };
        while ((delimMatch = findFirstDelimiter(remaining, delimiter)).index !== -1) {
          const chunk = remaining.slice(0, delimMatch.index);
          remaining = remaining.slice(delimMatch.index + delimMatch.length);
          char.lineContent += chunk;
          const trimmed = char.lineContent.trim();
          if (trimmed) {
            if (!char.lineStarted) {
              yield { type: "char_line_start", name: char.name };
            }
            yield { type: "char_line_end", name: char.name, content: trimmed };
          }
          char.lineContent = "";
          char.lineStarted = false;
        }
        if (remaining) {
          if (!char.lineStarted) {
            yield { type: "char_line_start", name: char.name };
            char.lineStarted = true;
          }
          char.lineContent += remaining;
          const trimmed = char.lineContent.trim();
          if (trimmed) {
            yield { type: "char_line_delta", name: char.name, delta: remaining, content: trimmed };
          }
        }
      } else {
        // Final flush
        char.lineContent += content;
        const trimmed = char.lineContent.trim();
        if (trimmed) {
          if (!char.lineStarted) {
            yield { type: "char_line_start", name: char.name };
          }
          yield { type: "char_line_end", name: char.name, content: trimmed };
        }
      }
    } else {
      // Full mode without delimiter
      yield { type: "char_delta", name: char.name, delta: content, content: char.content };
    }
  }

  // Detection threshold: if buffer grows beyond this without format detection,
  // fall back to emitting as first entity's response
  const maxDetectionLen = (Math.max(...entities.map(e => e.name.length)) + 10) * 3;

  for await (const delta of textStream) {
    buffer += delta;

    // Early format detection: check first meaningful content
    if (detectedFormat === null && buffer.trim().length > 0) {
      if (namePrefixPattern.test(buffer)) {
        detectedFormat = "name_prefix";
        debug("Multi-entity format detected: name_prefix");
      } else if (buffer.length > maxDetectionLen) {
        // Buffer exceeds threshold without Name: prefix, fall back to first entity
        debug("Multi-entity format detection threshold exceeded, falling back to first entity", {
          bufferLen: buffer.length,
          threshold: maxDetectionLen,
        });
        detectedFormat = "first_entity_fallback";
      } else {
        continue;
      }
    }

    if (detectedFormat !== "name_prefix" && detectedFormat !== "first_entity_fallback") continue;

    // For first_entity_fallback: emit all content as first entity
    if (detectedFormat === "first_entity_fallback") {
      if (!currentChar) {
        const entity = entities[0];
        currentChar = {
          name: entity.name,
          entityId: entity.id,
          avatarUrl: entity.avatarUrl ?? undefined,
          content: "",
          lineContent: "",
          lineStarted: false,
        };
        yield { type: "char_start", name: entity.name, entityId: entity.id, avatarUrl: entity.avatarUrl ?? undefined };
      }
      yield* emitCharContent(currentChar, buffer, true);
      buffer = "";
      continue;
    }

    // Process buffer for Name: prefixes
    while (buffer.length > 0) {
      const match = buffer.match(namePrefixPattern);
      if (match && match.index !== undefined) {
        // Text before the match belongs to current character
        if (match.index > 0 && currentChar) {
          const beforeText = buffer.slice(0, match.index);
          yield* emitCharContent(currentChar, beforeText, true);
        }

        // End previous character
        if (currentChar) {
          // Flush remaining line content
          if (currentChar.lineContent.trim()) {
            if (streamMode === "lines") {
              yield { type: "char_line", name: currentChar.name, content: currentChar.lineContent.trim() };
            } else if (streamMode === "full" && hasDelimiter && currentChar.lineStarted) {
              yield { type: "char_line_end", name: currentChar.name, content: currentChar.lineContent.trim() };
            }
          }
          yield { type: "char_end", name: currentChar.name, content: currentChar.content.trim() };
        }

        // Start new character
        const charName = match[1];
        const entity = entityMap.get(charName.toLowerCase());
        if (entity) {
          currentChar = {
            name: entity.name,
            entityId: entity.id,
            avatarUrl: entity.avatarUrl ?? undefined,
            content: "",
            lineContent: "",
            lineStarted: false,
          };
          yield { type: "char_start", name: entity.name, entityId: entity.id, avatarUrl: entity.avatarUrl ?? undefined };
        }

        buffer = buffer.slice(match.index + match[0].length);
      } else {
        // No name prefix found in buffer
        if (currentChar) {
          // Check if buffer might contain a partial name prefix at the end
          const hasNewline = buffer.includes("\n");
          if (hasNewline) {
            // Process up to last newline, keep the rest for potential name detection
            const lastNewline = buffer.lastIndexOf("\n");
            const processable = buffer.slice(0, lastNewline + 1);
            buffer = buffer.slice(lastNewline + 1);
            yield* emitCharContent(currentChar, processable, true);
          } else {
            // No newline - buffer might be mid-content, keep it
            // But if it's getting long, emit what we have
            const maxNameLen = Math.max(...entities.map(e => e.name.length)) + 2;
            if (buffer.length > maxNameLen * 2) {
              yield* emitCharContent(currentChar, buffer, true);
              buffer = "";
            }
          }
        }
        break;
      }
    }
  }

  // If format was never detected and buffer has content, emit as first entity
  if (detectedFormat === null && buffer.trim()) {
    debug("Multi-entity stream ended without format detection, emitting as first entity", {
      bufferLen: buffer.length,
    });
    const entity = entities[0];
    yield { type: "char_start", name: entity.name, entityId: entity.id, avatarUrl: entity.avatarUrl ?? undefined };
    currentChar = {
      name: entity.name,
      entityId: entity.id,
      avatarUrl: entity.avatarUrl ?? undefined,
      content: "",
      lineContent: "",
      lineStarted: false,
    };
    yield* emitCharContent(currentChar, buffer, false);
    buffer = "";
  }

  // Flush remaining buffer and close current character
  if (currentChar) {
    if (buffer.trim()) {
      yield* emitCharContent(currentChar, buffer, false);
    }
    if (currentChar.content.trim()) {
      yield { type: "char_end", name: currentChar.name, content: currentChar.content.trim() };
    }
  }
}

// =============================================================================
// Image Generation (non-streaming fallback)
// =============================================================================

async function* handleImageGenerationStream(
  modelSpec: string,
  systemPrompt: string,
  messages: ModelMessage[],
): AsyncGenerator<StreamEvent, void, unknown> {
  const parts: string[] = [];
  if (systemPrompt) parts.push(systemPrompt);
  for (const msg of messages) {
    const text = typeof msg.content === "string"
      ? msg.content
      : msg.content
          .filter(p => p.type === "text")
          .map(p => p.type === "text" ? p.text : "")
          .join("");
    if (text.trim()) parts.push(text.trim());
  }
  const prompt = parts.join("\n\n");
  if (!prompt) {
    throw new InferenceError("No prompt available for image generation", modelSpec);
  }

  debug("Calling image generation model (stream path)", { modelSpec, promptLength: prompt.length });

  try {
    const model = getImageModel(modelSpec);
    const result = await generateImage({ model, prompt });
    const files: import("./handler").GeneratedFile[] = result.images.map(img => ({
      data: img.uint8Array,
      mediaType: img.mediaType,
    }));
    if (files.length > 0) {
      yield { type: "files" as const, files };
    }
    yield { type: "done" as const, fullText: "" };
  } catch (err) {
    error("Image generation error (stream path)", err);
    throw new InferenceError(
      err instanceof Error ? err.message : String(err),
      modelSpec,
      err,
    );
  }
}
