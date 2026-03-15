import type { DiscordEmbed } from "@discordeno/types";
import type { EmbedData, DiscordComponentData, MessageData } from "../db/discord";
import type { bot } from "./client";

/** Element type of the array returned by bot.helpers.getMessages. */
export type BotMessage = Awaited<ReturnType<typeof bot.helpers.getMessages>>[number];

/** Extract content (with forwarded snapshot handling) and structured data from a message.
 * Used by both messageCreate and the catch-up backfill path. */
export function buildMsgDataAndContent(message: BotMessage): { content: string; msgData: MessageData | undefined } {
  let content = message.content ?? "";
  const hasSnapshots = (message.messageSnapshots?.length ?? 0) > 0;

  if (hasSnapshots) {
    const snapshotParts: string[] = [];
    for (const snap of message.messageSnapshots!) {
      if (snap.message.content) snapshotParts.push(snap.message.content);
    }
    if (snapshotParts.length > 0) {
      const forwarded = snapshotParts.join("\n");
      content = content ? `${content}\n${forwarded}` : forwarded;
    }
  }

  const isBot = !!message.author.toggles?.bot;
  const isForward = hasSnapshots;
  const allEmbeds = [
    ...(message.embeds ?? []),
    ...(message.messageSnapshots?.flatMap(s => s.message.embeds ?? []) ?? []),
  ];
  const allAttachments = [
    ...(message.attachments ?? []),
    ...(message.messageSnapshots?.flatMap(s => s.message.attachments ?? []) ?? []),
  ];
  const allStickers = [
    ...(message.stickerItems ?? []),
    ...(message.messageSnapshots?.flatMap(s => s.message.stickerItems ?? []) ?? []),
  ];
  const hasComponents = (message.components?.length ?? 0) > 0;

  const msgData: MessageData = {};
  if (isBot) msgData.is_bot = true;
  if (isForward) msgData.is_forward = true;
  if (allEmbeds.length > 0) msgData.embeds = allEmbeds.map(serializeEmbed);
  if (allStickers.length > 0) {
    msgData.stickers = allStickers.map(s => ({
      id: s.id.toString(),
      name: s.name,
      format_type: s.formatType ?? 0,
    }));
  }
  if (allAttachments.length > 0) {
    msgData.attachments = allAttachments.map(a => ({
      filename: a.filename ?? "unknown",
      url: a.url ?? "",
      ...(a.contentType && { content_type: a.contentType }),
      ...(a.title && { title: a.title }),
      ...(a.description && { description: a.description }),
      ...(a.size != null && { size: a.size }),
      ...(a.height != null && { height: a.height }),
      ...(a.width != null && { width: a.width }),
      ...(a.ephemeral != null && { ephemeral: a.ephemeral }),
      ...(a.duration_secs != null && { duration_secs: a.duration_secs }),
    }));
  }
  if (hasComponents) msgData.components = serializeComponents(message.components!);

  return { content, msgData: Object.keys(msgData).length > 0 ? msgData : undefined };
}

/** Map Discordeno ChannelTypes enum to human-readable string */
export function channelTypeString(type: number): string {
  switch (type) {
    case 0: return "text";
    case 1: return "dm";
    case 2: return "vc";
    case 3: return "dm";
    case 4: return "category";
    case 5: return "announcement";
    case 10: case 11: case 12: return "thread";
    case 13: return "vc";
    case 14: return "directory";
    case 15: return "forum";
    case 16: return "media";
    default: return "text";
  }
}

/** Map GuildNsfwLevel enum to string */
export function guildNsfwLevelString(level: number): string {
  switch (level) {
    case 0: return "default";
    case 1: return "explicit";
    case 2: return "safe";
    case 3: return "age_restricted";
    default: return "default";
  }
}

/** Serialize Discordeno-transformed components to JSON-friendly storage format.
 * Handles BigInt → string conversion (skuId, attachmentId, defaultValues[].id). */
