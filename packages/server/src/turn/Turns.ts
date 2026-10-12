import {
  getSessionInfo,
  type Options,
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type HostedTurn,
  isInUseElsewhere,
  type OutgoingMessage,
  ProjectNotFound,
  SessionInUse,
  SessionNotFound,
  TranscriptError,
  type WorktreeError,
} from "@repo/api";
import {
  Cause,
  Clock,
  Context,
  DateTime,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Layer,
  Option,
  Predicate,
  PubSub,
  Ref,
  Stream,
} from "effect";
import { sdk } from "../agentSdk";
import { Snapshots } from "../snapshot/Snapshots";
import { FernTools } from "./FernTools";
import { Worktrees } from "../worktree/Worktrees";
import { HostedSessions } from "./HostedSessions";

type TurnMap = Map<string, HostedTurn>;

// When a turn ran, and where. Kept so a Walkthrough can warn about other Sessions that worked in the
// same repository at the same time.
interface TurnWindow {
  readonly id: string;
  readonly cwd: string;
  readonly startedAt: number;
  endedAt: number | undefined;
}
const MAX_WINDOWS = 500;

// A turn Fern ran that finished on its own: not stopped by the developer, and without an error.
export interface FinishedTurn {
  readonly id: string;
  readonly cwd: string;
}

// Marks a turn as running on the Session, unless another process is writing it.
const claim = (
  all: TurnMap,
  id: string,
  lastActivityMs: number,
  nowMs: number,
): readonly [SessionInUse | undefined, TurnMap] => {
  const turn = all.get(id);
  if (isInUseElsewhere(lastActivityMs, turn, nowMs))
    return [new SessionInUse({ id }), all];
  return [
    undefined,
    new Map(all).set(id, {
      running: true,
      contextWindow: turn?.contextWindow,
    }),
  ];
};

// A message waiting in a Session's queue.
interface Queued {
  readonly id: string;
  readonly message: OutgoingMessage;
}
const summary = (queue: ReadonlyArray<Queued>) =>
  queue.length === 0
    ? undefined
    : queue.map(({ id, message }) => ({
        id,
        text: message.text,
        images: message.images?.length ?? 0,
      }));

// Why a turn's result message says it failed, if it does.
const resultError = (message: SDKMessage) => {
  if (message.type !== "result" || !message.is_error) return undefined;
  return message.subtype === "success"
    ? message.result
    : message.errors.join("\n") || message.subtype;
};

// What a turn's messages tell about it: why it failed, the main loop's model, and that model's
// context window, from the result's per-model usage.
interface TurnReport {
  readonly error: string | undefined;
  readonly model: string | undefined;
  readonly contextWindow: number | undefined;
}
const report = (seen: TurnReport, message: SDKMessage): TurnReport => {
  if (message.type === "system" && message.subtype === "init")
    return { ...seen, model: message.model };
  if (message.type !== "result") return seen;
  const usage = Object.entries(message.modelUsage);
  const main =
    usage.find(([model]) => model === seen.model) ??
    usage.toSorted(([, a], [, b]) => b.contextWindow - a.contextWindow)[0];
  return {
    ...seen,
    error: resultError(message) ?? seen.error,
    contextWindow: main?.[1].contextWindow ?? seen.contextWindow,
  };
};

// The message as the one user turn Claude Code resumes the Session with: images first, then text.
// The input then stays open until `ended` aborts: once it closes, Claude Code can no longer take
// control requests, so an interrupt would go unheard.
async function* userTurn(
  { text, images = [] }: OutgoingMessage,
  ended: AbortSignal,
) {
  const message: SDKUserMessage = {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...images.map((image) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: image.mediaType,
            data: image.data,
          },
        })),
        ...(text.trim() ? [{ type: "text" as const, text: text.trim() }] : []),
      ],
    },
  };
  yield message;
  await new Promise((resolve) =>
    ended.addEventListener("abort", resolve, { once: true }),
  );
}

