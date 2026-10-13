# Web

The app's UI: how a Session's transcript, panels and controls present Fern's domain to the developer. Domain terms (Session, Subagent, Walkthrough) live in the server glossary.

## Language

**Developer's turn**:
Something the developer sent in a Session's transcript: a message, a slash command, or a message Claude Code never answered. All three share one look.
_Avoid_: User message, prompt card

**Review tab**:
A Session's tab for reviewing its Stack: the PRs listed on the left, bottom first, each opening into its Sections and Unexplained changes, with the one under review on the right. It is always there, with a count of what still waits on a verdict.
_Avoid_: Walkthrough panel, review mode

**Code panel**:
The Session's files and their changes beside its transcript. It opens only when the developer toggles it.
_Avoid_: Diff view, editor
