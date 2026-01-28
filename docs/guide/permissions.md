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

## User Permissions (`$edit`, `$view`)

Control which Discord users can edit or view an entity using the `$edit` and `$view` directives.

### Edit Permissions

By default, only the owner can edit an entity. Use `$edit` to grant access to others:

```
$edit @everyone
```

Or specify usernames:

```
$edit alice, bob
```

### View Permissions

By default, everyone can view entities (public). Use `$view` to restrict viewing:

```
$view alice, bob
```

Or keep it public explicitly:

```
$view @everyone
```

## Permission Hierarchy

| Check | Default | Override |
|-------|---------|----------|
| Edit | Owner only | `$edit @everyone` or `$edit <usernames>` |
| View | Everyone | `$view <usernames>` (restricts to listed users) |
| LLM Modify | Allowed | `$locked` (entity) or `$locked <fact>` |

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

### Private Entity

Only owner can see and edit:

```
$view myusername
is my private character
has secrets
```

### Fully Locked

No one can edit except owner, AI cannot modify:

```
$locked
is a legendary artifact
has immense power
```
