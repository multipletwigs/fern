import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ProjectNotFound, SlashCommand, WorkspaceError } from "@repo/api";
import { Cache, Context, Effect, Layer } from "effect";
import { sdk } from "../agentSdk";
import { HostedSessions } from "../turn/HostedSessions";

// Input that never arrives, so Claude Code starts up and reports its commands without a turn.
const idle: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
};

const read = (root: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      query({
        prompt: idle,
        options: { cwd: root, permissionMode: "auto" },
      }),
    ),
    (process) => sdk("supportedCommands", () => process.supportedCommands()),
    (process) => Effect.sync(() => process.close()),
  ).pipe(
    Effect.timeout("20 seconds"),
    Effect.map((commands) =>
      commands.map(
        ({ name, description, argumentHint }) =>
          new SlashCommand({ name, description, argumentHint }),
      ),
    ),
    Effect.mapError((cause) => new WorkspaceError({ message: cause.message })),
  );

// The slash commands Claude Code offers in a Project, read from a Claude Code process started in
// its folder and closed again before it takes a turn.
export class Commands extends Context.Service<
  Commands,
  {
    list(
      root: string,
    ): Effect.Effect<
      ReadonlyArray<SlashCommand>,
      ProjectNotFound | WorkspaceError
    >;
  }
>()("@repo/server/commands/Commands") {
  static readonly layer = Layer.effect(
    Commands,
    Effect.gen(function* () {
      const hosted = yield* HostedSessions;
      // Starting Claude Code takes a moment, and skills rarely change between keystrokes.
      const cache = yield* Cache.make({
        lookup: read,
        capacity: 32,
        timeToLive: "1 minute",
      });

      const list = Effect.fn("Commands.list")(function* (root: string) {
        const known = yield* hosted
          .isProject(root)
          .pipe(
            Effect.mapError((e) => new WorkspaceError({ message: e.message })),
          );
        if (!known) return yield* new ProjectNotFound({ root });
        return yield* Cache.get(cache, root);
      });

      return Commands.of({ list });
    }),
  );
}
