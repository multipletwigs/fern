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
  MessageDelivered,
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
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberMap,
  Layer,
  Option,
  PubSub,
  Queue,
  Schema,
  Stream,
} from "effect";
import { sdk } from "../agentSdk";
import { Snapshots } from "../snapshot/Snapshots";
import { FernTools } from "./FernTools";
import { Worktrees } from "../worktree/Worktrees";
import { HostedSessions } from "./HostedSessions";

// How long a Session's Claude Code process stays open with nothing to do. The next message resumes
// the Session in a new one.
export const IDLE_TIMEOUT = Duration.minutes(10);

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

// A message sent to a Session, until Claude Code has taken it in. Its id is the uuid Claude Code
// reports it by.
interface Sent {
  readonly id: ReturnType<typeof crypto.randomUUID>;
  readonly message: OutgoingMessage;
  // Sent into a running turn, so it shows in the queue until taken in. The message that starts a
  // turn shows in the transcript instead.
  readonly queued: boolean;
  // Claude Code has it, so it can't be taken back.
  delivered: boolean;
}
const summary = (sent: ReadonlyArray<Sent>) => {
  const queued = sent.filter((s) => s.queued);
  return queued.length === 0
    ? undefined
    : queued.map(({ id, message, delivered }) => ({
        id,
        text: message.text,
        images: message.images?.length ?? 0,
        delivered,
      }));
};

// The message as a user turn Claude Code takes in: images first, then text.
const userMessage = ({ id, message }: Sent): SDKUserMessage => ({
  type: "user",
  uuid: id,
  parent_tool_use_id: null,
  message: {
    role: "user",
    content: [
      ...(message.images ?? []).map((image) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: image.mediaType,
          data: image.data,
        },
      })),
      ...(message.text.trim()
        ? [{ type: "text" as const, text: message.text.trim() }]
        : []),
    ],
  },
});

// Claude Code reports each message it was sent going through its queue: queued, started (taken in,
// at the next tool call or as a turn of its own), then completed or cancelled. The SDK doesn't
// declare the message.
const decodeLifecycle = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal("command_lifecycle"),
    command_uuid: Schema.String,
    state: Schema.String,
  }),
);
// The messages Claude Code says it has taken in.
const takenIn = (message: SDKMessage): ReadonlyArray<string> => {
  const lifecycle = decodeLifecycle(message);
  if (Option.isSome(lifecycle))
    return lifecycle.value.state === "queued"
      ? []
      : [lifecycle.value.command_uuid];
  return message.type === "assistant" || message.type === "result"
    ? (message.user_message_uuids ?? [])
    : [];
};

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

// Where Claude Code is in a turn, from its messages. A result only ends the main loop: background
// tasks keep running in Claude Code, and each one's notification runs as another turn with its own
// result. The turn is over at a result with no background task left.
interface Progress {
  // Background tasks running. Each `background_tasks_changed` carries the whole set; ambient tasks
  // aren't activity.
  readonly background: number;
  // Whether the agent has said anything yet.
  readonly spoke: boolean;
  // Whether a task notification came since the last result.
  readonly notified: boolean;
  readonly over: boolean;
}
const startProgress = (): Progress => ({
  background: 0,
  spoke: false,
  notified: false,
  over: false,
});
const progress = (seen: Progress, message: SDKMessage): Progress => {
  if (message.type === "assistant") return { ...seen, spoke: true };
  if (
    message.type === "system" &&
    message.subtype === "background_tasks_changed"
  )
    return {
      ...seen,
      background: message.tasks.filter((task) => !task.ambient).length,
    };
  if (message.type === "system" && message.subtype === "task_notification")
    return { ...seen, notified: true };
  if (message.type !== "result") return seen;
  // Resumed after a background task was stopped, Claude Code answers its notification with an empty
  // result before it reads the message.
  const leftover = seen.notified && !seen.spoke && message.num_turns === 0;
  return {
    ...seen,
    notified: false,
    over: seen.background === 0 && !leftover,
  };
};

// A Session's Claude Code process, open from its first message until it has sat idle for
// IDLE_TIMEOUT or the Session is archived.
interface Process {
  readonly id: string;
  readonly cwd: string;
  // Tells this process apart from the Session's earlier and later ones.
  readonly key: string;
  // Messages on their way to Claude Code.
  readonly input: Queue.Queue<Sent, Cause.Done>;
  query: Query | undefined;
  // Messages sent that Claude Code hasn't taken in yet, in order.
  sent: Array<Sent>;
  progress: Progress;
  report: TurnReport;
  // Set once the developer stops the running turn, until it has stopped.
  stopping: Deferred.Deferred<void> | undefined;
}

