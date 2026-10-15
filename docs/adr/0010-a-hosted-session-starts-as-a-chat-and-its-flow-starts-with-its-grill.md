# A Hosted Session starts as a chat; its Flow starts with its Grill, when the developer says so

A Hosted Session no longer opens the Grill with its first message. It starts as a chat about its Project, still in a worktree of its own, and its Flow starts only when the developer starts the Grill: from a Grill suggestion, which Claude raises through a Fern tool once the chat lands on something worth building, from the top bar, or by sending the Grill's command, the opening message included. The Grill goes into the same Session, so it has the whole chat, and the branch is renamed after the work. This supersedes ADR 0005's "one Hosted Session carries its work through the whole Flow" for Sessions that never get past a chat; once started, a Session's Flow is as ADR 0005 describes.

## Considered Options

- **Haiku watching the chat** and deciding when to suggest the Grill: independent of the agent, but a call on every reply, from a trimmed window. Rejected in favour of a Fern tool (ADR 0006), whose steering sits in the cached system prompt, and which judges from the whole chat.
- **Chats in the developer's checkout, read-only**: no branch for every question. Rejected because starting the Grill would then mean a new Session in a worktree, and the Grill would get a summary of the chat rather than the chat itself.

## Consequences

- Claude Code's process keeps the tools and steering it opened with, so starting the Grill opens it again, resumed, with the Flow's.
- A chat can make small changes; they land as a Stack of one PR (ADR 0009), with no Flow.
- A chat that never committed anything goes when it's archived, or after a week idle with a clean tree, and its branch is deleted with it, as it holds nothing beyond `main`.
- A Grill suggestion turned down stays turned down: Claude hears so with the developer's next message, out of the transcript's sight, and suggests again only for different work.
