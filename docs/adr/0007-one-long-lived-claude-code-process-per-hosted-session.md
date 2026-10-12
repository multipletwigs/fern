# One long-lived Claude Code process per Hosted Session, fed through its open input

Each Hosted Session gets one Claude Code process: one Agent SDK `query()` whose prompt is an input Fern keeps open. Every message the developer or Fern sends goes straight into that input. While a turn runs, Claude Code takes the message in at the next tool call, as its own terminal UI does, and the transcript shows it where the agent read it. A slash command waits and runs as a turn of its own once the turn ends. While idle, a message starts a new turn in the same process. Stop calls `interrupt()` and the process stays. The process closes after ten idle minutes and when the Session is archived, and the next message resumes the Session in a new one.

This replaces one `query()` per turn. Each turn's input closed once its first message was in, and later messages waited in Fern's own queue until the turn's result.

## Considered Options

- **One `query()` per turn, with Fern's queue**: simple, but a correction only reached the agent after it had finished the work it was correcting. Ending the turn also closed the process, which killed background subagents, and a reply that arrived after the turn's result was lost (#14).
- **Pushing mid-turn messages with `priority: "now"`**: unnecessary. A plain message pushed into the open input is delivered at the next tool call (probed against Claude Code 2.1.296).

## Consequences

- A turn lasts from a message being taken in until a result with no background task left and no sent message still waiting. Fern stamps each message with a uuid and follows Claude Code's `command_lifecycle` messages and `user_message_uuids` to know which ones it has taken in.
- `running` means a turn is in progress, not that the process is alive.
- A queued message can only be taken back before Claude Code has it, which in practice is while the process is opening. After that the queue shows it without a remove button.
- Stop drops only what Claude Code doesn't have yet. A message Claude Code already has runs next.
- Background subagents outlive the turn that started them; their notification turns arrive in the same process.
