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
  getPermissionDefaults,
  addFact,
  removeFactByContent,
  setFacts,
  updateEntity,
} from "../../db/entities";
import {
  getMemoriesForEntity,
  setMemories,
} from "../../db/memories";
import { parseSafetyDirective, checkKeywordMatch } from "../../logic/expr";
import { chunkContent, buildDefaultValues, buildEntries, type ResolvedData } from "./helpers";
import { canUserEdit } from "./cmd-permissions";

// =============================================================================
// Permissions UI Helpers (V2 Modal with Mentionable Selects)
// =============================================================================

const PERM_FIELDS = ["view", "edit", "use", "blacklist"] as const;
type PermField = (typeof PERM_FIELDS)[number];

const PERM_LABELS: Record<PermField, string> = {
  view: "View",
  edit: "Edit",
  use: "Trigger",
  blacklist: "Blacklist",
};

const PERM_DESCRIPTIONS: Record<PermField, string> = {
  view: "Blank means anyone can view",
  edit: "Blank means anyone can edit",
  use: "Blank means anyone can trigger",
  blacklist: "Blocked from viewing, editing, and triggering",
};

const PERM_CONFIG_KEYS: Record<PermField, string> = {
  view: "config_view",
  edit: "config_edit",
  use: "config_use",
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

    // For view/edit, null means owner-only — pre-populate with owner
    let defaultValues: Array<{ id: string; type: "user" | "role" }>;
    if (value === null && (field === "view" || field === "edit")) {
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
        { name: "Facts only", value: "facts" },
        { name: "Memories only", value: "memories" },
        { name: "Template", value: "template" },
        { name: "System Prompt", value: "system-template" },
        { name: "Config", value: "config" },
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

    if (editType === "config") {
      // Config editing - 5 text fields for entity settings
      const config = getEntityConfig(entity.id);

      // Format stream config for display
      let streamDisplay = "";
      if (config?.config_stream_mode) {
        streamDisplay = config.config_stream_mode;
        if (config.config_stream_delimiters) {
          try {
            const delims = JSON.parse(config.config_stream_delimiters) as string[];
            streamDisplay += " " + delims.map(d => `"${d}"`).join(" ");
          } catch {
            // Corrupted delimiter data — show raw value for manual fix
            streamDisplay += " " + config.config_stream_delimiters;
          }
        }
      }

      const configFields = [
        {
          customId: "model",
          label: "Model",
          style: TextStyles.Short,
          value: config?.config_model ?? "",
          required: false,
          placeholder: "provider:model (e.g. google:gemini-3-flash-preview)",
        },
        {
          customId: "context",
          label: "Context",
          style: TextStyles.Short,
          value: config?.config_context ?? "",
          required: false,
          placeholder: "chars < 4000 || count < 20",
        },
        {
          customId: "stream",
          label: "Stream",
          style: TextStyles.Short,
          value: streamDisplay,
          required: false,
          placeholder: 'lines, full, full "\\n", "delimiter"',
        },
        {
          customId: "avatar",
          label: "Avatar URL",
          style: TextStyles.Short,
          value: config?.config_avatar ?? "",
          required: false,
          placeholder: "https://example.com/avatar.png",
        },
        {
          customId: "memory",
          label: "Memory scope",
          style: TextStyles.Short,
          value: config?.config_memory ?? "",
          required: false,
          placeholder: "none, channel, guild, global",
        },
      ];

      await respondWithModal(ctx.bot, ctx.interaction, `edit-config:${entity.id}`, `Config: ${entity.name}`, configFields);
      return;
    }

    if (editType === "advanced") {
      // Advanced config editing — V2 modal with Label components
      const config = getEntityConfig(entity.id);

      // Pre-select current collapse roles
      const currentCollapseRoles = new Set(
        (config?.config_collapse ?? "").split(/\s+/).filter(Boolean)
      );

      // Pre-populate safety filter from entity facts: find the first all-categories $safety fact
      const safetyFact = entity.facts.find(f => {
        const c = f.content.trim();
        const parsed = parseSafetyDirective(c);
        return parsed !== null && parsed.category === "all";
      });
      const safetyValue = safetyFact
        ? safetyFact.content.trim().slice("$safety".length).trim()
        : "";

      const advancedLabels = [
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
        {
          type: MessageComponentTypes.Label,
          label: "Content Filters",
          description: "Safety filter for all categories (e.g. off, channel.is_nsfw). Per-category: use $safety in facts.",
          component: {
            type: MessageComponentTypes.TextInput,
            customId: "safety",
            style: TextStyles.Short,
            value: safetyValue || undefined,
            required: false,
            placeholder: "off, channel.is_nsfw, false (clear), ...",
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
  },
});

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

registerModalHandler("edit-config", async (bot, interaction, values) => {
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

  const model = values.model?.trim() || null;
  const context = values.context?.trim() || null;
  const avatar = values.avatar?.trim() || null;
  const memory = values.memory?.trim() || null;

  // Parse stream config: "lines", "full", 'full "\n"', '"delimiter"'
  const streamRaw = values.stream?.trim() || "";
  let streamMode: string | null = null;
  let streamDelimiters: string | null = null;

  if (streamRaw) {
    // Extract quoted delimiters
    const delimRegex = /"([^"]+)"/g;
    const delims: string[] = [];
    let match;
    while ((match = delimRegex.exec(streamRaw)) !== null) {
      // Process escape sequences
      delims.push(match[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\"));
    }

    // Extract mode (text before first quote, or the whole string if no quotes)
    const modeStr = streamRaw.replace(/"[^"]*"/g, "").trim().toLowerCase();

    if (modeStr === "full" || modeStr === "lines" || modeStr === "") {
      streamMode = modeStr || (delims.length > 0 ? "lines" : "lines");
      if (modeStr === "") streamMode = "lines";
    } else {
      streamMode = modeStr;
    }

    if (delims.length > 0) {
      streamDelimiters = JSON.stringify(delims);
    }
  }

  // Validate memory scope
  if (memory && !["none", "channel", "guild", "global"].includes(memory)) {
    await respond(bot, interaction, `Invalid memory scope: "${memory}". Use: none, channel, guild, global`, true);
    return;
  }

  setEntityConfig(entityId, {
    config_model: model,
    config_context: context,
    config_stream_mode: streamMode,
    config_stream_delimiters: streamDelimiters,
    config_avatar: avatar,
    config_memory: memory,
  });

  const changes: string[] = [];
  if (model) changes.push(`model: ${model}`);
  if (context) changes.push(`context: ${context}`);
  if (streamRaw) changes.push(`stream: ${streamRaw}`);
  if (avatar) changes.push("avatar: set");
  if (memory) changes.push(`memory: ${memory}`);
  if (changes.length === 0) changes.push("all cleared");

  await respond(bot, interaction, `Updated config for "${entity.name}": ${changes.join(", ")}`, true);
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

  const thinking = textValues.thinking?.trim().toLowerCase() || null;

  // Validate thinking level
  if (thinking && !["minimal", "low", "medium", "high"].includes(thinking)) {
    await respond(bot, interaction, `Invalid thinking level: "${thinking}". Use: minimal, low, medium, high`, true);
    return;
  }

  // Collapse: selected options from StringSelect (empty = no override / use default)
  const collapseSelected = selectValues.collapse ?? [];
  // "none" takes precedence; otherwise join selected roles; empty = clear config (null = use default = all)
  const collapseRaw = collapseSelected.length === 0
    ? null
    : collapseSelected.includes("none")
      ? "none"
      : collapseSelected.join(" ");

  // Safety filters: remove all all-category $safety facts, add new $safety fact if non-empty
  const safetyRaw = textValues.safety?.trim() || null;
  const existingFacts = entity.facts.map(f => f.content);
  for (const fc of existingFacts) {
    const parsed = parseSafetyDirective(fc.trim());
    if (parsed !== null && parsed.category === "all") {
      removeFactByContent(entityId, fc);
    }
  }
  if (safetyRaw !== null) {
    addFact(entityId, `$safety ${safetyRaw}`);
  }

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

  setEntityConfig(entityId, {
    config_thinking: thinking,
    config_collapse: collapseRaw,
    config_keywords: keywordsNormalized,
  });

  const changes: string[] = [];
  if (thinking) changes.push(`thinking: ${thinking}`);
  if (collapseRaw) changes.push(`collapse: ${collapseRaw}`);
  if (safetyRaw !== null) changes.push(`safety: ${safetyRaw}`);
  if (keywordsNormalized !== null) changes.push(`keywords: ${keywordsNormalized.split("\n").length} set`);
  else if (keywordsRaw !== null) changes.push("keywords: cleared");
  if (changes.length === 0) changes.push("all cleared");

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

    if (field === "blacklist") {
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
