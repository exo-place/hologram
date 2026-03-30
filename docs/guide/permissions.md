# Permissions

Hologram has a permission system to control who can view and edit entities, who can trigger them, and whether the AI can modify their facts.

## Ownership

Every entity has an owner — the user who created it. The owner always has full access to view, edit, delete, and trigger their entities.

### Checking Ownership

When you create an entity, your Discord user ID is stored as the owner. You can see an entity's ID with `/view <entity>`.

### Transferring Ownership

Use `/transfer` to transfer ownership to another user:

```
/transfer Aria @username
```

Only the current owner can transfer an entity.

## Managing Permissions

Permissions are managed through the Discord UI using:

```
/edit <entity> type:Permissions
```

This opens a modal with four mentionable select menus — you pick users and roles directly from Discord's interface.

### View

Controls who can see the entity's facts with `/view`.

- **Blank (no selections)** — anyone can view
- **Owner pre-selected** — owner only (the default for new entities)
- **Specific users/roles** — only those users or roles

### Edit

Controls who can modify the entity's facts with `/edit`.

- **Blank (no selections)** — anyone can edit
- **Owner pre-selected** — owner only (the default for new entities)
- **Specific users/roles** — only those users or roles

### Trigger

Controls who can cause the entity to respond (via messages or `/trigger`).

- **Blank (no selections)** — anyone can trigger (default)
- **Specific users/roles** — only those users or roles can trigger

### Blacklist

Blocks specific users or roles from all operations (view, edit, trigger). Blacklist overrides all other permissions — blacklisted users cannot interact with the entity even if they are in an allowlist. The owner is never affected by the blacklist.

## Permission Hierarchy

| Operation | Default | Restriction |
|-----------|---------|-------------|
| View | Owner only | Grant via Permissions modal |
| Edit | Owner only | Grant via Permissions modal |
| Trigger | Everyone | Restrict via Permissions modal |
| Blacklist | None | Block via Permissions modal |

The owner always has full access regardless of what is configured.

## Server-Level Permissions

Server administrators can configure who is allowed to bind entities or use personas in specific channels or across the server:

```
/config This channel
/config This server
```

Requires the **Manage Channels** Discord permission. This opens a modal with:

- **Bind access** — who can run `/bind`/`/unbind` for channels and the server. Blank = everyone.
- **Persona access** — who can bind personas (`/bind Me ...`). Blank = everyone.
- **Blacklist** — blocked from all bind and persona operations.

## LLM Lock (`$locked`)

By default, the AI can modify entity facts through tool calls during conversation. You can prevent this with the `$locked` directive in the entity's facts.

### Lock Entire Entity

Add `$locked` as a standalone fact to prevent the AI from modifying any facts:

```
$locked
is a character
has silver hair
```

The AI can still see all the facts, but cannot add, update, or remove any of them.

### Lock Specific Facts

Prefix individual facts with `$locked` to protect only those facts:

```
is a character
$locked has silver hair
likes tea
```

In this example, the AI can modify "is a character" and "likes tea", but cannot touch "has silver hair".

## Examples

### Collaborative Character

Owner and collaborators can edit, AI can learn:

Use `/edit Aria type:Permissions` to add collaborators in the Edit field.

Facts:
```
is a character
has silver hair
```

### Protected Core Facts

Anyone can edit the entity, but AI cannot change key traits:

```
$locked is a character
$locked has silver hair
personality is cheerful
```

### Fully Locked

No one can edit except owner, AI cannot modify:

```
$locked
is a legendary artifact
has immense power
```
