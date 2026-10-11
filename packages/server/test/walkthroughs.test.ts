import { NodeServices } from "@effect/platform-node";
import { assert, layer } from "@effect/vitest";
import { FernApi, LiveRpcs, SessionInUse, type Walkthrough } from "@repo/api";
import { Effect, Layer, PubSub, Stream } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api";
import { RpcTest } from "effect/rpc";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { HandlersNoDeps } from "../src/http";
import { Snapshots } from "../src/snapshot/Snapshots";
import { type FinishedTurn, Turns } from "../src/turn/Turns";
import { Walkthroughs } from "../src/walkthrough/Walkthroughs";
import {
  type Draft,
  WalkthroughWriter,
  type WriteRequest,
} from "../src/walkthrough/WalkthroughWriter";
import {
  UnusedCommands,
  UnusedTranscripts,
  unusedTurns,
  UnusedWorkspace,
} from "./stubs";

const git = (...args: Array<string>) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd: repo, encoding: "utf8" },
  );

// A committed repo that a Session ran in.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "fern-walk-")));
git("init", "-q");
writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
writeFileSync(join(repo, "a.ts"), "export const a = 1;\nexport const b = 2;\n");
git("add", "-A");
git("commit", "-q", "-m", "Initial");

const SESSION = "5f8d2a41-7c3e-4b9a-9e21-3a6b8c0d1e2f";
const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const projectDir = join(
  configDir,
  "projects",
  repo.replace(/[^a-zA-Z0-9]/g, "-"),
);
mkdirSync(projectDir, { recursive: true });
writeFileSync(
  join(projectDir, `${SESSION}.jsonl`),
  `${JSON.stringify({
    type: "user",
    uuid: "00000000-0000-4000-8000-000000000001",
    parentUuid: null,
    sessionId: SESSION,
    timestamp: "2026-10-11T10:00:00.000Z",
    cwd: repo,
    message: { role: "user", content: "Bump b and add notes" },
  })}\n`,
);
process.env.CLAUDE_CONFIG_DIR = configDir;

// What the Fork is asked, and what it answers: a first draft, then its revision.
const requests: Array<WriteRequest> = [];
const revisions: Array<ReadonlyArray<string>> = [];
let answers: (request: WriteRequest) => [Draft, Draft?] = () => [
  { sections: [], notFromSession: [] },
];
const Writer = Layer.succeed(
  WalkthroughWriter,
  WalkthroughWriter.of({
    write: (request) =>
      Effect.sync(() => {
        requests.push(request);
        const [draft, revised] = answers(request);
        return {
          draft,
          revise: (unclaimed) =>
            Effect.sync(() => {
              revisions.push(unclaimed);
              return revised ?? draft;
            }),
        };
      }),
  }),
);

// Messages sent back to the Session, and whether sending fails.
const sent: Array<string> = [];
let refuse = false;
const finished = Effect.runSync(PubSub.unbounded<FinishedTurn>());
const FakeTurns = Layer.succeed(
  Turns,
  Turns.of({
    ...unusedTurns,
    send: (id, message) =>
      refuse
        ? Effect.fail(new SessionInUse({ id }))
        : Effect.sync(() => void sent.push(message.text)),
    overlapping: () => Effect.succeed([]),
    finished: Stream.fromPubSub(finished),
  }),
);

const makeClient = HttpApiTest.groups(FernApi, ["walkthroughs"]);
const makeLive = RpcTest.makeClient(LiveRpcs);

// The Session's Walkthroughs once `count` of them are written.
const written = (count: number) =>
  Effect.gen(function* () {
    const live = yield* makeLive;
    const [walkthroughs] = yield* live.Walkthroughs({ session: SESSION }).pipe(
      Stream.filter(
        (all) =>
          all.length === count && all.every((w) => w.status !== "writing"),
      ),
      Stream.take(1),
      Stream.runCollect,
      Effect.timeout("5 seconds"),
    );
    return walkthroughs ?? [];
  });

