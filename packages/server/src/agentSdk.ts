import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { TranscriptError } from "@repo/api";
import { Effect } from "effect";

// Runs an Agent SDK call, turning a rejection into a TranscriptError named after the call.
export const sdk = <A>(name: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new TranscriptError({ message: `${name}: ${String(cause)}` }),
  });

// Whether a Session has run in the folder, which is what makes it a Project.
export const isProject = (cwd: string) =>
  sdk("listSessions", () => listSessions({ includeProgrammatic: false })).pipe(
    Effect.map((sessions) => sessions.some((session) => session.cwd === cwd)),
  );
