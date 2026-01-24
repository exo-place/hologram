# TODO

## Tech Debt

### Type Safety
- [ ] Replace `AnyBot` and `AnyInteraction` types with proper Discordeno types
  - Currently using `any` with eslint-disable as workaround for complex Discord types
  - Files affected: all command handlers in `src/bot/commands/`
  - Should use proper Bot and Interaction types from @discordeno/bot

## Future Enhancements

See plan file for full implementation phases.
