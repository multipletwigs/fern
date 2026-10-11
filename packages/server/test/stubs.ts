import { Effect, Layer, Stream } from "effect";
import { Commands } from "../src/commands/Commands";
import { Transcripts } from "../src/transcript/Transcripts";
import { Turns } from "../src/turn/Turns";
import { Walkthroughs } from "../src/walkthrough/Walkthroughs";
import { WalkthroughWriter } from "../src/walkthrough/WalkthroughWriter";
import { Workspace } from "../src/workspace/Workspace";

// Services a test doesn't exercise; using one fails the test.

export const NoWriter = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({ write: () => Effect.die("unused") }),
);

export const UnusedTranscripts = Layer.succeed(
  Transcripts,
  Transcripts.of({
    current: Effect.die("unused"),
    projects: Stream.die("unused"),
    live: () => Effect.die("unused"),
  }),
);

export const unusedTurns = Turns.of({
  send: () => Effect.die("unused"),
  unqueue: () => Effect.die("unused"),
  start: () => Effect.die("unused"),
  interrupt: () => Effect.die("unused"),
  turn: () => Effect.die("unused"),
  running: Effect.die("unused"),
  overlapping: () => Effect.die("unused"),
  finished: Stream.never,
});

export const UnusedCommands = Layer.succeed(
  Commands,
  Commands.of({ list: () => Effect.die("unused") }),
);

export const UnusedWorkspace = Layer.succeed(
  Workspace,
  Workspace.of({
    files: () => Effect.die("unused"),
    file: () => Effect.die("unused"),
    changes: () => Effect.die("unused"),
  }),
);

export const UnusedWalkthroughs = Layer.succeed(
  Walkthroughs,
  Walkthroughs.of({
    list: () => Stream.die("unused"),
    write: () => Effect.die("unused"),
    verdict: () => Effect.die("unused"),
    redirect: () => Effect.die("unused"),
  }),
);