export function serializeComponents(components: unknown[]): DiscordComponentData[] {
  return JSON.parse(JSON.stringify(components, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  ));
}

/** Serialize a Discordeno Embed to our compact storage format */
export function serializeEmbed(e: { title?: string; type?: string; description?: string; url?: string; timestamp?: number; color?: number; footer?: { text: string; iconUrl?: string }; image?: { url: string; height?: number; width?: number }; thumbnail?: { url: string; height?: number; width?: number }; video?: { url?: string; height?: number; width?: number }; provider?: { name?: string; url?: string }; author?: { name: string; url?: string; iconUrl?: string }; fields?: Array<{ name: string; value: string; inline?: boolean }> }): EmbedData {
  return {
    ...(e.title && { title: e.title }),
    ...(e.type && { type: e.type }),
    ...(e.description && { description: e.description }),
    ...(e.url && { url: e.url }),
    ...(e.timestamp && { timestamp: e.timestamp }),
    ...(e.color != null && { color: e.color }),
    ...(e.footer && { footer: { text: e.footer.text, ...(e.footer.iconUrl && { icon_url: e.footer.iconUrl }) } }),
    ...(e.image && { image: { url: e.image.url, ...(e.image.height != null && { height: e.image.height }), ...(e.image.width != null && { width: e.image.width }) } }),
    ...(e.thumbnail && { thumbnail: { url: e.thumbnail.url, ...(e.thumbnail.height != null && { height: e.thumbnail.height }), ...(e.thumbnail.width != null && { width: e.thumbnail.width }) } }),
    ...(e.video && { video: { ...(e.video.url && { url: e.video.url }), ...(e.video.height != null && { height: e.video.height }), ...(e.video.width != null && { width: e.video.width }) } }),
    ...(e.provider && { provider: { ...(e.provider.name && { name: e.provider.name }), ...(e.provider.url && { url: e.provider.url }) } }),
    ...(e.author && { author: { name: e.author.name, ...(e.author.url && { url: e.author.url }), ...(e.author.iconUrl && { icon_url: e.author.iconUrl }) } }),
    ...(e.fields?.length && { fields: e.fields.map(f => ({ name: f.name, value: f.value, ...(f.inline != null && { inline: f.inline }) })) }),
  };
}

/** Serialize a raw Discord API embed (snake_case) to our storage format */
export function serializeDiscordEmbed(e: DiscordEmbed): EmbedData {
  return {
    ...(e.title && { title: e.title }),
    ...(e.type && { type: e.type }),
    ...(e.description && { description: e.description }),
    ...(e.url && { url: e.url }),
    ...(e.timestamp && { timestamp: Date.parse(e.timestamp) }),
    ...(e.color != null && { color: e.color }),
    ...(e.footer && { footer: { text: e.footer.text, ...(e.footer.icon_url && { icon_url: e.footer.icon_url }) } }),
    ...(e.image && { image: { url: e.image.url, ...(e.image.height != null && { height: e.image.height }), ...(e.image.width != null && { width: e.image.width }) } }),
    ...(e.thumbnail && { thumbnail: { url: e.thumbnail.url, ...(e.thumbnail.height != null && { height: e.thumbnail.height }), ...(e.thumbnail.width != null && { width: e.thumbnail.width }) } }),
    ...(e.video && { video: { ...(e.video.url && { url: e.video.url }), ...(e.video.height != null && { height: e.video.height }), ...(e.video.width != null && { width: e.video.width }) } }),
    ...(e.provider && { provider: { ...(e.provider.name && { name: e.provider.name }), ...(e.provider.url && { url: e.provider.url }) } }),
    ...(e.author && { author: { name: e.author.name, ...(e.author.url && { url: e.author.url }), ...(e.author.icon_url && { icon_url: e.author.icon_url }) } }),
    ...(e.fields?.length && { fields: e.fields.map(f => ({ name: f.name, value: f.value, ...(f.inline != null && { inline: f.inline }) })) }),
  };
}