// Turns Fern runs on a Session itself, by resuming it through the Agent SDK, or by starting a new
// Session. One turn at a time per Session: messages sent meanwhile queue up and run in order once
// it ends. Tool permissions go through Claude Code's auto mode. Every turn of a Hosted Session also
// gets Fern's tools and steering.
export class Turns extends Context.Service<
  Turns,
  {
    // Runs the message as a turn, or queues it behind the running one.
    send(
      id: string,
      message: OutgoingMessage,
    ): Effect.Effect<void, SessionNotFound | SessionInUse | TranscriptError>;
    // Takes a message out of the Session's queue, if it's still there.
    unqueue(id: string, item: string): Effect.Effect<void>;
    // Starts a Hosted Session on a piece of work in a Project, and returns its id. It runs on a
    // branch of its own from `main`, in its own worktree, and its opening prompt goes into the
    // Grill.
    start(
      root: string,
      openingPrompt: OutgoingMessage,
    ): Effect.Effect<string, ProjectNotFound | WorktreeError | TranscriptError>;
    // Stops the running turn the way Esc does in Claude Code, or forcibly if it doesn't stop, and
    // empties the Session's queue.
    interrupt(id: string): Effect.Effect<void>;
    // The latest turn Fern ran on the Session, if any.
    turn(id: string): Effect.Effect<HostedTurn | undefined>;
    // Sessions with a turn running right now.
    readonly running: Effect.Effect<ReadonlyArray<string>>;
    // Other Sessions whose turns ran in the repository at or after `sinceMs`.
    overlapping(
      repo: string,
      sinceMs: number,
      except: string,
    ): Effect.Effect<ReadonlyArray<string>>;
    // Every turn that finishes on its own from now on.
    readonly finished: Stream.Stream<FinishedTurn>;
  }
