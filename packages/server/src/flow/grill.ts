// The Grill's command, and how a Grill suggestion reads in the transcript: shared by Turns, which
// starts a Session on the command, FlowStart, which raises suggestions and starts the Grill, and
// the transcript, which shows each `suggest_grill` call as its suggestion's card.

export const GRILL = "/grill-with-docs";

// The Fern tool Claude raises a Grill suggestion with, as Claude Code names it.
export const SUGGEST_GRILL = "suggest_grill";
export const SUGGEST_GRILL_CALL = `mcp__fern__${SUGGEST_GRILL}`;

// What the message starts the Grill on, when it's the Grill's command; undefined otherwise.
export const grillTopic = (text: string) => {
  const trimmed = text.trim();
  if (trimmed !== GRILL && !trimmed.startsWith(`${GRILL} `)) return undefined;
  return trimmed.slice(GRILL.length).trim();
};

// `suggest_grill`'s answer names the suggestion it raised, which is how its card finds it.
export const raised = (id: string) =>
  `Fern showed the developer Grill suggestion ${id}. End your turn now without starting the work; if the developer starts the Grill, its command arrives as your next message.`;

export const suggestionIn = (answer: string) =>
  /Grill suggestion ([0-9a-f-]{36})\./.exec(answer)?.[1];
