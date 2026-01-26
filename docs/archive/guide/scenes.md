# Scenes

Scenes are the active play area - where, when, and who's present.

## Starting a Scene

```
/scene start [world] [location]
```

Creates a new scene in the specified world and location.

## Scene State

Each scene tracks:
- Current location
- Time (day, hour, minute)
- Weather
- Present characters (AI and player)
- Active characters (which AI chars are being voiced)

## Managing Scenes

```
/scene status        # Show current scene state
/scene pause         # Save and pause (preserves state)
/scene resume [id]   # Resume a paused scene
/scene end           # End scene, archive to chronicle
/scene list          # Show paused scenes
```

## Scene Boundaries

Configure automatic scene transitions:

- `onLocationChange`: new_scene | continue | ask
- `onTimeSkip`: new_scene | continue | ask
- `timeSkipThreshold`: Hours to count as a "skip"

## Participants

### AI Characters
- Voiced by the bot
- Their knowledge is filtered by chronicle visibility

### Player Characters
- Controlled by Discord users
- Tracked for witness perspective
- Can use proxying for multiple characters

## Time in Scenes

```
/time                    # Show current time
/time advance <duration> # Skip time
/time set <time>         # Set specific time
```
