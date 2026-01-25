# Characters

Characters are the heart of Hologram. Create AI-controlled characters with rich personas.

## Creating Characters

```
/character create <name>
```

Opens a wizard to set up:
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

## Multi-Character Scenes

Use `/cast` to manage which characters are active:

```
/cast add <character>        # Add character to scene
/cast remove <character>     # Remove from scene
/cast voice <character>      # Set which AI to voice (single mode)
/cast list                   # Show active characters
```

## Output Modes

Configure how multi-character responses appear:

- **tagged** - `**Alice:** "Hello" **Bob:** "Hi"`
- **webhooks** - Separate Discord messages with character avatars
- **narrator** - Third-person narration
