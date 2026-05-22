import { ApplicationCommandOptionTypes, TextStyles, MessageComponentTypes } from "@discordeno/bot";
import {
  registerCommand,
  registerModalHandler,
  respond,
  respondWithModal,
  respondWithV2Modal,
  type CommandContext,
} from "./index";
import {
  getEntityTemplate,
  setEntityTemplate,
  getEntitySystemTemplate,
  setEntitySystemTemplate,
  getEntityWithFacts,
  getEntityWithFactsByName,
  getEntityConfig,
  setEntityConfig,
  setEntityNickname,
  getPermissionDefaults,
  setFacts,
  updateEntity,
  type EntityWithFacts,
} from "../../db/entities";
import {
  getMemoriesForEntity,
  setMemories,
} from "../../db/memories";
import { checkKeywordMatch } from "../../logic/expr";
import { getAvailableModels } from "../../ai/model-list";
import { chunkContent, buildDefaultValues, buildEntries, type ResolvedData } from "./helpers";
import { canUserEdit } from "./cmd-permissions";
export { canUserEdit };

// =============================================================================
// Permissions UI Helpers (V2 Modal with Mentionable Selects)
// =============================================================================

const PERM_FIELDS = ["view", "edit", "use", "delete", "blacklist"] as const;
type PermField = (typeof PERM_FIELDS)[number];

const PERM_LABELS: Record<PermField, string> = {
  view: "View",
  edit: "Edit",
  use: "Trigger",
  delete: "Delete messages",
  blacklist: "Blacklist",
};

const PERM_DESCRIPTIONS: Record<PermField, string> = {
  view: "Blank means anyone can view",
  edit: "Blank means anyone can edit",
  use: "Blank means anyone can trigger",
  delete: "Who can delete this entity's messages (blank = owner only)",
  blacklist: "Blocked from viewing, editing, and triggering",
};

const PERM_CONFIG_KEYS: Record<PermField, string> = {
  view: "config_view",
  edit: "config_edit",
  use: "config_use",
  delete: "config_delete",
  blacklist: "config_blacklist",
};

/**
 * Build Label components (type 18) wrapping MentionableSelects for a V2 modal.
 * For view/edit, null DB values default to showing the owner pre-selected.
 */
function buildPermissionsLabels(entityId: number, ownerId: string): unknown[] {
  const defaults = getPermissionDefaults(entityId);

  return PERM_FIELDS.map(field => {
    const value = field === "blacklist" ? defaults.blacklist : defaults[`${field}List`];

    // For view/edit/delete, null means owner-only — pre-populate with owner
    let defaultValues: Array<{ id: string; type: "user" | "role" }>;
    if (value === null && (field === "view" || field === "edit" || field === "delete")) {
      defaultValues = [{ id: ownerId, type: "user" }];
    } else {
      defaultValues = buildDefaultValues(value as string[] | "@everyone" | null);
    }

    const select: Record<string, unknown> = {
      type: MessageComponentTypes.MentionableSelect,
      customId: `perm_${field}`,
      required: false,
      minValues: 0,
      maxValues: 25,
    };
    if (defaultValues.length > 0) {
      select.defaultValues = defaultValues;
    }

    return {
      type: MessageComponentTypes.Label,
      label: PERM_LABELS[field],
      description: PERM_DESCRIPTIONS[field],
      component: select,
    };
  });
}

// =============================================================================
// /edit - Edit entity facts
// =============================================================================

registerCommand({
  name: "edit",
  description: "Edit an entity's facts and memories",
  noDefer: true,
  options: [
    {
      name: "entity",
      description: "Entity name or ID",
      type: ApplicationCommandOptionTypes.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "type",
      description: "What to edit (default: both)",
      type: ApplicationCommandOptionTypes.String,
      required: false,
      choices: [
        { name: "Both", value: "both" },
        { name: "Facts", value: "facts" },
        { name: "Memories", value: "memories" },
        { name: "Template", value: "template" },
        { name: "System Prompt", value: "system-template" },
        { name: "Model", value: "model" },
        { name: "Context", value: "context" },
        { name: "Identity", value: "identity" },
        { name: "Advanced", value: "advanced" },
        { name: "Permissions", value: "permissions" },
      ],
    },
  ],
  async handler(ctx: CommandContext, options) {
    const input = options.entity as string;
    const editType = (options.type as string) ?? "both";

    let entity = null;
    const id = parseInt(input);
    if (!isNaN(id)) {
      entity = getEntityWithFacts(id);
    }
    if (!entity) {
      entity = getEntityWithFactsByName(input);
    }

    if (!entity) {
      await respond(ctx.bot, ctx.interaction, `Entity not found: ${input}`, true);
      return;
    }

    // Check edit permission
    if (!canUserEdit(entity, ctx.userId, ctx.username, ctx.userRoles)) {
      await respond(ctx.bot, ctx.interaction, "You don't have permission to edit this entity", true);
      return;
    }

    await executeEdit(ctx, entity, editType);
  },
});

