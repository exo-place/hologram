# Design: Multi-Reply

**Status:** Deferred — needs careful design before implementation

## Concept

A single LLM trigger could reply to multiple prior messages in one response, each threaded as a Discord reply to its target message.

Example: a character catches up on several messages and responds to each one individually, with Discord's reply threading making it clear which response addresses which message.

## Constraints

### The LLM response isn't templated

The template system controls what goes *into* the LLM (system prompt, message history). The LLM's output is free-form text or tool calls. The only structured mechanism for the LLM to express "send this content as a reply to message X" is **tool calls**.

### Message ID legibility

Discord snowflakes are opaque to the LLM. However, the LLM doesn't need to *understand* them — it just needs to correlate message content it already sees in history to an ID it passes back. The IDs are metadata, not semantics.

## Proposed Approach

### Tool call mechanism

Add a `reply(message_id, content)` tool to `createTools()`. The LLM can call it N times in one response, each targeting a different message.

### History context changes

`history` entries in the template context currently don't expose `discord_message_id`. This would need to be added so the LLM has IDs to reference.

### Send-side changes

The dispatch logic (webhook/regular message send) needs to accept a `messageReference` and pass it to Discord's API. With/without ping is controlled via `allowed_mentions.replied_user`.

## Open Questions

- **Streaming**: How do streamed replies interact with multiple tool calls? Each reply would need to be dispatched as the tool call completes, not buffered until the end.
- **Webhooks vs regular messages**: Webhook sends and regular bot sends have different APIs. Both need `messageReference` support.
- **Response chain**: The existing `MAX_RESPONSE_CHAIN` logic tracks consecutive self-responses. Does each reply count as a separate chain link? Does the chain branch?
- **Interleaving with main response**: If the LLM also produces a top-level (non-reply) response alongside tool-call replies, what's the send order?
- **ID exposure scope**: Should all history messages expose their ID, or only recent ones? Exposing all IDs increases token usage.

## Non-Approach: Template-Based Reply

`send_as` could in theory accept a `reply_to` parameter, but this would only work for template-authored content — the LLM's own generated text still can't use it. Template control is useful for *structuring the prompt*, not for *routing the response*.
