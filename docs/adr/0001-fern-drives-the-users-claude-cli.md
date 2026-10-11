# Fern hosts Claude Code Sessions by driving the user's installed `claude` CLI

Fern drives Claude Code itself and renders its own Session UI instead of the terminal TUI. Fern exists to measure a Setup by how often the developer has to Redirect the agent, and only a host sees Redirects, Checkpoints (permission requests, AskUserQuestion, plan approval), and Phase changes as structured events rather than text to scrape. Fern runs the developer's own installed `claude` binary, unmodified, through its structured stream-json mode (directly or via the TypeScript Agent SDK pointed at that binary), so the developer keeps whatever authentication they set up in Claude Code, including their Claude subscription. Fern never asks for an API key and never reads, stores, or forwards credentials.

## Considered Options

- **Configurator + observer**: Fern writes the Setup and reads transcripts afterwards; the developer keeps prompting in the terminal. Rejected because Redirects would have to be classified after the fact, and Checkpoints could not be answered from Fern.
- **Embedded terminal (PTY) running the `claude` TUI**: keeps the native UI for free, but Fern only sees screen output.
- **Agent SDK with an app-supplied API key**: the path Anthropic documents for third-party products. Rejected because it forces paid API billing on developers who already pay for a Claude subscription.

## Consequences

- Fern must rebuild what the TUI gave for free, e.g. `/btw` becomes a forked Session in a side panel.
- Sessions run outside Fern are still read from `~/.claude/projects` as External Sessions, which keeps the benchmark baseline.
- `ANTHROPIC_API_KEY` must be unset in the spawned environment, or it silently overrides the subscription login.
- Fern can be open-sourced on the same bring-your-own-CLI model as T3 Code: each user installs and logs in to Claude Code themselves, and Fern has no accounts, servers, or credential handling of its own. Fern must never offer its own Claude login or proxy requests, which is what Anthropic's terms for third-party products rule out.