/**
 * Execute the /edit body given a resolved, permission-checked entity.
 * Shared between the /edit slash command and the "Edit Entity" message context menu.
 * NOTE: This sends a modal, so the interaction must NOT be deferred before calling.
 */
export async function executeEdit(
  ctx: CommandContext,
  entity: EntityWithFacts,
  editType = "both",
): Promise<void> {
    // Discord modal: max 5 text inputs, 4000 chars each
    const MAX_FIELD_LENGTH = 4000;
    const MAX_FIELDS = 5;

    const fields: Array<{
      customId: string;
      label: string;
      style: number;
      value?: string;
      required?: boolean;
      placeholder?: string;
    }> = [];

    if (editType === "template") {
      // Template editing - single text area, no name field
      const currentTemplate = getEntityTemplate(entity.id) ?? "";

      if (currentTemplate.length > MAX_FIELD_LENGTH * MAX_FIELDS) {
        await respond(ctx.bot, ctx.interaction,
          `Template is too long to edit via modal (${currentTemplate.length}/${MAX_FIELD_LENGTH * MAX_FIELDS} chars).`,
          true
        );
        return;
      }

      const chunks = currentTemplate ? chunkContent(currentTemplate, MAX_FIELD_LENGTH) : [];
      const templateFields = chunks.length > 0
        ? chunks.map((chunk, i) => ({
            customId: `template${i}`,
            label: chunks.length === 1 ? "Template" : `Template (part ${i + 1}/${chunks.length})`,
            style: TextStyles.Paragraph,
            value: chunk,
            required: false,
          }))
        : [{
            customId: "template0",
            label: "Template",
            style: TextStyles.Paragraph,
            value: "",
            required: false,
            placeholder: "Custom system prompt template (Nunjucks-like syntax)",
          }];

      await respondWithModal(ctx.bot, ctx.interaction, `edit-template:${entity.id}`, `Edit Template: ${entity.name}`, templateFields);
      return;
    }

    if (editType === "system-template") {
      // System prompt template editing - single text area
      const currentTemplate = getEntitySystemTemplate(entity.id) ?? "";
      const MAX_SYS_FIELD_LENGTH = 4000;
      const MAX_SYS_FIELDS = 5;

      if (currentTemplate.length > MAX_SYS_FIELD_LENGTH * MAX_SYS_FIELDS) {
        await respond(ctx.bot, ctx.interaction,
          `System prompt template is too long to edit via modal (${currentTemplate.length}/${MAX_SYS_FIELD_LENGTH * MAX_SYS_FIELDS} chars).`,
          true
        );
        return;
      }

      const chunks = currentTemplate ? chunkContent(currentTemplate, MAX_SYS_FIELD_LENGTH) : [];
      const sysFields = chunks.length > 0
        ? chunks.map((chunk, i) => ({
            customId: `systemtemplate${i}`,
            label: chunks.length === 1 ? "System Prompt" : `System Prompt (part ${i + 1}/${chunks.length})`,
            style: TextStyles.Paragraph,
            value: chunk,
            required: false,
          }))
        : [{
            customId: "systemtemplate0",
            label: "System Prompt",
            style: TextStyles.Paragraph,
            value: "",
            required: false,
            placeholder: "Per-entity system prompt (Nunjucks syntax). Empty = use default.",
          }];

      await respondWithModal(ctx.bot, ctx.interaction, `edit-system-template:${entity.id}`, `System Prompt: ${entity.name}`, sysFields);
      return;
    }

    if (editType === "model") {
      // Model & Generation — V2 modal with dropdown + text override + thinking/safety/collapse
      const config = getEntityConfig(entity.id);
      const currentModel = config?.config_model ?? null;
      const availableModels = await getAvailableModels();
      const modelOptions = availableModels.slice(0, 24).map(m => ({
        label: m, value: m, default: m === currentModel,
      }));
      const modelInList = modelOptions.some(o => o.value === currentModel);
      if (currentModel && !modelInList) {
        modelOptions.unshift({ label: currentModel, value: currentModel, default: true });
        modelOptions.splice(25);
      }

      const currentCollapseRoles = new Set(
        (config?.config_collapse ?? "").split(/\s+/).filter(Boolean)
      );

      const modelLabels = [
        {
          type: MessageComponentTypes.Label,
          label: "Model",
          description: "Pick from available models",
          component: {
            type: MessageComponentTypes.StringSelect,
            customId: "model_select",
            minValues: 0,
            maxValues: 1,
            required: false,
            placeholder: modelOptions.length > 0 ? "Select a model…" : "No models fetched — use field below",
            options: modelOptions.length > 0 ? modelOptions : [{ label: "—", value: "none" }],
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Custom model (overrides selection)",
          description: "provider:model — takes priority over the dropdown",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "model_custom",
            style: TextStyles.Short,
            value: currentModel && !modelInList ? currentModel : undefined,
            required: false,
            placeholder: "google:gemini-2.5-flash",
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Thinking Level",
          description: "Extended thinking for supported models (e.g. Claude)",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "thinking",
            style: TextStyles.Short,
            value: config?.config_thinking || undefined,
            required: false,
            placeholder: "minimal, low, medium, high",
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Content Filters",
          description: "Safety filter for all categories (e.g. off, channel.is_nsfw). Per-category: use $safety in facts.",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "safety",
            style: TextStyles.Short,
            value: config?.config_safety || undefined,
            required: false,
            placeholder: "off, channel.is_nsfw, false (clear), ...",
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Collapse Adjacent Messages",
          description: "Which roles to merge when consecutive messages share the same role",
          component: {
            type: MessageComponentTypes.StringSelect,
            customId: "collapse",
            minValues: 0,
            maxValues: 4,
            required: false,
            placeholder: "All roles (default)",
            options: [
              { label: "None (disable all merging)", value: "none", default: currentCollapseRoles.has("none") },
              { label: "User messages", value: "user", default: currentCollapseRoles.has("user") },
              { label: "Assistant messages", value: "assistant", default: currentCollapseRoles.has("assistant") },
              { label: "System messages", value: "system", default: currentCollapseRoles.has("system") },
            ],
          },
        },
      ];

      await respondWithV2Modal(ctx.bot, ctx.interaction, `edit-model:${entity.id}`, `Model: ${entity.name}`, modelLabels);
      return;
    }

    if (editType === "context" || editType === "config") {
      // Context & Memory — replaces old edit-config
      const config = getEntityConfig(entity.id);

      let streamDisplay = "";
      if (config?.config_stream_mode) {
        streamDisplay = config.config_stream_mode;
        if (config.config_stream_delimiters) {
          try {
            const delims = JSON.parse(config.config_stream_delimiters) as string[];
            streamDisplay += " " + delims.map(d =>
              `"${d.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r")}"`
            ).join(" ");
          } catch {
            streamDisplay += " " + config.config_stream_delimiters;
          }
        }
      }

      // Deserialize strip patterns for display
      let stripDisplay = "";
      if (config?.config_strip) {
        try {
          const patterns = JSON.parse(config.config_strip) as string[];
          stripDisplay = patterns.join("\n");
        } catch {
          stripDisplay = config.config_strip;
        }
      }

      const currentMemory = config?.config_memory ?? "none";

      const contextLabels = [
        {
          type: MessageComponentTypes.Label,
          label: "Context",
          description: "Limit how many past messages are included (chars < N or count < N)",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "context",
            style: TextStyles.Short,
            value: config?.config_context || undefined,
            required: false,
            placeholder: "chars < 4000 || count < 20",
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "RAG Context",
          description: "Which recent messages to use as memory retrieval queries",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "rag_context",
            style: TextStyles.Short,
            value: config?.config_rag_context || undefined,
            required: false,
            placeholder: "count <= 10",
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Memory Scope",
          description: "Where entity memories are stored and retrieved from",
          component: {
            type: MessageComponentTypes.StringSelect,
            customId: "memory",
            minValues: 0,
            maxValues: 1,
            required: false,
            placeholder: "None (default)",
            options: [
              { label: "None", value: "none", default: currentMemory === "none" || !currentMemory },
              { label: "Channel", value: "channel", default: currentMemory === "channel" },
              { label: "Guild", value: "guild", default: currentMemory === "guild" },
              { label: "Global", value: "global", default: currentMemory === "global" },
            ],
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Stream",
          description: "Controls streaming output mode and delimiters",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "stream",
            style: TextStyles.Short,
            value: streamDisplay || undefined,
            required: false,
            placeholder: 'lines, full, full "\\n", "delimiter"',
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Strip Patterns",
          description: "Patterns to strip from responses (one per line, /regex/ supported)",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "strip",
            style: TextStyles.Paragraph,
            value: stripDisplay || undefined,
            required: false,
            placeholder: "/^Name: /\nsome literal text",
          },
        },
      ];

      await respondWithV2Modal(ctx.bot, ctx.interaction, `edit-context:${entity.id}`, `Context: ${entity.name}`, contextLabels);
      return;
    }

    if (editType === "identity") {
      // Identity — nickname, avatar, keywords, respond, freeform
      const config = getEntityConfig(entity.id);
      const currentRespond = config?.config_respond ?? null;
      const currentFreeform = config?.config_freeform ?? 0;

      const identityLabels = [
        {
          type: MessageComponentTypes.Label,
          label: "Nickname (for disambiguation)",
          description: "Short label shown in autocomplete as \"Name (nickname)\" to distinguish entities with the same name",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "nickname",
            style: TextStyles.Short,
            value: entity.nickname || undefined,
            required: false,
            placeholder: "e.g. Server A, human form, villain",
            maxLength: 50,
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Avatar URL",
          description: "Webhook avatar image URL",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "avatar",
            style: TextStyles.Short,
            value: config?.config_avatar || undefined,
            required: false,
            placeholder: "https://example.com/avatar.png",
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Trigger Keywords",
          description: "Entity responds when any keyword appears in a message. One per line. Use /pattern/flags for regex.",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "keywords",
            style: TextStyles.Paragraph,
            value: config?.config_keywords || undefined,
            required: false,
            placeholder: "hello\ngood morning\n/\\bhey\\b/i",
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Should Respond",
          description: "Override whether this entity responds to messages",
          component: {
            type: MessageComponentTypes.StringSelect,
            customId: "respond",
            minValues: 0,
            maxValues: 1,
            required: false,
            placeholder: "Default (from facts)",
            options: [
              { label: "Default (from facts)", value: "default", default: currentRespond === null },
              { label: "Always", value: "true", default: currentRespond === "true" },
              { label: "Never", value: "false", default: currentRespond === "false" },
            ],
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Freeform Mode",
          description: "Disable structured response parsing",
          component: {
            type: MessageComponentTypes.StringSelect,
            customId: "freeform",
            minValues: 0,
            maxValues: 1,
            required: false,
            placeholder: "Default (disabled)",
            options: [
              { label: "Default (disabled)", value: "default", default: !currentFreeform },
              { label: "Enabled", value: "1", default: !!currentFreeform },
            ],
          },
        },
      ];

      await respondWithV2Modal(ctx.bot, ctx.interaction, `edit-identity:${entity.id}`, `Identity: ${entity.name}`, identityLabels);
      return;
    }

    if (editType === "advanced") {
      // Advanced — queue and rate limit only
      const config = getEntityConfig(entity.id);

      const advancedLabels = [
        {
          type: MessageComponentTypes.Label,
          label: "Response Queue",
          description: "Skip the per-channel response queue (power users only — may cause context races)",
          component: {
            type: MessageComponentTypes.StringSelect,
            customId: "queue_disabled",
            minValues: 0,
            maxValues: 1,
            required: false,
            placeholder: "Enabled (default)",
            options: [
              { label: "Disabled (skip queue)", value: "1", default: config?.config_queue_disabled === 1 },
            ],
          },
        },
        {
          type: MessageComponentTypes.Label,
          label: "Rate Per Minute",
          description: "Maximum responses per minute (blank = no limit)",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "rate_per_min",
            style: TextStyles.Short,
            value: config?.config_rate_per_min != null ? String(config.config_rate_per_min) : undefined,
            required: false,
            placeholder: "e.g. 10 (blank to clear)",
          },
        },
      ];

      await respondWithV2Modal(ctx.bot, ctx.interaction, `edit-advanced:${entity.id}`, `Advanced: ${entity.name}`, advancedLabels);
      return;
    }

    if (editType === "permissions") {
      // Permissions editing — V2 modal with mentionable select menus
      const labels = buildPermissionsLabels(entity.id, entity.owned_by ?? "");
      await respondWithV2Modal(ctx.bot, ctx.interaction, `edit-permissions:${entity.id}`, `Permissions: ${entity.name}`, labels);
      return;
    }

    if (editType === "both") {
      const factsContent = entity.facts.map(f => f.content).join("\n");
      const memoriesContent = getMemoriesForEntity(entity.id).map(m => m.content).join("\n");

      const factsChunks = factsContent ? chunkContent(factsContent, MAX_FIELD_LENGTH) : [];
      const memoriesChunks = memoriesContent ? chunkContent(memoriesContent, MAX_FIELD_LENGTH) : [];

      // Ensure at least one field each
      if (factsChunks.length === 0) factsChunks.push("");
      if (memoriesChunks.length === 0) memoriesChunks.push("");

      const totalFields = 1 + factsChunks.length + memoriesChunks.length; // 1 for name
      if (totalFields > MAX_FIELDS) {
        await respond(ctx.bot, ctx.interaction,
          `Too much content for combined edit (${totalFields} fields needed, max ${MAX_FIELDS}). ` +
          `Use \`/edit type:facts\` or \`/edit type:memories\` to edit separately.`,
          true
        );
        return;
      }

      // Name field
      fields.push({
        customId: "name",
        label: "Name",
        style: TextStyles.Short,
        value: entity.name,
        required: true,
      });

      // Facts fields
      for (let i = 0; i < factsChunks.length; i++) {
        fields.push({
          customId: `facts${i}`,
          label: factsChunks.length === 1 ? "Facts (one per line)" : `Facts (part ${i + 1}/${factsChunks.length})`,
          style: TextStyles.Paragraph,
          value: factsChunks[i],
          required: false,
        });
      }

      // Memories fields
      for (let i = 0; i < memoriesChunks.length; i++) {
        fields.push({
          customId: `memories${i}`,
          label: memoriesChunks.length === 1 ? "Memories (one per line)" : `Memories (part ${i + 1}/${memoriesChunks.length})`,
          style: TextStyles.Paragraph,
          value: memoriesChunks[i],
          required: false,
          placeholder: memoriesChunks[i] === "" ? "LLM-curated memories (optional)" : undefined,
        });
      }

      await respondWithModal(ctx.bot, ctx.interaction, `edit-both:${entity.id}`, `Edit: ${entity.name}`, fields);
    } else {
      // Single-type edit (facts or memories)
      const currentContent = editType === "memories"
        ? getMemoriesForEntity(entity.id).map(m => m.content).join("\n")
        : entity.facts.map(f => f.content).join("\n");

      if (currentContent.length > MAX_FIELD_LENGTH * MAX_FIELDS) {
        await respond(ctx.bot, ctx.interaction,
          `Entity "${entity.name}" has too much content to edit via modal (${currentContent.length}/${MAX_FIELD_LENGTH * MAX_FIELDS} chars).`,
          true
        );
        return;
      }

      const chunks = currentContent ? chunkContent(currentContent, MAX_FIELD_LENGTH) : [];

      // Name field for renaming (only for facts)
      if (editType === "facts") {
        fields.push({
          customId: "name",
          label: "Name",
          style: TextStyles.Short,
          value: entity.name,
          required: true,
        });
      }

      // Content fields
      const contentLabel = editType === "memories" ? "Memories" : "Facts";
      const contentFields = chunks.map((chunk, i) => ({
        customId: `${editType}${i}`,
        label: chunks.length === 1 ? `${contentLabel} (one per line)` : `${contentLabel} (part ${i + 1}/${chunks.length})`,
        style: TextStyles.Paragraph,
        value: chunk,
        required: false,
      }));

      // If no content, still show one field
      if (contentFields.length === 0) {
        contentFields.push({
          customId: `${editType}0`,
          label: `${contentLabel} (one per line)`,
          style: TextStyles.Paragraph,
          value: "",
          required: false,
        });
      }

      fields.push(...contentFields);

      // Add a blank overflow field if there's a spare slot and the last field has content
      const nameFieldCount = editType === "facts" ? 1 : 0;
      const maxContentFields = MAX_FIELDS - nameFieldCount;
      const lastField = contentFields[contentFields.length - 1];
      if (contentFields.length < maxContentFields && lastField.value) {
        fields.push({
          customId: `${editType}${contentFields.length}`,
          label: `Additional ${contentLabel}`,
          style: TextStyles.Paragraph,
          value: "",
          required: false,
          placeholder: "Add more here (appended to above)",
        });
      }

      const modalId = editType === "memories" ? `edit-memories:${entity.id}` : `edit:${entity.id}`;
      const modalTitle = editType === "memories" ? `Edit Memories: ${entity.name}` : `Edit: ${entity.name}`;
      await respondWithModal(ctx.bot, ctx.interaction, modalId, modalTitle, fields);
    }
}

registerModalHandler("edit", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  // Get new name from modal
  const newName = values.name?.trim();
  if (!newName) {
    await respond(bot, interaction, `Name cannot be empty (received keys: ${Object.keys(values).join(", ")})`, true);
    return;
  }

  // Combine all fact fields (facts0, facts1, etc.)
  const factParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`facts${i}`];
    if (part !== undefined) factParts.push(part);
  }
  const factsText = factParts.join("\n");

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission (defense in depth)
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);

  // Prevent accidentally clearing all facts with empty submission
  if (facts.length === 0) {
    await respond(bot, interaction, "Cannot clear all facts. Use /delete to remove an entity.", true);
    return;
  }

  // Update name if changed
  const nameChanged = newName !== entity.name;
  if (nameChanged) {
    updateEntity(entityId, newName);
  }

  setFacts(entityId, facts);

  const message = nameChanged
    ? `Renamed "${entity.name}" to "${newName}" and updated with ${facts.length} facts`
    : `Updated "${entity.name}" with ${facts.length} facts`;
  await respond(bot, interaction, message, true);
});