const latest = (walkthroughs: ReadonlyArray<Walkthrough>) => {
  const walkthrough = walkthroughs.at(-1);
  assert.isDefined(walkthrough);
  return walkthrough;
};

const hunkIn = (request: WriteRequest | undefined, path: string) =>
  request?.hunks.find((hunk) => hunk.path === path)?.id ?? "";

const Services = Layer.mergeAll(
  UnusedTranscripts,
  UnusedCommands,
  UnusedWorkspace,
  FakeTurns,
  Walkthroughs.layer.pipe(
    Layer.provide([FakeTurns, Writer, DatabaseLive(":memory:")]),
  ),
).pipe(Layer.provideMerge(Snapshots.layer), Layer.provide(NodeServices.layer));

// The steps build on each other, one review after another, so they run in order.
layer(
  Layer.mergeAll(
    HandlersNoDeps.pipe(Layer.provide(Services)),
    Services,
    HttpServer.layerServices,
  ),
)("Walkthroughs", (it) => {
  it.effect("has nothing to explain before anything changes", () =>
    Effect.gen(function* () {
      const snapshots = yield* Snapshots;
      yield* snapshots.markStart(repo, SESSION);
      const client = yield* makeClient;
      const error = yield* client.walkthroughs
        .write({ payload: { session: SESSION } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "NothingToReview");
    }),
  );

  it.effect("explains every changed line, leaving the rest unexplained", () =>
    Effect.gen(function* () {
      writeFileSync(
        join(repo, "a.ts"),
        "export const a = 1;\nexport const b = 3;\n",
      );
      writeFileSync(join(repo, "notes.md"), "# Notes\n\nOne.\n");
      writeFileSync(join(repo, "other.txt"), "made elsewhere\n");
      writeFileSync(join(repo, "ignored.txt"), "never shown\n");
      const status = git("status", "--porcelain");
      const head = git("rev-parse", "HEAD");

      answers = (request) => {
        const [a, notes, other] = ["a.ts", "notes.md", "other.txt"].map(
          (path) => hunkIn(request, path),
        );
        const bump = {
          title: "Bump b",
          explanation: "b is now 3.",
          hunks: [a ?? ""],
        };
        return [
          { sections: [bump], notFromSession: [] },
          {
            sections: [
              bump,
              {
                title: "Add notes",
                explanation: "A place for notes.",
                dropped: "Tried a README section first.",
                hunks: [notes ?? ""],
              },
            ],
            notFromSession: [other ?? ""],
          },
        ];
      };
      const client = yield* makeClient;
      yield* client.walkthroughs.write({ payload: { session: SESSION } });
      const walkthrough = latest(yield* written(1));

      assert.strictEqual(walkthrough.status, "ready");
      assert.strictEqual(walkthrough.since, "start");
      assert.deepStrictEqual(
        requests[0]?.hunks.map((hunk) => hunk.path),
        ["a.ts", "notes.md", "other.txt"],
      );
      // The Fork got one retry, for exactly what it left out.
      assert.deepStrictEqual(revisions, [
        [hunkIn(requests[0], "notes.md"), hunkIn(requests[0], "other.txt")],
      ]);
      assert.deepStrictEqual(
        walkthrough.sections.map((s) => [
          s.id,
          s.title,
          s.dropped,
          s.hunks.map((h) => h.path),
        ]),
        [
          ["s1", "Bump b", undefined, ["a.ts"]],
          ["s2", "Add notes", "Tried a README section first.", ["notes.md"]],
        ],
      );
      assert.deepStrictEqual(walkthrough.sections[0]?.hunks[0]?.lines, [
        " export const a = 1;",
        "-export const b = 2;",
        "+export const b = 3;",
      ]);
      assert.deepStrictEqual(
        walkthrough.unexplained.map((u) => [
          u.hunk.path,
          u.hunk.notFromSession,
        ]),
        [["other.txt", true]],
      );
      // Snapshotting left the repository as it was, apart from a hidden ref.
      assert.strictEqual(git("status", "--porcelain"), status);
      assert.strictEqual(git("rev-parse", "HEAD"), head);
      assert.strictEqual(git("stash", "list"), "");
      assert.include(
        git("for-each-ref", "refs/fern/"),
        `refs/fern/walkthroughs/${walkthrough.id}`,
      );
    }),
  );

  it.effect(
    "sends the Rejection notes back once every item has a verdict",
    () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const { id, unexplained } = latest(yield* written(1));
        const other = unexplained[0]?.hunk.id ?? "";
        const verdict = (
          item: string,
          kind: "approved" | "rejected",
          note?: string,
        ) =>
          client.walkthroughs.verdict({
            params: { id, item },
            payload: { kind, note },
          });

        const missing = yield* verdict("s9", "approved").pipe(Effect.flip);
        assert.strictEqual(missing._tag, "ReviewItemNotFound");
        const noNote = yield* verdict("s1", "rejected").pipe(Effect.flip);
        assert.strictEqual(noNote._tag, "SchemaError");

        yield* verdict("s1", "approved");
        yield* verdict("s2", "rejected", "Keep notes in the README.");
        assert.deepStrictEqual(sent, []);
        yield* verdict(other, "rejected", "Revert this.");

        const reviewed = latest(yield* written(1));
        assert.isDefined(reviewed.reviewedAt);
        assert.isDefined(reviewed.redirectSentAt);
        assert.deepStrictEqual(sent, [
          [
            "I reviewed Walkthrough 1 and rejected part of it:",
            "",
            '- "Add notes": Keep notes in the README.',
            "- The unexplained change in `other.txt` (@@ -0,0 +1 @@): Revert this.",
            "",
            "Please address these.",
          ].join("\n"),
        ]);
        const closed = yield* verdict("s1", "rejected", "Changed my mind").pipe(
          Effect.flip,
        );
        assert.strictEqual(closed._tag, "ReviewClosed");
      }),
  );

  it.effect("writes the next Walkthrough on its own when a turn finishes", () =>
    Effect.gen(function* () {
      appendFileSync(join(repo, "README.md"), "## Notes\n\nOne.\n");
      answers = (request) => [
        {
          sections: [
            {
              title: "Move notes to the README",
              explanation: "As asked.",
              hunks: [hunkIn(request, "README.md")],
              fixes: request.rejections.find((r) => r.title === "Add notes")
                ?.id,
            },
          ],
          notFromSession: [],
        },
      ];
      yield* PubSub.publish(finished, { id: SESSION, cwd: repo });
      const walkthrough = latest(yield* written(2));

      assert.strictEqual(walkthrough.number, 2);
      assert.strictEqual(walkthrough.since, "previous");
      // Only what changed since Walkthrough 1, and both open Rejections offered to the Fork.
      assert.deepStrictEqual(
        requests[1]?.hunks.map((hunk) => hunk.path),
        ["README.md"],
      );
      assert.deepStrictEqual(
        requests[1]?.rejections.map((r) => r.title),
        ["Add notes", "Unexplained change in other.txt"],
      );
      assert.deepStrictEqual(walkthrough.sections[0]?.fixes, {
        walkthrough: 1,
        title: "Add notes",
      });
    }),
  );

  it.effect("keeps a failed send for the developer to retry", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const { id } = latest(yield* written(2));
      refuse = true;
      yield* client.walkthroughs.verdict({
        params: { id, item: "s1" },
        payload: { kind: "rejected", note: "Shorter, please." },
      });
      const failed = latest(yield* written(2));
      assert.strictEqual(
        failed.redirectError,
        "The Session is in use elsewhere, such as Claude Code in a terminal.",
      );
      assert.isUndefined(failed.redirectSentAt);

      refuse = false;
      yield* client.walkthroughs.redirect({ params: { id } });
      const retried = latest(yield* written(2));
      assert.isDefined(retried.redirectSentAt);
      assert.isUndefined(retried.redirectError);
      assert.include(sent.at(-1) ?? "", "Shorter, please.");
    }),
  );
});
