// A poll that misses the transcript (the SDK's getSessionInfo returns undefined when its read
// throws, the file is momentarily empty, or no summary can be extracted) must not end the live
// stream: the page would keep the last header it got, such as a turn still running, for good.
import { assert, layer } from "@effect/vitest";
import type { HostedTurn, TranscriptUpdate } from "@repo/api";
import { DateTime, Effect, Fiber, Layer, Stream } from "effect";
import { vi } from "vitest";
import { Transcripts } from "../src/transcript/Transcripts";
import { HostedSessions } from "../src/turn/HostedSessions";
import { Turns } from "../src/turn/Turns";
import { unusedTurns } from "./stubs";

const SESSION = "6f0c4a52-7d2e-4f0e-9a36-1f8b2c9d4e11";
let missingOnce = false;
let modified = 1;
let turn: HostedTurn | undefined = { running: true };

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionInfo: () => {
    if (missingOnce) {
      missingOnce = false;
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      sessionId: SESSION,
      summary: "s",
      lastModified: modified,
      fileSize: modified,
      cwd: "/repo",
    });
  },
  getSessionMessages: () => Promise.resolve([]),
}));

const TestTranscripts = Transcripts.layer.pipe(
  Layer.provide([
    Layer.succeed(
      Turns,
      Turns.of({ ...unusedTurns, turn: () => Effect.sync(() => turn) }),
    ),
    Layer.succeed(
      HostedSessions,
      HostedSessions.of({
        record: () => Effect.void,
        archive: () => Effect.die("unused"),
        worktrees: Effect.succeed([]),
        session: () => Effect.undefined,
        changes: Stream.never,
        listed: Effect.succeed([]),
        isProject: () => Effect.succeed(true),
        isHosted: () => Effect.succeed(true),
        projectOf: () => Effect.die("unused"),
      }),
    ),
  ]),
);

layer(TestTranscripts, { excludeTestServices: true })("Transcripts", (it) => {
  it.effect("keeps a Session's transcript live after a missed poll", () =>
    Effect.gen(function* () {
      const transcripts = yield* Transcripts;
      const seen: Array<TranscriptUpdate> = [];
      const stream = yield* transcripts.live(SESSION);
      const fiber = yield* stream.pipe(
        Stream.runForEach((u) => Effect.sync(() => seen.push(u))),
        Effect.forkChild,
      );
      yield* Effect.sleep("600 millis");
      assert.isTrue(seen.at(-1)?.header.hostedTurn?.running);

      missingOnce = true;
      yield* Effect.sleep("600 millis");
      // The turn ends, and Claude Code writes its last lines.
      turn = { running: false, endedAt: DateTime.makeUnsafe(Date.now()) };
      modified = 2;
      yield* Effect.sleep("1200 millis");

      const ended = fiber.pollUnsafe() !== undefined;
      yield* Fiber.interrupt(fiber);
      assert.isFalse(ended, "the live transcript stream completed");
      assert.isFalse(seen.at(-1)?.header.hostedTurn?.running);
    }),
  );
});