registerModalHandler("edit-memories", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  // Combine all memory fields (memories0, memories1, etc.)
  const memoryParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`memories${i}`];
    if (part !== undefined) memoryParts.push(part);
  }
  const memoriesText = memoryParts.join("\n");

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission (defense in depth)
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  const memories = memoriesText.split("\n").map(m => m.trim()).filter(m => m);

  // Update memories (clear and replace)
  await setMemories(entityId, memories);

  await respond(bot, interaction, `Updated "${entity.name}" with ${memories.length} memories`, true);
});

registerModalHandler("edit-template", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  // Combine all template fields (template0, template1, etc.)
  const templateParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`template${i}`];
    if (part !== undefined) templateParts.push(part);
  }
  const templateText = templateParts.join("\n").trim();

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission (defense in depth)
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  // Empty/blank = clear template (revert to default)
  if (!templateText) {
    setEntityTemplate(entityId, null);
    await respond(bot, interaction, `Cleared template for "${entity.name}" (using default formatting)`, true);
    return;
  }

  // Save template
  setEntityTemplate(entityId, templateText);
  await respond(bot, interaction, `Updated template for "${entity.name}" (${templateText.length} chars)`, true);
});

registerModalHandler("edit-system-template", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  // Combine all system template fields
  const templateParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`systemtemplate${i}`];
    if (part !== undefined) templateParts.push(part);
  }
  const templateText = templateParts.join("\n").trim();

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission (defense in depth)
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  // Empty/blank = clear template (revert to default)
  if (!templateText) {
    setEntitySystemTemplate(entityId, null);
    await respond(bot, interaction, `Cleared system prompt for "${entity.name}" (using default)`, true);
    return;
  }

  // Save system template
  setEntitySystemTemplate(entityId, templateText);
  await respond(bot, interaction, `Updated system prompt for "${entity.name}" (${templateText.length} chars)`, true);
});

