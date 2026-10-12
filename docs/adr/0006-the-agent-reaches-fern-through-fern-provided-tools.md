# The agent reaches Fern through Fern's own tools, not `AskUserQuestion` or edited skills

In a Hosted Session, Fern gives the agent its own tools through the Agent SDK. One says the current Phase is done, and one asks the developer a Round. Only Hosted Sessions are told to use them. When the agent reports a Phase done, Fern raises the Checkpoint (or approves it under earned Autonomy) and sends the next Phase's slash command into the Session. When the agent asks a Round, Fern renders it in the Grill view and records each answer as a Decision. The shared skills (`/grill-with-docs`, `/to-spec`, `/implement-spec`, `/retro`) stay user-only and unchanged, so they work the same in a terminal.

## Considered Options

- **Remove `disable-model-invocation` from the four skills and gate the Skill tool call through the SDK's permission hook**: this needs no custom tool. Rejected because it edits shared skills, and outside Fern the agent could then move between Phases with no gate at all.
- **Claude Code's built-in `AskUserQuestion` for Rounds**: Fern already renders it. Rejected because it allows at most 4 questions with 4 options each and has no field for a recommended answer or its reasoning, which is the main thing the Grill view shows.
- **Parsing the grilling skill's markdown rounds out of the transcript**: this needs no agent changes, but it breaks whenever the wording drifts.

## Consequences

- Hosted Sessions need extra steering that External Sessions lack, so a Hosted Session's Grill transcript looks different from a terminal one.
