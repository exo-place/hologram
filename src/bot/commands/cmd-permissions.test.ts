import { describe, it, expect, beforeEach } from "bun:test";
import { canOwnerReadChannel, clearOwnerChannelCache, type ChannelCheckBot } from "./cmd-permissions";

// ─── Permission bit constants (mirrors cmd-permissions.ts) ───────────────────
const VIEW_CHANNEL = 1n << 10n;            // bit 10
const READ_MESSAGE_HISTORY = 1n << 16n;    // bit 16
const ADMINISTRATOR = 1n << 3n;            // bit 3
const SEND_MESSAGES = 1n << 11n;           // unrelated bit for noise

const GUILD_ID = 100n;
const CHANNEL_ID = 200n;
const OWNER_ID = "300";
const ROLE_A = 400n;   // has VIEW_CHANNEL + READ_MESSAGE_HISTORY
const ROLE_B = 500n;   // has SEND_MESSAGES (no read perms)
const ROLE_ADMIN = 600n;

// ─── Mock factory ────────────────────────────────────────────────────────────

interface MockSetup {
  memberRoles?: bigint[];
  overwrites?: Array<{ id: bigint; type?: number; allow?: bigint; deny?: bigint }>;
  roles?: Array<{ id: bigint; permissions?: bigint }>;
  throwOn?: "getMember" | "getChannel" | "getRoles";
}

function makeBot(setup: MockSetup): ChannelCheckBot {
  return {
    helpers: {
      getMember: async (guildId: bigint, userId: bigint) => {
        void guildId; void userId;
        if (setup.throwOn === "getMember") throw new Error("API error");
        return { roles: setup.memberRoles ?? [] };
      },
      getChannel: async (channelId: bigint) => {
        void channelId;
        if (setup.throwOn === "getChannel") throw new Error("API error");
        return { permissionOverwrites: setup.overwrites ?? [] };
      },
      getRoles: async (guildId: bigint) => {
        void guildId;
        if (setup.throwOn === "getRoles") throw new Error("API error");
        return setup.roles ?? [
          { id: GUILD_ID, permissions: 0n },          // @everyone: no perms
          { id: ROLE_A, permissions: VIEW_CHANNEL | READ_MESSAGE_HISTORY | SEND_MESSAGES },
          { id: ROLE_B, permissions: SEND_MESSAGES },
          { id: ROLE_ADMIN, permissions: ADMINISTRATOR },
        ];
      },
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("canOwnerReadChannel", () => {
  beforeEach(() => clearOwnerChannelCache());

  it("allows owner whose role grants VIEW_CHANNEL + READ_MESSAGE_HISTORY", async () => {
    const bot = makeBot({ memberRoles: [ROLE_A] });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(true);
  });

  it("denies owner with only SEND_MESSAGES role (no read perms)", async () => {
    const bot = makeBot({ memberRoles: [ROLE_B] });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(false);
  });

  it("denies owner with no roles", async () => {
    const bot = makeBot({ memberRoles: [] });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(false);
  });

  it("allows owner with ADMINISTRATOR role (bypasses channel checks)", async () => {
    const bot = makeBot({ memberRoles: [ROLE_ADMIN] });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(true);
  });

  it("denies when channel overwrite denies VIEW_CHANNEL for member's role", async () => {
    const bot = makeBot({
      memberRoles: [ROLE_A],
      overwrites: [
        { id: ROLE_A, deny: VIEW_CHANNEL },
      ],
    });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(false);
  });

  it("allows when channel overwrite grants VIEW_CHANNEL on @everyone", async () => {
    // @everyone has no base perms; overwrite grants VIEW + READ
    const bot = makeBot({
      memberRoles: [],
      overwrites: [
        { id: GUILD_ID, allow: VIEW_CHANNEL | READ_MESSAGE_HISTORY },
      ],
    });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(true);
  });

  it("denies when member-specific overwrite denies READ_MESSAGE_HISTORY", async () => {
    const ownerIdBig = BigInt(OWNER_ID);
    const bot = makeBot({
      memberRoles: [ROLE_A],
      overwrites: [
        { id: ownerIdBig, deny: READ_MESSAGE_HISTORY },
      ],
    });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(false);
  });

  it("allows when member-specific overwrite restores VIEW_CHANNEL after role deny", async () => {
    const ownerIdBig = BigInt(OWNER_ID);
    const bot = makeBot({
      memberRoles: [ROLE_A],
      overwrites: [
        { id: ROLE_A, deny: VIEW_CHANNEL },                          // role denies
        { id: ownerIdBig, allow: VIEW_CHANNEL | READ_MESSAGE_HISTORY }, // member restores
      ],
    });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(true);
  });

  it("fails open when getMember throws (API error)", async () => {
    const bot = makeBot({ throwOn: "getMember" });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(true);
  });

  it("fails open when getChannel throws (API error)", async () => {
    const bot = makeBot({ throwOn: "getChannel" });
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(true);
  });

  it("caches result within TTL (second call returns stale value)", async () => {
    let callCount = 0;
    const bot = {
      helpers: {
        getMember: async () => { callCount++; return { roles: [ROLE_A] }; },
        getChannel: async () => ({ permissionOverwrites: [] }),
        getRoles: async () => [
          { id: GUILD_ID, permissions: 0n },
          { id: ROLE_A, permissions: VIEW_CHANNEL | READ_MESSAGE_HISTORY },
        ],
      },
    };

    const r1 = await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID);
    const r2 = await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(callCount).toBe(1); // second call served from cache
  });

  it("different channelIds get separate cache entries", async () => {
    let callCount = 0;
    const bot = {
      helpers: {
        getMember: async () => { callCount++; return { roles: [] }; },
        getChannel: async () => ({ permissionOverwrites: [] }),
        getRoles: async () => [{ id: GUILD_ID, permissions: 0n }],
      },
    };

    await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID);
    await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, 999n);

    expect(callCount).toBe(2);
  });

  it("denies when @everyone overwrite denies VIEW_CHANNEL", async () => {
    const bot = makeBot({
      memberRoles: [ROLE_A],
      overwrites: [
        { id: GUILD_ID, deny: VIEW_CHANNEL },  // @everyone overwrite
      ],
    });
    // Role grants VIEW, but @everyone overwrite denies it (applied before role overwrites)
    // After @everyone deny: VIEW bit cleared. Then ROLE_A re-grants it.
    // Actual result: ROLE_A allow runs after @everyone deny → re-grants
    // Wait, let me re-check the Discord permission algorithm:
    // 1. Base @everyone perms (none)
    // 2. OR all role perms → VIEW + READ + SEND
    // 3. Apply @everyone overwrite deny (VIEW denied) → loses VIEW
    // 4. Apply role overwrites (none specified here, only @everyone has overwrite)
    // 5. Apply member overwrite (none)
    // Result: no VIEW_CHANNEL → denied
    expect(await canOwnerReadChannel(bot, OWNER_ID, GUILD_ID, CHANNEL_ID)).toBe(false);
  });
});