registerModalHandler("edit-context", async (bot, interaction, _values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  // Parse V2 components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = interaction.data?.components ?? [];
  const textValues: Record<string, string> = {};
  const selectValues: Record<string, string[]> = {};
  for (const comp of components) {
    const inner = comp.component;
    if (!inner?.customId) continue;
    if (inner.value !== undefined) textValues[inner.customId] = inner.value;
    else if (inner.values !== undefined) selectValues[inner.customId] = inner.values;
  }

  const context = textValues.context?.trim() || null;
  const ragContext = textValues.rag_context?.trim() || null;

  // Memory: selected option from StringSelect (none/channel/guild/global) or null to clear
  const memorySelected = selectValues.memory?.[0] ?? "";
  const memory = memorySelected && memorySelected !== "none" ? memorySelected : null;

  // Parse stream config: "lines", "full", 'full "\n"', '"delimiter"'
  const streamRaw = textValues.stream?.trim() || "";
  let streamMode: string | null = null;
  let streamDelimiters: string | null = null;

  if (streamRaw) {
    const delimRegex = /"([^"]+)"/g;
    const delims: string[] = [];
    let match;
    while ((match = delimRegex.exec(streamRaw)) !== null) {
      delims.push(match[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\"));
    }
    const modeStr = streamRaw.replace(/"[^"]*"/g, "").trim().toLowerCase();
    if (modeStr === "full" || modeStr === "lines" || modeStr === "") {
      streamMode = modeStr === "" ? "lines" : modeStr;
    } else {
      streamMode = modeStr;
    }
    if (delims.length > 0) {
      streamDelimiters = JSON.stringify(delims);
    }
  }

  // Strip patterns: newline-separated → JSON array; blank → null (clear)
  const stripRaw = textValues.strip?.trim() || "";
  let stripValue: string | null = null;
  if (stripRaw) {
    const patterns = stripRaw.split("\n").map(p => p.trim()).filter(Boolean);
    stripValue = patterns.length > 0 ? JSON.stringify(patterns) : null;
  }

  setEntityConfig(entityId, {
    config_context: context,
    config_rag_context: ragContext,
    config_memory: memory,
    config_stream_mode: streamMode,
    config_stream_delimiters: streamDelimiters,
    config_strip: stripValue,
  });

  const changes: string[] = [];
  if (context) changes.push(`context: ${context}`);
  if (ragContext) changes.push(`rag context: ${ragContext}`);
  if (memory) changes.push(`memory: ${memory}`);
  else changes.push("memory: none");
  if (streamRaw) changes.push(`stream: ${streamRaw}`);
  if (stripValue) changes.push(`strip: ${JSON.parse(stripValue).length} pattern(s)`);
  else if (stripRaw === "") changes.push("strip: cleared");
  if (changes.length === 0) changes.push("all cleared");

  await respond(bot, interaction, `Updated context config for "${entity.name}": ${changes.join(", ")}`, true);
});

