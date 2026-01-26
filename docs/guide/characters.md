# Characters

Characters are the heart of Hologram. Create AI-controlled characters with rich personas.

## Creating Characters

### AI-Assisted (Recommended)

```
/build character
```

The build wizard walks you through character creation with AI suggestions:
1. Choose a name (AI can suggest based on theme)
2. Define personality and background
3. Set example dialogue for voice/style
4. AI helps fill in details you skip

### Manual Creation

```
/character create <name>
```

Creates a character with just a name. Use `/character edit` to add details:
- Name and description
- Persona (personality, background)
- Example dialogue (voice/style)
- Avatar (optional)

## Character Structure

Characters are freeform - define what matters for your RP:

```typescript
interface Character {
  name: string;
  persona: string;           // Who they are
  scenario?: string;         // Current situation/goals
  exampleDialogue?: string;  // Voice/style examples
  systemPrompt?: string;     // Additional instructions
}
```

## Managing Characters

```
/character list              # List all characters
/character view <name>       # View character details
/character edit <name>       # Edit character
/character delete <name>     # Delete character
```

## Selecting a Character

After creating a character, select them for the current channel:

```
/character select <name>
```

Now when you chat, the bot responds as that character.

## Multi-Character Scenes

Use `/scene` with multiple characters for group RP:

```
/scene start "Tavern Meeting"
/character select Alice     # Primary character
```

The AI can voice multiple characters in a scene when needed.

## Output Modes

Configure how multi-character responses appear via `/config`:

- **tagged** - `**Alice:** "Hello" **Bob:** "Hi"` (default for minimal)
- **webhooks** - Separate Discord messages with character avatars (default for sillytavern+)
- **auto** - Automatically chooses based on context
- **narrator** - Third-person narration

## Personas (For Players)

Players can set a persona for themselves:

```
/persona set <name>         # Set your display name
/persona show               # View your persona
/persona clear              # Remove persona
```

## Proxy System

For more advanced character switching, use the proxy system:

```
/proxy add <name> <prefix>  # e.g., /proxy add Alice A:
/proxy list                 # View your proxies
```

Then type `A: Hello!` to speak as Alice.
