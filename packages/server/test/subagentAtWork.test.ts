// A Subagent waiting on a tool call writes nothing until the call returns, which can take minutes.
// It stays running while its Session may still be at work: for a Hosted Session, while Fern's turn
// runs or its Claude Code process is open; for an External one, while the Session's files were
// written lately enough for a tool call to still be running.
import { assert, layer } from "@effect/vitest";
import type { HostedTurn } from "@repo/api";
import { DateTime, Effect, Layer, Stream } from "effect";
import { HttpServer } from "effect/http";
import { NodeServices } from "@effect/platform-node";
import { DatabaseLive } from "../src/database/Database";
import { handlersWith } from "../src/http";
import { LiveHandlersNoDeps } from "../src/live";
import { SubagentFiles } from "../src/subagent/SubagentFiles";
import { Subagents } from "../src/subagent/Subagents";
import { Transcripts } from "../src/transcript/Transcripts";
import { HostedSessions } from "../src/turn/HostedSessions";
import { Turns } from "../src/turn/Turns";
import {
  age,
  assistant,
  launched,
  makeConfig,
  result,
  statuses,
  toolUse,
  transcriptOf,
  user,
  writeSession,
} from "./subagentFixture";
import {
  NoWorktreesDir,
  NoWriter,
  UnusedAutonomy,
  UnusedFlows,
  UnusedRounds,
  UnusedWalkthroughs,
  UnusedWorkspace,
  unusedTurns,
  UnusedTerminals,
  UnusedPullRequests,
} from "./stubs";

const projectDir = makeConfig();
const AGENT = "a1f0000000000001f";

// A Session whose background Subagent called Bash and waits on it, its Session's transcript last
// written `sessionAge` minutes ago and its own `agentAge` minutes ago.
const waitingOnBash = (
  sessionId: string,
  sessionAge: number,
  agentAge: number,
) => {
  const main = transcriptOf(sessionId);
  const { session, subagent } = writeSession(projectDir, sessionId, [
    main(0, "user", user("Run the tests"), { origin: { kind: "human" } }),
    main(
      1,
      "assistant",
      assistant([
        toolUse("toolu_tests", "Agent", {
          description: "Run the tests",
          prompt: "Run the tests.",
          run_in_background: true,
        }),
      ]),
    ),
    main(2, "user", user([result("toolu_tests", launched(AGENT))])),
  ]);
  const line = transcriptOf(sessionId, AGENT);
  const file = subagent(AGENT, "toolu_tests", [
    line(2, "user", user("Run the tests.")),
    line(
      3,
      "assistant",
      assistant([toolUse("toolu_bash", "Bash", { command: "pnpm test" })]),
    ),
  ]);
  age(session, sessionAge);
  age(file, agentAge);
};

const PARENT_QUIET = "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e";
const AGENT_QUIET = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const ALL_QUIET = "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a";
const HOSTED = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
waitingOnBash(PARENT_QUIET, 20, 4);
waitingOnBash(AGENT_QUIET, 4, 20);
waitingOnBash(ALL_QUIET, 20, 20);
// Written a few minutes ago, while Fern's turn ran.
waitingOnBash(HOSTED, 4, 4);

const running = { row: "running", tab: "running", view: "running" } as const;
const stopped = { row: "stopped", tab: "stopped", view: "stopped" } as const;

layer(
  Layer.mergeAll(
    handlersWith(NoWriter).pipe(
      Layer.provide([DatabaseLive(":memory:"), NoWorktreesDir]),
    ),
    HttpServer.layerServices,
  ),
  { excludeTestServices: true },
)("A Subagent waiting on a tool call, in an External Session", (it) => {
  it.effect("runs while its own file was written lately", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* statuses(PARENT_QUIET, AGENT, "toolu_tests"),
        running,
      );
    }),
  );

  it.effect("runs while its Session's transcript was written lately", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* statuses(AGENT_QUIET, AGENT, "toolu_tests"),
        running,
      );
    }),
  );

  it.effect("is stopped once the whole Session has long been quiet", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* statuses(ALL_QUIET, AGENT, "toolu_tests"),
        stopped,
      );
    }),
  );
});

// Fern's latest turn on the Session ended; whether its process is still open is up to the test.
let open = true;
const ended: HostedTurn = {
  running: false,
  endedAt: DateTime.makeUnsafe(Date.now() - 3 * 60_000),
};
const HostedTurns = Layer.succeed(
  Turns,
  Turns.of({
    ...unusedTurns,
    turn: (id) => Effect.succeed(id === HOSTED ? ended : undefined),
    isOpen: (id) => Effect.sync(() => id === HOSTED && open),
    contextWindow: () => Effect.undefined,
  }),
);
const NoHostedSessions = Layer.succeed(
  HostedSessions,
  HostedSessions.of({
    record: () => Effect.die("unused"),
    archive: () => Effect.die("unused"),
    worktrees: Effect.die("unused"),
    sessions: Effect.die("unused"),
    session: () => Effect.die("unused"),
    changes: Stream.never,
    listed: Effect.die("unused"),
    isProject: () => Effect.die("unused"),
    isHosted: () => Effect.die("unused"),
    projectOf: () => Effect.die("unused"),
  }),
);

layer(
  LiveHandlersNoDeps.pipe(
    Layer.provide(Transcripts.layer),
    Layer.provideMerge(Subagents.layer),
    Layer.provide([
      SubagentFiles.layer,
      HostedTurns,
      NoHostedSessions,
      UnusedWorkspace,
      UnusedWalkthroughs,
      UnusedFlows,
      UnusedRounds,
      UnusedAutonomy,
      UnusedTerminals,
      UnusedPullRequests,
      DatabaseLive(":memory:"),
    ]),
    Layer.provide(NodeServices.layer),
    Layer.merge(HttpServer.layerServices),
  ),
  { excludeTestServices: true },
)("A Subagent waiting on a tool call, in a Hosted Session", (it) => {
  it.effect("runs while the Session's Claude Code process is open", () =>
    Effect.gen(function* () {
      open = true;
      assert.deepStrictEqual(
        yield* statuses(HOSTED, AGENT, "toolu_tests"),
        running,
      );
    }),
  );

  it.effect("is stopped once Fern closed the process", () =>
    Effect.gen(function* () {
      open = false;
      assert.deepStrictEqual(
        yield* statuses(HOSTED, AGENT, "toolu_tests"),
        stopped,
      );
    }),
  );
});
