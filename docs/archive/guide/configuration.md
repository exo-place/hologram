# Configuration

Hologram is highly configurable - every feature is optional. Configure at the world level with sensible defaults.

**Note:** Defaults are now minimal (all features disabled). Use presets or the wizard to enable features.

## Quick Config

```
/config preset sillytavern  # Good default for character RP
/config wizard              # Interactive toggle UI
/config show                # View current settings
```

## World Config Commands

| Command | Description |
|---------|-------------|
| `/config show [section]` | Show current configuration |
| `/config set <path> <value>` | Set a specific option |
| `/config preset <mode>` | Apply a preset mode |
| `/config wizard` | Interactive feature toggles |
| `/config reset` | Reset to defaults |

## Available Presets (Modes)

### Minimal
- All features disabled
- Just chat with a character
- Tagged output (no webhooks)

### SillyTavern (Recommended)
- Chronicle (memory) enabled with auto-extract
- Scenes enabled
- Relationships enabled
- Webhook output for character messages

### MUD
- Locations with connections
- Inventory with equipment
- Time tracking
- Chronicle enabled
- Text adventure style

### Survival
- All MUD features plus:
- Character attributes (hunger, thirst, stamina)
- Transformation/forms
- Random events
- Real-time sync

### Tabletop
- Dice rolling (advanced syntax)
- Combat system (HP, AC, initiative)
- Equipment and inventory
- Manual time control

### Parser
- Classic text adventure style
- Locations with properties
- Inventory
- Narrator output mode

### Full
- Everything enabled
- All mechanics active
- Maximum complexity

## Feature Flags

Each system can be toggled independently:

| Path | Description |
|------|-------------|
| `chronicle.enabled` | Memory and fact storage |
| `chronicle.autoExtract` | Automatically save important events |
| `chronicle.perspectiveAware` | Filter by who knows what |
| `scenes.enabled` | Scene pause/resume |
| `inventory.enabled` | Item management |
| `inventory.useEquipment` | Equipment slots |
| `inventory.useCapacity` | Weight/slot limits |
| `locations.enabled` | Location graph |
| `locations.useConnections` | Named paths between locations |
| `time.enabled` | Time tracking |
| `time.useCalendar` | Custom calendar |
| `time.useDayNight` | Day/night cycle |
| `dice.enabled` | Dice rolling |
| `dice.useCombat` | Turn-based combat |
| `relationships.enabled` | Character relationships |
| `relationships.useAffinity` | Numerical affinity scores |
| `characterState.enabled` | Attributes and forms |
| `characterState.useEffects` | Buffs, debuffs, conditions |

## Examples

```
# Enable memory for an existing world
/config set chronicle.enabled true

# Enable dice without full combat
/config set dice.enabled true
/config set dice.useCombat false

# Switch to tabletop mode
/config preset tabletop
```