// Turns Fern runs on a Session itself, by resuming it through the Agent SDK, or by starting a new
// Session. Each Session gets one long-lived Claude Code process, fed through its open input: a
// message sent while a turn runs goes straight in, and Claude Code takes it in at the next tool
// call; one sent while idle starts a new turn. A turn lasts from a message being taken in until a
// result with no background task left. Tool permissions go through Claude Code's auto mode. A
// Hosted Session's process also gets Fern's tools and steering.
export class Turns extends Context.Service<
  Turns,
  {
    // Sends the message to the Session: into its running turn, or as a new one.
    send(
      id: string,
      message: OutgoingMessage,
    ): Effect.Effect<void, SessionNotFound | SessionInUse | TranscriptError>;
    // Takes a message out of the Session's queue, unless Claude Code has it already.
    unqueue(id: string, item: string): Effect.Effect<void, MessageDelivered>;
    // Starts a Hosted Session on a piece of work in a Project, and returns its id. It runs on a
    // branch of its own from `main`, in its own worktree, or in place outside git or before the
    // first commit. Its opening prompt goes into the Grill.
    start(
      root: string,
      openingPrompt: OutgoingMessage,
    ): Effect.Effect<string, ProjectNotFound | WorktreeError | TranscriptError>;
    // Stops the running turn the way Esc does in Claude Code, or forcibly if it doesn't stop.
    // Messages Claude Code doesn't have yet are dropped; the ones it has run next.
    interrupt(id: string): Effect.Effect<void>;
    // Closes the Session's Claude Code process, stopping its turn if one runs.
    close(id: string): Effect.Effect<void>;
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
      // Each open process's fiber, by its key.
      const fibers = yield* FiberMap.make<string>();
      // Each idle Session's countdown to closing its process.
      const idleTimers = yield* FiberMap.make<string>();
      const finished = yield* PubSub.unbounded<FinishedTurn>();
      // State only changes inside `Effect.sync` blocks, so each change is atomic.
      const turns = new Map<string, HostedTurn>();
      const processes = new Map<string, Process>();
      const windows: Array<TurnWindow> = [];
      let opened = 0;

      const showQueue = (process: Process) => {
        const turn = turns.get(process.id);
        if (turn)
          turns.set(process.id, { ...turn, queued: summary(process.sent) });
      };

      // A turn starts on the Session.
      const begin = (process: Process) => {
        turns.set(process.id, {
          running: true,
          contextWindow: turns.get(process.id)?.contextWindow,
          queued: summary(process.sent),
        });
        process.progress = startProgress();
        process.report = { ...process.report, error: undefined };
        windows.push({
          id: process.id,
          cwd: process.cwd,
          startedAt: Date.now(),
          endedAt: undefined,
        });
        if (windows.length > MAX_WINDOWS) windows.shift();
      };

      // The Session's turn is over. Returns whether it finished on its own.
      const end = (
        process: Process,
        endedAt: DateTime.Utc,
        failure?: string,
      ) => {
        const stopped = process.stopping !== undefined;
        const error = stopped ? undefined : (failure ?? process.report.error);
        turns.set(process.id, {
          running: false,
          endedAt,
          error,
          contextWindow:
            process.report.contextWindow ??
            turns.get(process.id)?.contextWindow,
        });
        const window = windows.findLast((w) => w.id === process.id);
        if (window && window.endedAt === undefined)
          window.endedAt = DateTime.toEpochMillis(endedAt);
        if (process.stopping) Deferred.doneUnsafe(process.stopping, Exit.void);
        process.stopping = undefined;
        return !stopped && error === undefined;
      };

      // Closes the process once its Session has been idle long enough.
      const closeWhenIdle = (process: Process) =>
        FiberMap.run(
          idleTimers,
          process.id,
          Effect.sleep(IDLE_TIMEOUT).pipe(
            Effect.andThen(
              Effect.sync(
                () =>
                  processes.get(process.id) === process &&
                  !turns.get(process.id)?.running &&
                  processes.delete(process.id),
              ),
            ),
            Effect.flatMap((idle) =>
              idle ? FiberMap.remove(fibers, process.key) : Effect.void,
            ),
          ),
        );

      // Follows one message from Claude Code.
      const observe = (process: Process, message: SDKMessage) =>
        Effect.gen(function* () {
          const endedAt = yield* DateTime.now;
          const outcome = yield* Effect.sync(() => {
            const taken = takenIn(message);
            if (taken.length > 0) {
              process.sent = process.sent.filter((s) => !taken.includes(s.id));
              showQueue(process);
            }
            if (!turns.get(process.id)?.running) {
              // Claude Code started a turn on its own.
              const starts =
                message.type === "assistant" ||
                (message.type === "system" && message.subtype === "init");
              if (!starts) return "idle" as const;
              begin(process);
            }
            process.progress = progress(process.progress, message);
            process.report = report(process.report, message);
            if (message.type !== "result") return "running" as const;
            const stopped = process.stopping !== undefined;
            if (!stopped && !process.progress.over) return "running" as const;
            // Claude Code still has messages to take in, as turns of their own.
            if (process.sent.length > 0) {
              // What the developer stopped is over; what follows starts afresh.
              if (process.stopping) {
                Deferred.doneUnsafe(process.stopping, Exit.void);
                process.stopping = undefined;
                process.progress = startProgress();
                process.report = { ...process.report, error: undefined };
              }
              return "running" as const;
            }
            return end(process, endedAt)
              ? ("finished" as const)
              : ("ended" as const);
          });
          if (outcome === "finished")
            yield* PubSub.publish(finished, {
              id: process.id,
              cwd: process.cwd,
            });
          if (outcome === "finished" || outcome === "ended")
            yield* closeWhenIdle(process);
        });

      // What the Session's process runs with besides its messages: nothing for an External
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

      // Messages go to Claude Code as it reads its input, unless taken back first.
      const inputOf = (process: Process) =>
        Stream.toAsyncIterable(
          Stream.fromQueue(process.input).pipe(
            Stream.filter((sent) => process.sent.includes(sent)),
            Stream.tap((sent) =>
              Effect.sync(() => {
                sent.delivered = true;
                showQueue(process);
              }),
            ),
            Stream.map(userMessage),
          ),
        );

      // Runs the Session's process until it closes. `session` either resumes the Session or names
      // the new one.
      const serve = (
        process: Process,
        session: Pick<Options, "resume" | "sessionId" | "model">,
      ) =>
        Effect.acquireUseRelease(
          Effect.map(extras(process.id), (extra) => {
            const claude = query({
              prompt: inputOf(process),
              options: {
                ...extra,
                ...session,
                cwd: process.cwd,
                permissionMode: "auto",
              },
            });
            process.query = claude;
            return claude;
          }),
          (claude) =>
            Stream.fromAsyncIterable(
              // Read without `return`, which would wait for Claude Code's next message: closing
              // the query is what ends it.
              { [Symbol.asyncIterator]: () => ({ next: () => claude.next() }) },
              (cause) => new TranscriptError({ message: String(cause) }),
            ).pipe(Stream.runForEach((message) => observe(process, message))),
          (claude) => Effect.sync(() => claude.close()),
        ).pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const endedAt = yield* DateTime.now;
              yield* Effect.sync(() => {
                if (processes.get(process.id) === process)
                  processes.delete(process.id);
                process.sent = [];
                if (turns.get(process.id)?.running)
                  end(
                    process,
                    endedAt,
                    Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
                      ? Cause.pretty(exit.cause)
                      : undefined,
                  );
              });
              yield* Queue.end(process.input);
            }),
          ),
        );

      // Sends the message into the Session's process, which is open or opening: into its running
      // turn, or as the one it starts.
      const deliver = (
        process: Process,
        message: OutgoingMessage,
        into: "running" | "new",
      ) => {
        const sent: Sent = {
          id: crypto.randomUUID(),
          message,
          queued: into === "running",
          delivered: false,
        };
        process.sent.push(sent);
        Queue.offerUnsafe(process.input, sent);
        showQueue(process);
      };

      // A process for the Session, with the message as its first turn. It runs once launched.
      const newProcess = (
        id: string,
        cwd: string,
        input: Queue.Queue<Sent, Cause.Done>,
        message: OutgoingMessage,
      ) => {
        const process: Process = {
          id,
          cwd,
          key: `${id}#${++opened}`,
          input,
          query: undefined,
          sent: [],
          progress: startProgress(),
          report: {
            error: undefined,
            model: undefined,
            contextWindow: undefined,
          },
          stopping: undefined,
        };
        processes.set(id, process);
        begin(process);
        deliver(process, message, "new");
        return process;
      };
      const launch = (
        process: Process,
        message: OutgoingMessage,
        session: Pick<Options, "resume" | "sessionId">,
      ) =>
        FiberMap.run(
          fibers,
          process.key,
          serve(process, {
            ...session,
            ...(message.model ? { model: message.model } : {}),
          }),
        );

      // The working tree before Fern's first turn on a Session, which its Walkthroughs start from.
      // A folder outside git just has no Walkthroughs.
      const markStart = (cwd: string, id: string) =>
        snapshots.repo(cwd).pipe(
          Effect.flatMap((repo) => snapshots.markStart(repo, id)),
          Effect.catch((error) =>
            Effect.logDebug("No start snapshot", error.message),
          ),
        );

      // Sends into the running turn, if there is one.
      const intoRunningTurn = (id: string, message: OutgoingMessage) =>
        Effect.sync(() => {
          const process = processes.get(id);
          if (!process || !turns.get(id)?.running) return false;
          deliver(process, message, "running");
          return true;
        });

      const send = Effect.fn("Turns.send")(function* (
        id: string,
        message: OutgoingMessage,
      ) {
        const model = message.model;
        const current = processes.get(id)?.query;
        if (model && current)
          yield* Effect.tryPromise(() => current.setModel(model)).pipe(
            Effect.ignore,
          );
        // A Session just started may not be on disk yet; into its first turn, it doesn't need to be.
        if (yield* intoRunningTurn(id, message)) return yield* Effect.void;
        const info = yield* sdk("getSessionInfo", () => getSessionInfo(id));
        // Before the turn starts, as nothing has changed yet.
        yield* markStart(processes.get(id)?.cwd ?? info?.cwd ?? "", id);
        const now = yield* Clock.currentTimeMillis;
        const input = yield* Queue.unbounded<Sent, Cause.Done>();
        // Sends, starts a turn, or opens a process atomically, so two sends can't both start a
        // turn, and a message can't miss a turn that has just ended.
        const outcome = yield* Effect.sync(() => {
          const process = processes.get(id);
          const turn = turns.get(id);
          if (process && turn?.running) {
            deliver(process, message, "running");
            return "sent" as const;
          }
          if (!process && !info) return new SessionNotFound({ id });
          // Something else, such as Claude Code in a terminal, is writing the Session.
          if (info && isInUseElsewhere(info.lastModified, turn, now))
            return new SessionInUse({ id });
          if (process) {
            begin(process);
            deliver(process, message, "new");
            return process;
          }
          return { opening: newProcess(id, info?.cwd ?? "", input, message) };
        });
        if (outcome === "sent") return yield* Effect.void;
        if (
          outcome instanceof SessionNotFound ||
          outcome instanceof SessionInUse
        )
          return yield* outcome;
        yield* FiberMap.remove(idleTimers, id);
        if ("opening" in outcome)
          return yield* launch(outcome.opening, message, { resume: id }).pipe(
            Effect.asVoid,
          );
        return yield* Effect.void;
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
        // In a folder outside git, or a repo with no commit to branch from, it runs in place.
        const where = (yield* worktrees.branchable(project))
          ? yield* worktrees.create(project, openingPrompt.text)
          : { cwd: project };
        const id = crypto.randomUUID();
        yield* hosted.record(id, where);
        yield* markStart(where.cwd, id);
        // Only the developer can start a skill, so Fern sends the Grill's for them.
        const message = {
          ...openingPrompt,
          text: `/grill-with-docs ${openingPrompt.text.trim()}`.trim(),
        };
        const input = yield* Queue.unbounded<Sent, Cause.Done>();
        const process = yield* Effect.sync(() =>
          newProcess(id, where.cwd, input, message),
        );
        yield* launch(process, message, { sessionId: id });
        return id;
      });

      // Ends the process, and with it any turn it runs.
      const shut = (process: Process) => FiberMap.remove(fibers, process.key);

      const interrupt = Effect.fn("Turns.interrupt")(function* (id: string) {
        const stopping = yield* Deferred.make<void>();
        const process = yield* Effect.sync(() => {
          const open = processes.get(id);
          if (!open || !turns.get(id)?.running) return undefined;
          // What Claude Code doesn't have yet never reaches it.
          open.sent = open.sent.filter((s) => s.delivered);
          showQueue(open);
          open.stopping ??= stopping;
          return open;
        });
        if (!process?.stopping) return;
        const claude = process.query;
        if (claude)
          yield* Effect.tryPromise(() => claude.interrupt()).pipe(
            Effect.timeoutOption("3 seconds"),
            Effect.ignore,
          );
        const stopped = yield* Deferred.await(process.stopping).pipe(
          Effect.timeoutOption("5 seconds"),
        );
        if (Option.isNone(stopped)) yield* shut(process);
      });

      const close = Effect.fn("Turns.close")(function* (id: string) {
        const process = yield* Effect.sync(() => {
          const open = processes.get(id);
          if (open && turns.get(id)?.running)
            open.stopping ??= Deferred.makeUnsafe();
          return open;
        });
        if (process) yield* shut(process);
      });

      const unqueue = (id: string, item: string) =>
        Effect.suspend(() => {
          const process = processes.get(id);
          const sent = process?.sent.find((s) => s.id === item);
          if (!process || !sent) return Effect.void;
          if (sent.delivered)
            return Effect.fail(new MessageDelivered({ id, item }));
          process.sent = process.sent.filter((s) => s !== sent);
          showQueue(process);
          return Effect.void;
        });

      return Turns.of({
        send,
        unqueue,
        start,
        interrupt,
        close,
        turn: (id) => Effect.sync(() => turns.get(id)),
        running: Effect.sync(() =>
          Array.from(turns).flatMap(([id, turn]) => (turn.running ? [id] : [])),
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
