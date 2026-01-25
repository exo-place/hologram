# World Building

Worlds are the persistent setting - lore, rules, locations, and NPCs.

## Creating a World

```
/world create <name> <description>
```

## World Configuration

Each world has its own config controlling all subsystems:

```
/config show
/config preset <minimal|simple|full>
```

## Locations

Build a graph of connected locations:

```
/location create <name> <description>
/location connect <from> <to> [type]
/location go <name>
/location look
```

### Location Hierarchy

- **Zones** - Large regions (kingdoms, continents)
- **Regions** - Medium areas (cities, forests)
- **Locations** - Specific places (rooms, clearings)

## Time System

Configure how time flows:

- **realtime** - Syncs with real time (configurable ratio)
- **narrative** - Advances based on story events
- **manual** - Only advances via commands

### Calendar

Optional rich calendar with:
- Custom day/month/week lengths
- Named months and days
- Seasons with weather

```
/time                     # Show current time
/date                     # Show full date
/time advance "2 hours"   # Skip time
```

## Weather

```
/weather                  # Show current weather
/weather set <condition>  # Change weather
```

Weather can be tied to seasons for automatic variety.

## Lore and Rules

- **Lore** - Searchable background (included via RAG)
- **Rules** - Always in context (game mechanics, tone)

```
/world lore <content>     # Add lore entry
/world rules <content>    # Set world rules
```