// =============================================================================
// Model & Generation Modal Handler
// =============================================================================

registerModalHandler("edit-model", async (bot, interaction, _values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const entity = getEntityWithFacts(entityId);
  if (!entity) { await respond(bot, interaction, "Entity not found", true); return; }

  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  // Parse V2 components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = interaction.data?.components ?? [];
  const textValues: Record<string, string> = {};
  const selectValues: Record<string, string[]> = {};
  for (const comp of components) {
    const inner = comp.component;
    if (!inner?.customId) continue;
    if (inner.value !== undefined) textValues[inner.customId] = inner.value;
    else if (inner.values !== undefined) selectValues[inner.customId] = inner.values;
  }

  const modelCustom = textValues.model_custom?.trim() || null;
  const modelSelectRaw = (selectValues.model_select?.[0] ?? "").trim();
  const modelSelect = modelSelectRaw === "none" ? null : modelSelectRaw || null;
  const model = modelCustom || modelSelect || null;

  const thinking = textValues.thinking?.trim().toLowerCase() || null;
  if (thinking && !["minimal", "low", "medium", "high"].includes(thinking)) {
    await respond(bot, interaction, `Invalid thinking level: "${thinking}". Use: minimal, low, medium, high`, true);
    return;
  }

  const safetyRaw = textValues.safety?.trim() || null;

  const collapseSelected = selectValues.collapse ?? [];
  const collapseRaw = collapseSelected.length === 0
    ? null
    : collapseSelected.includes("none")
      ? "none"
      : collapseSelected.join(" ");

  setEntityConfig(entityId, {
    config_model: model,
    config_thinking: thinking,
    config_safety: safetyRaw,
    config_collapse: collapseRaw,
  });

  const changes: string[] = [];
  if (model) changes.push(`model: ${model}`);
  else changes.push("model: cleared");
  if (thinking) changes.push(`thinking: ${thinking}`);
  if (safetyRaw !== null) changes.push(`safety: ${safetyRaw}`);
  if (collapseRaw !== null) changes.push(`collapse: ${collapseRaw}`);
  await respond(bot, interaction, `Updated model config for "${entity.name}": ${changes.join(", ")}`, true);
});