>()("@repo/server/turn/Turns") {
  static readonly layer = Layer.effect(
    Turns,
    Effect.gen(function* () {
      const snapshots = yield* Snapshots;
      const hosted = yield* HostedSessions;
      const tools = yield* FernTools;
      const worktrees = yield* Worktrees;
      const fibers = yield* FiberMap.make<string, void, TranscriptError>();
      const turns = yield* Ref.make<TurnMap>(new Map());
      const windows: Array<TurnWindow> = [];
      const finished = yield* PubSub.unbounded<FinishedTurn>();
      // The live query per Session, so an interrupt can reach it.
      const queries = new Map<string, Query>();
      // Sessions whose running turn the developer asked to stop.
      const interrupted = new Set<string>();
      // Messages waiting for the running turn per Session, in order. What they say is also on the
      // Session's turn, for the page; the images are only kept here.
      const queues = new Map<string, ReadonlyArray<Queued>>();

      // Queues the message if a turn is running on the Session.
      const enqueue = (all: TurnMap, id: string, message: OutgoingMessage) => {
        const turn = all.get(id);
        if (!turn?.running) return [false, all] as const;
        const queue = [
          ...(queues.get(id) ?? []),
          { id: crypto.randomUUID(), message },
        ];
        queues.set(id, queue);
        return [
          true,
          new Map(all).set(id, { ...turn, queued: summary(queue) }),
        ] as const;
      };

      const setTurn = (id: string, turn: HostedTurn) =>
        Ref.update(turns, (all) => new Map(all).set(id, turn));

      // The working tree before Fern's first turn on a Session, which its Walkthroughs start from.
      // A folder outside git just has no Walkthroughs.
      const markStart = (cwd: string, id: string) =>
        snapshots.repo(cwd).pipe(
          Effect.flatMap((repo) => snapshots.markStart(repo, id)),
          Effect.catch((error) =>
            Effect.logDebug("No start snapshot", error.message),
          ),
        );

      // What the Session's next turn runs with besides the message: nothing for an External
      // Session, Fern's tools and steering for a Hosted one.
      const extras = (id: string) =>
        Effect.gen(function* () {
          if (!(yield* hosted.isHosted(id))) return {};
          const { mcpServers, allowedTools, appendSystemPrompt } =
            yield* tools.options(id);
          return {
            mcpServers: { ...mcpServers },
            allowedTools: [...allowedTools],
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              append: appendSystemPrompt,
            },
          } satisfies Options;
        });

      // `session` either resumes the Session or names the new one.
      const run = (
        id: string,
        message: OutgoingMessage,
        session: Pick<Options, "resume" | "sessionId"> & { cwd: string },
      ) =>
        Effect.acquireUseRelease(
          Effect.map(extras(id), (extra) => {
            windows.push({
              id,
              cwd: session.cwd,
              startedAt: Date.now(),
              endedAt: undefined,
            });
            if (windows.length > MAX_WINDOWS) windows.shift();
            const ended = new AbortController();
            const turn = query({
              prompt: userTurn(message, ended.signal),
              options: {
                ...extra,
                ...session,
                permissionMode: "auto",
                ...(message.model ? { model: message.model } : {}),
              },
            });
            queries.set(id, turn);
            return { turn, ended };
          }),
          ({ turn }) =>
            Stream.fromAsyncIterable(
              turn,
              (cause) => new TranscriptError({ message: String(cause) }),
            ).pipe(
              // With its input open, Claude Code waits for more after the result; the turn is over.
              Stream.takeUntil((event) => event.type === "result"),
              Stream.runFold(
                (): TurnReport => ({
                  error: undefined,
                  model: undefined,
                  contextWindow: undefined,
                }),
                report,
              ),
            ),
          ({ turn, ended }) =>
            Effect.sync(() => {
              queries.delete(id);
              ended.abort();
              turn.close();
            }),
        );

      // Runs the message as a turn, then each message queued meanwhile, in order, until the queue
      // is empty or the developer stops a turn.
      const serve = (
        id: string,
        first: OutgoingMessage,
        session: Pick<Options, "resume" | "sessionId"> & { cwd: string },
      ) =>
        Effect.gen(function* () {
          let message = first;
          let options = session;
          while (true) {
            const exit = yield* Effect.exit(run(id, message, options));
            const endedAt = yield* DateTime.now;
            // A turn the developer stopped ended as asked, not with an error.
            const stopped = interrupted.delete(id);
            const reported = Exit.isSuccess(exit) ? exit.value : undefined;
            const error = stopped
              ? undefined
              : Exit.isSuccess(exit)
                ? exit.value.error
                : Cause.hasInterruptsOnly(exit.cause)
                  ? undefined
                  : Cause.pretty(exit.cause);
            const window = windows.findLast((w) => w.id === id);
            if (window) window.endedAt = DateTime.toEpochMillis(endedAt);
            // The next queued message starts in the same step, so the Session never looks idle
            // between the two turns.
            const next = yield* Ref.modify(turns, (all) => {
              const contextWindow =
                reported?.contextWindow ?? all.get(id)?.contextWindow;
              const [head, ...rest] = stopped ? [] : (queues.get(id) ?? []);
              if (rest.length > 0) queues.set(id, rest);
              else queues.delete(id);
              const turn: HostedTurn = head
                ? { running: true, contextWindow, queued: summary(rest) }
                : { running: false, endedAt, error, contextWindow };
              return [head, new Map(all).set(id, turn)] as const;
            });
            if (next) {
              message = next.message;
              options = { resume: id, cwd: session.cwd };
              continue;
            }
            // Walkthroughs follow the last turn of a run, once nothing is left queued.
            if (!stopped && Exit.isSuccess(exit) && error === undefined)
              yield* PubSub.publish(finished, { id, cwd: session.cwd });
            return;
          }
        }).pipe(
          // Stopped forcibly: the turn and everything queued behind it are over.
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              interrupted.delete(id);
              queues.delete(id);
              const endedAt = yield* DateTime.now;
              const window = windows.findLast((w) => w.id === id);
              if (window && window.endedAt === undefined)
                window.endedAt = DateTime.toEpochMillis(endedAt);
              yield* Ref.update(turns, (all) =>
                new Map(all).set(id, {
                  running: false,
                  endedAt,
                  contextWindow: all.get(id)?.contextWindow,
                }),
              );
            }),
          ),
        );

      const send = Effect.fn("Turns.send")(function* (
        id: string,
        message: OutgoingMessage,
      ) {
        // A Session just started may not be on disk yet; behind its first turn, it doesn't need to be.
        if (yield* Ref.modify(turns, (all) => enqueue(all, id, message)))
          return yield* Effect.void;
        const info = yield* sdk("getSessionInfo", () =>
          getSessionInfo(id),
        ).pipe(
          Effect.filterOrFail(
            Predicate.isNotUndefined,
            () => new SessionNotFound({ id }),
          ),
        );
        const now = yield* Clock.currentTimeMillis;
        // Queue or claim atomically, so two sends can't both start a turn, and a message can't
        // queue behind a turn that has just ended.
        const outcome = yield* Ref.modify(
          turns,
          (all): readonly ["queued" | SessionInUse | undefined, TurnMap] => {
            const [queued, next] = enqueue(all, id, message);
            if (queued) return ["queued", next];
            return claim(all, id, info.lastModified, now);
          },
        );
        if (outcome === "queued") return yield* Effect.void;
        if (outcome) return yield* outcome;
        yield* markStart(info.cwd ?? "", id);
        return yield* FiberMap.run(
          fibers,
          id,
          serve(id, message, { resume: id, cwd: info.cwd ?? "" }),
        ).pipe(Effect.asVoid);
      });

      const start = Effect.fn("Turns.start")(function* (
        root: string,
        openingPrompt: OutgoingMessage,
      ) {
        if (!(yield* hosted.isProject(root)))
          return yield* new ProjectNotFound({ root });
        // From a Session's worktree, as /clear there does, the work is still the Project's.
        const project =
          (yield* hosted.worktrees).find((w) => w.cwd === root)?.projectRoot ??
          root;
        const worktree = yield* worktrees.create(project, openingPrompt.text);
        const id = crypto.randomUUID();
        yield* hosted.record(id, worktree);
        yield* setTurn(id, { running: true });
        yield* markStart(worktree.cwd, id);
        // Only the developer can start a skill, so Fern sends the Grill's for them.
        const message = {
          ...openingPrompt,
          text: `/grill-with-docs ${openingPrompt.text.trim()}`.trim(),
        };
        yield* FiberMap.run(
          fibers,
          id,
          serve(id, message, { sessionId: id, cwd: worktree.cwd }),
        );
        return id;
      });

      const interrupt = Effect.fn("Turns.interrupt")(function* (id: string) {
        const fiber = yield* FiberMap.get(fibers, id);
        if (Option.isNone(fiber)) return;
        interrupted.add(id);
        queues.delete(id);
        yield* Ref.update(turns, (all) => {
          const turn = all.get(id);
          return turn
            ? new Map(all).set(id, { ...turn, queued: undefined })
            : all;
        });
        const turn = queries.get(id);
        if (turn)
          yield* Effect.tryPromise(() => turn.interrupt()).pipe(
            Effect.timeoutOption("3 seconds"),
            Effect.ignore,
          );
        const stopped = yield* Fiber.join(fiber.value).pipe(
          Effect.exit,
          Effect.timeoutOption("5 seconds"),
        );
        if (Option.isNone(stopped)) yield* Fiber.interrupt(fiber.value);
      });

      const unqueue = (id: string, item: string) =>
        Ref.update(turns, (all) => {
          const turn = all.get(id);
          const queue = (queues.get(id) ?? []).filter((q) => q.id !== item);
          if (queue.length > 0) queues.set(id, queue);
          else queues.delete(id);
          return turn
            ? new Map(all).set(id, { ...turn, queued: summary(queue) })
            : all;
        });

      return Turns.of({
        send,
        unqueue,
        start,
        interrupt,
        turn: (id) => Ref.get(turns).pipe(Effect.map((all) => all.get(id))),
        running: Ref.get(turns).pipe(
          Effect.map((all) =>
            Array.from(all).flatMap(([id, turn]) => (turn.running ? [id] : [])),
          ),
        ),
        overlapping: (repo, sinceMs, except) =>
          Effect.sync(() => [
            ...new Set(
              windows
                .filter(
                  (w) =>
                    w.id !== except &&
                    (w.cwd === repo || w.cwd.startsWith(`${repo}/`)) &&
                    (w.endedAt === undefined || w.endedAt >= sinceMs),
                )
                .map((w) => w.id),
            ),
          ]),
        finished: Stream.fromPubSub(finished),
      });
    }),
  );
}
