# Web

The app's UI: how a Session's transcript, panels and controls present Fern's domain to the developer. Domain terms (Session, Subagent, Walkthrough) live in the server glossary.

## Language

**Developer's turn**:
Something the developer sent in a Session's transcript: a message, a slash command, or a message Claude Code never answered. All three share one look.
_Avoid_: User message, prompt card

**Review layout**:
How the developer works through anything item by item, such as a Round's questions or a Walkthrough's Sections: every item listed on the left with its state, the open one on the right, sliding sideways to the next open item once this one is settled. Its keys work only while it has focus.
_Avoid_: Wizard, stepper, carousel

**Review tab**:
A Session's tab for reviewing its Stack: the PRs listed on the left, bottom first, each opening into its Sections and Unexplained changes, with the one under review on the right, in the Review layout. It is always there, with a count of what still waits on a verdict.
_Avoid_: Walkthrough panel, review mode

**Code panel**:
The Session's files and their changes beside its transcript. It opens only when the developer toggles it.
_Avoid_: Diff view, editor
