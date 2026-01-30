# Permissions

Hologram has a permission system to control who can edit and view entities, and whether the AI can modify them.

## Ownership

Every entity has an owner - the user who created it. The owner always has full access to edit, view, and delete their entities.

### Checking Ownership

When you create an entity, your Discord user ID is stored as the owner. You can see who owns an entity (and its ID) with `/view <entity>`.

### Transferring Ownership

Use the `/transfer` command to transfer ownership to another user:

```
/transfer Aria @username
```

Only the current owner can transfer an entity.

## LLM Lock (`$locked`)

By default, the AI can modify entity facts through tool calls. You can prevent this with the `$locked` directive.

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

## User Permissions (`$edit`, `$view`, `$use`)

Control which Discord users can edit or view an entity using the `$edit` and `$view` directives.

### Edit Permissions

By default, only the owner can edit an entity. Use `$edit` to grant access to others:

```
$edit @everyone
```

Or specify usernames, Discord user IDs, or role IDs:

```
$edit alice, bob
$edit 123456789012345678
```

### View Permissions

By default, only the owner can view entities. Use `$view` to grant access to others:

```
$view @everyone
```

Or specify entries:

```
$view alice, bob
$view 123456789012345678
```

### Use Permissions

By default, anyone can trigger entity responses. Use `$use` to restrict who can trigger:

```
$use alice, bob
$use 123456789012345678
```

This controls both chat responses and `/trigger` invocations.

## Permission Hierarchy

| Check | Default | Override |
|-------|---------|----------|
| Edit | Owner only | `$edit @everyone` or `$edit <entries>` |
| View | Owner only | `$view @everyone` or `$view <entries>` |
| Use | Everyone | `$use <entries>` (restricts who can trigger) |
| LLM Modify | Allowed | `$locked` (entity) or `$locked <fact>` |

All permission directives accept usernames, Discord user IDs, and role IDs.

## Examples

### Collaborative Character

Multiple users can edit, AI can learn:

```
$edit @everyone
is a character
has silver hair
```

### Protected Core Facts

Users can edit, but AI can't change key traits:

```
$edit @everyone
$locked is a character
$locked has silver hair
personality is cheerful
```

### Public Entity

Visible to everyone:

```
$view @everyone
is a character
has silver hair
```

### Restricted Trigger

Only specific users can make this entity respond:

```
$use alice, bob
is a character
has silver hair
```

### Fully Locked

No one can edit except owner, AI cannot modify:

```
$locked
is a legendary artifact
has immense power
```
