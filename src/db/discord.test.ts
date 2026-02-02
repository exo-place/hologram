import { describe, expect, test } from "bun:test";
import { parseMessageData, type MessageData, type EmbedData, type AttachmentData, type StickerData } from "./discord";

describe("parseMessageData", () => {
  test("null input returns null", () => {
    expect(parseMessageData(null)).toBeNull();
  });

  test("empty string returns null", () => {
    expect(parseMessageData("")).toBeNull();
  });

  test("invalid JSON returns null", () => {
    expect(parseMessageData("{bad json")).toBeNull();
    expect(parseMessageData("undefined")).toBeNull();
    expect(parseMessageData("not json at all")).toBeNull();
  });

  test("empty object parses", () => {
    expect(parseMessageData("{}")).toEqual({});
  });

  test("is_bot flag", () => {
    const result = parseMessageData('{"is_bot":true}');
    expect(result).toEqual({ is_bot: true });
  });

  test("full embed object", () => {
    const embed: EmbedData = {
      title: "Test Embed",
      type: "rich",
      description: "A description",
      url: "https://example.com",
      timestamp: 1700000000000,
      color: 0xFF0000,
      footer: { text: "Footer text", icon_url: "https://example.com/icon.png" },
      image: { url: "https://example.com/image.png", height: 100, width: 200 },
      thumbnail: { url: "https://example.com/thumb.png", height: 50, width: 50 },
      video: { url: "https://example.com/video.mp4", height: 720, width: 1280 },
      provider: { name: "YouTube", url: "https://youtube.com" },
      author: { name: "Author", url: "https://example.com/author", icon_url: "https://example.com/author.png" },
      fields: [
        { name: "Field 1", value: "Value 1", inline: true },
        { name: "Field 2", value: "Value 2" },
      ],
    };
    const data: MessageData = { embeds: [embed] };
    const result = parseMessageData(JSON.stringify(data));
    expect(result).toEqual(data);
    expect(result!.embeds![0].footer!.text).toBe("Footer text");
    expect(result!.embeds![0].image!.width).toBe(200);
    expect(result!.embeds![0].fields![0].inline).toBe(true);
    expect(result!.embeds![0].fields![1].inline).toBeUndefined();
  });

  test("sparse embed with only some fields", () => {
    const data: MessageData = {
      embeds: [
        { description: "Just a description" },
        { title: "Just a title", fields: [] },
        { image: { url: "https://example.com/img.png" } },
      ],
    };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.embeds!.length).toBe(3);
    expect(result!.embeds![0].title).toBeUndefined();
    expect(result!.embeds![0].description).toBe("Just a description");
    expect(result!.embeds![1].description).toBeUndefined();
    expect(result!.embeds![2].image!.url).toBe("https://example.com/img.png");
  });

  test("full attachment object", () => {
    const attachment: AttachmentData = {
      filename: "photo.png",
      url: "https://cdn.example.com/photo.png",
      content_type: "image/png",
      title: "My Photo",
      description: "A nice photo",
      size: 123456,
      height: 1080,
      width: 1920,
      ephemeral: false,
      duration_secs: undefined,
    };
    const data: MessageData = { attachments: [attachment] };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.attachments![0].filename).toBe("photo.png");
    expect(result!.attachments![0].size).toBe(123456);
    expect(result!.attachments![0].height).toBe(1080);
    expect(result!.attachments![0].width).toBe(1920);
    expect(result!.attachments![0].description).toBe("A nice photo");
  });

  test("voice message attachment with duration", () => {
    const data: MessageData = {
      attachments: [{
        filename: "voice-message.ogg",
        url: "https://cdn.example.com/voice.ogg",
        content_type: "audio/ogg",
        size: 54321,
        duration_secs: 12.5,
      }],
    };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.attachments![0].duration_secs).toBe(12.5);
  });

  test("sticker data", () => {
    const sticker: StickerData = {
      id: "123456789",
      name: "wave",
      format_type: 1, // PNG
    };
    const data: MessageData = { stickers: [sticker] };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.stickers![0].id).toBe("123456789");
    expect(result!.stickers![0].name).toBe("wave");
    expect(result!.stickers![0].format_type).toBe(1);
  });

  test("combined embeds, stickers, and attachments", () => {
    const data: MessageData = {
      is_bot: true,
      embeds: [{ title: "An Embed", type: "rich" }],
      stickers: [{ id: "999", name: "smile", format_type: 4 }],
      attachments: [{ filename: "doc.pdf", url: "https://example.com/doc.pdf", content_type: "application/pdf", size: 1024 }],
    };
    const result = parseMessageData(JSON.stringify(data));
    expect(result!.is_bot).toBe(true);
    expect(result!.embeds!.length).toBe(1);
    expect(result!.stickers!.length).toBe(1);
    expect(result!.attachments!.length).toBe(1);
    expect(result!.embeds![0].title).toBe("An Embed");
    expect(result!.stickers![0].format_type).toBe(4); // GIF
    expect(result!.attachments![0].content_type).toBe("application/pdf");
  });

  test("legacy data without new fields still parses", () => {
    // Old format from before the expanded types
    const legacy = JSON.stringify({
      is_bot: true,
      embeds: [{ title: "Old", description: "embed" }],
      attachments: [{ filename: "f.txt", url: "https://x.com/f.txt" }],
    });
    const result = parseMessageData(legacy);
    expect(result!.embeds![0].title).toBe("Old");
    expect(result!.embeds![0].type).toBeUndefined();
    expect(result!.embeds![0].color).toBeUndefined();
    expect(result!.attachments![0].filename).toBe("f.txt");
    expect(result!.attachments![0].size).toBeUndefined();
    expect(result!.attachments![0].height).toBeUndefined();
  });
});