// =============================================================================
// Identity Modal Handler
// =============================================================================

registerModalHandler("edit-identity", async (bot, interaction, _values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  // Parse V2 components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = interaction.data?.components ?? [];
  const textValues: Record<string, string> = {};
  const selectValues: Record<string, string[]> = {};
  for (const comp of components) {
    const inner = comp.component;
    if (!inner?.customId) continue;
    if (inner.value !== undefined) textValues[inner.customId] = inner.value;
    else if (inner.values !== undefined) selectValues[inner.customId] = inner.values;
  }

  const nickname = textValues.nickname?.trim() || null;
  const avatar = textValues.avatar?.trim() || null;

  // Validate and normalize keywords (reject invalid regex patterns)
  const keywordsRaw = textValues.keywords?.trim() || null;
  let keywordsNormalized: string | null = null;
  if (keywordsRaw !== null) {
    const lines = keywordsRaw.split("\n").map(k => k.trim()).filter(Boolean);
    const invalidPatterns: string[] = [];
    for (const kw of lines) {
      const regexMatch = kw.match(/^\/(.+)\/([gimsuy]*)$/);
      if (regexMatch) {
        try {
          checkKeywordMatch([kw], "");
        } catch {
          invalidPatterns.push(kw);
        }
      }
    }
    if (invalidPatterns.length > 0) {
      await respond(bot, interaction, `Invalid regex pattern(s): ${invalidPatterns.map(p => `\`${p}\``).join(", ")}`, true);
      return;
    }
    keywordsNormalized = lines.length > 0 ? lines.join("\n") : null;
  }

  const respondSelected = selectValues.respond?.[0] ?? "";
  const configRespond: string | null =
    respondSelected === "true" ? "true" :
    respondSelected === "false" ? "false" :
    null;

  const freeformSelected = selectValues.freeform?.[0] ?? "";
  const configFreeform: number = freeformSelected === "1" ? 1 : 0;

  setEntityNickname(entityId, nickname);
  setEntityConfig(entityId, {
    config_avatar: avatar,
    config_keywords: keywordsNormalized,
    config_respond: configRespond,
    config_freeform: configFreeform,
  });

  const changes: string[] = [];
  if (nickname) changes.push(`nickname: "${nickname}"`);
  else changes.push("nickname: cleared");
  if (avatar) changes.push("avatar: set");
  else changes.push("avatar: cleared");
  if (keywordsNormalized !== null) changes.push(`keywords: ${keywordsNormalized.split("\n").length} set`);
  else if (keywordsRaw !== null) changes.push("keywords: cleared");
  if (configRespond !== null) changes.push(`respond: ${configRespond}`);
  else changes.push("respond: default");
  changes.push(`freeform: ${configFreeform ? "enabled" : "disabled"}`);

  await respond(bot, interaction, `Updated identity config for "${entity.name}": ${changes.join(", ")}`, true);
});

// =============================================================================
// Advanced Config Modal Handler
// =============================================================================

registerModalHandler("edit-advanced", async (bot, interaction, _textValues) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  // Parse V2 components: Label (type 18) wraps inner .component (TextInput or StringSelect)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = interaction.data?.components ?? [];
  const textValues: Record<string, string> = {};
  const selectValues: Record<string, string[]> = {};
  for (const comp of components) {
    const inner = comp.component;
    if (!inner?.customId) continue;
    if (inner.value !== undefined) {
      textValues[inner.customId] = inner.value;
    } else if (inner.values !== undefined) {
      selectValues[inner.customId] = inner.values;
    }
  }

  const queueDisabledSelected = selectValues.queue_disabled ?? [];
  const queueDisabled = queueDisabledSelected.includes("1") ? 1 : 0;

  const ratePerMinRaw = textValues.rate_per_min?.trim() || "";
  const ratePerMin: number | null = ratePerMinRaw ? (parseInt(ratePerMinRaw) || null) : null;

  setEntityConfig(entityId, {
    config_queue_disabled: queueDisabled,
    config_rate_per_min: ratePerMin,
  });

  const changes: string[] = [];
  if (queueDisabled === 1) changes.push("queue: disabled");
  else changes.push("queue: enabled");
  if (ratePerMin !== null) changes.push(`rate: ${ratePerMin}/min`);
  else changes.push("rate: unlimited");

  await respond(bot, interaction, `Updated advanced config for "${entity.name}": ${changes.join(", ")}`, true);
});

// =============================================================================
// Permissions Modal Handler (V2 Modal with Mentionable Selects)
// =============================================================================

registerModalHandler("edit-permissions", async (bot, interaction, _values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  // Parse V2 components: Labels (type 18) wrap selects with .component (singular)
  // Also handle ActionRow fallback (.components plural) for forward compatibility
  const resolved = interaction.data?.resolved;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = interaction.data?.components ?? [];

  const selectValues: Record<string, string[]> = {};
  for (const comp of components) {
    // Label (type 18): has `component` (singular) with the nested select
    const inner = comp.component;
    if (inner?.customId) {
      selectValues[inner.customId] = inner.values ?? [];
    }
    // ActionRow fallback: has `components` (plural)
    for (const child of comp.components ?? []) {
      if (child.customId && child.values) {
        selectValues[child.customId] = child.values;
      }
    }
  }

  // Save all fields
  for (const field of PERM_FIELDS) {
    const values = selectValues[`perm_${field}`] ?? [];
    const entries = buildEntries(values, resolved as ResolvedData | undefined);
    const configKey = PERM_CONFIG_KEYS[field];

    if (field === "blacklist" || field === "delete") {
      // blacklist: null = no blacklist; delete: null = owner-only (not @everyone)
      setEntityConfig(entityId, {
        [configKey]: entries.length > 0 ? JSON.stringify(entries) : null,
      });
    } else {
      setEntityConfig(entityId, {
        [configKey]: entries.length > 0 ? JSON.stringify(entries) : JSON.stringify("@everyone"),
      });
    }
  }

  await respond(bot, interaction, `Updated permissions for "${entity.name}"`, true);
});

registerModalHandler("edit-both", async (bot, interaction, values) => {
  const customId = interaction.data?.customId ?? "";
  const entityId = parseInt(customId.split(":")[1]);

  const newName = values.name?.trim();
  if (!newName) {
    await respond(bot, interaction, `Name cannot be empty (received keys: ${Object.keys(values).join(", ")})`, true);
    return;
  }

  // Combine fact fields (facts0, facts1, etc.)
  const factParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`facts${i}`];
    if (part !== undefined) factParts.push(part);
  }
  const factsText = factParts.join("\n");

  // Combine memory fields (memories0, memories1, etc.)
  const memoryParts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const part = values[`memories${i}`];
    if (part !== undefined) memoryParts.push(part);
  }
  const memoriesText = memoryParts.join("\n");

  const entity = getEntityWithFacts(entityId);
  if (!entity) {
    await respond(bot, interaction, "Entity not found", true);
    return;
  }

  // Check edit permission (defense in depth)
  const userId = interaction.user?.id?.toString() ?? "";
  const username = interaction.user?.username ?? "";
  if (!canUserEdit(entity, userId, username)) {
    await respond(bot, interaction, "You don't have permission to edit this entity", true);
    return;
  }

  const facts = factsText.split("\n").map(f => f.trim()).filter(f => f);
  const memories = memoriesText.split("\n").map(m => m.trim()).filter(m => m);

  // Prevent accidentally clearing all facts
  if (facts.length === 0) {
    await respond(bot, interaction, "Cannot clear all facts. Use /delete to remove an entity.", true);
    return;
  }

  // Update name if changed
  const nameChanged = newName !== entity.name;
  if (nameChanged) {
    updateEntity(entityId, newName);
  }

  setFacts(entityId, facts);
  await setMemories(entityId, memories);

  const namePart = nameChanged ? `Renamed "${entity.name}" to "${newName}", updated` : `Updated "${entity.name}"`;
  await respond(bot, interaction, `${namePart} with ${facts.length} facts and ${memories.length} memories`, true);
});
