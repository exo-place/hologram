# Configuration

Hologram is highly configurable - every feature is optional. Configure at the world level with sensible defaults.

## World Config

Use `/config` commands to manage world configuration:

```
/config show           # Show current config
/config preset minimal # Simple chat mode
/config preset full    # Full RP with all features
/config set <path> <value>
```

## Available Presets

### Minimal
- Chronicle disabled
- No scenes, locations, or time tracking
- Just character chat

### Simple
- Chronicle enabled with auto-extract
- Basic scene tracking
- No inventory or complex systems

### Full
- All systems enabled
- Inventory with equipment
- Locations with connections
- Calendar and time tracking
- Relationships and factions

## Feature Flags

Each system can be toggled independently:

- `chronicle.enabled` - Memory and fact storage
- `scenes.enabled` - Scene pause/resume
- `inventory.enabled` - Item management
- `locations.enabled` - Location graph
- `time.enabled` - Time tracking
