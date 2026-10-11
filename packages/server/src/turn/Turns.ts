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
  SessionBusy,
  SessionInUse,
  SessionNotFound,
  TranscriptError,
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
  Ref,
  Stream,
} from "effect";
import { isProject, sdk } from "../agentSdk";

type TurnMap = Map<string, HostedTurn>;

// Marks a turn as running on the Session unless one already is, or another process is writing it.
const claim = (
  all: TurnMap,
  id: string,
  lastActivityMs: number,
  nowMs: number,
): readonly [SessionBusy | SessionInUse | undefined, TurnMap] => {
  const turn = all.get(id);
  if (turn?.running) return [new SessionBusy({ id }), all];
  if (isInUseElsewhere(lastActivityMs, turn, nowMs))
    return [new SessionInUse({ id }), all];
  return [undefined, new Map(all).set(id, { running: true })];
};

// Why a turn's result message says it failed, if it does.
const resultError = (message: SDKMessage) => {
  if (message.type !== "result" || !message.is_error) return undefined;
  return message.subtype === "success"
    ? message.result
    : message.errors.join("\n") || message.subtype;
};

// The message as the one user turn Claude Code resumes the Session with: images first, then text.
async function* userTurn({ text, images = [] }: OutgoingMessage) {
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
}

// Turns Fern runs on a Session itself, by resuming it through the Agent SDK, or by starting a new
// Session. One turn at a time per Session; tool permissions go through Claude Code's auto mode.
export class Turns extends Context.Service<
  Turns,
  {
    send(
      id: string,
      message: OutgoingMessage,
    ): Effect.Effect<
      void,
      SessionNotFound | SessionBusy | SessionInUse | TranscriptError
    >;
    // Starts a new Session in a Project's folder with this message, and returns its id.
    start(
      cwd: string,
      message: OutgoingMessage,
    ): Effect.Effect<string, ProjectNotFound | TranscriptError>;
    // Stops the running turn the way Esc does in Claude Code, or forcibly if it doesn't stop.
    interrupt(id: string): Effect.Effect<void>;
    // The latest turn Fern ran on the Session, if any.
    turn(id: string): Effect.Effect<HostedTurn | undefined>;
    // Sessions with a turn running right now.
    readonly running: Effect.Effect<ReadonlyArray<string>>;
  }
>()("@repo/server/turn/Turns") {
  static readonly layer = Layer.effect(
    Turns,
    Effect.gen(function* () {
      const fibers = yield* FiberMap.make<string, void, TranscriptError>();
      const turns = yield* Ref.make<TurnMap>(new Map());
      // The live query per Session, so an interrupt can reach it.
      const queries = new Map<string, Query>();

      const setTurn = (id: string, turn: HostedTurn) =>
        Ref.update(turns, (all) => new Map(all).set(id, turn));

      // `session` either resumes the Session or names the new one.
      const run = (
        id: string,
        message: OutgoingMessage,
        session: Pick<Options, "resume" | "sessionId" | "cwd">,
      ) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            const turn = query({
              prompt: userTurn(message),
              options: { ...session, permissionMode: "auto" },
            });
            queries.set(id, turn);
            return turn;
          }),
          (turn) =>
            Stream.fromAsyncIterable(
              turn,
              (cause) => new TranscriptError({ message: String(cause) }),
            ).pipe(
              Stream.runFold(
                (): string | undefined => undefined,
                (error, event) => resultError(event) ?? error,
              ),
            ),
          (turn) =>
            Effect.sync(() => {
              queries.delete(id);
              turn.close();
            }),
        ).pipe(
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const endedAt = yield* DateTime.now;
              const error = Exit.isSuccess(exit)
                ? exit.value
                : Cause.hasInterruptsOnly(exit.cause)
                  ? undefined
                  : Cause.pretty(exit.cause);
              yield* setTurn(id, { running: false, endedAt, error });
            }),
          ),
        );

      const send = Effect.fn("Turns.send")(function* (
        id: string,
        message: OutgoingMessage,
      ) {
        const info = yield* sdk("getSessionInfo", () =>
          getSessionInfo(id),
        ).pipe(
          Effect.filterOrFail(
            Predicate.isNotUndefined,
            () => new SessionNotFound({ id }),
          ),
        );
        const now = yield* Clock.currentTimeMillis;
        // Claim the Session atomically, so two sends can't both start a turn.
        const refused = yield* Ref.modify(turns, (all) =>
          claim(all, id, info.lastModified, now),
        );
        if (refused) return yield* refused;
        return yield* FiberMap.run(
          fibers,
          id,
          run(id, message, { resume: id, cwd: info.cwd }),
        ).pipe(Effect.asVoid);
      });

      const start = Effect.fn("Turns.start")(function* (
        cwd: string,
        message: OutgoingMessage,
      ) {
        if (!(yield* isProject(cwd)))
          return yield* new ProjectNotFound({ root: cwd });
        const id = crypto.randomUUID();
        yield* setTurn(id, { running: true });
        yield* FiberMap.run(
          fibers,
          id,
          run(id, message, { sessionId: id, cwd }),
        );
        return id;
      });

      const interrupt = Effect.fn("Turns.interrupt")(function* (id: string) {
        const fiber = yield* FiberMap.get(fibers, id);
        if (Option.isNone(fiber)) return;
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

      return Turns.of({
        send,
        start,
        interrupt,
        turn: (id) => Ref.get(turns).pipe(Effect.map((all) => all.get(id))),
        running: Ref.get(turns).pipe(
          Effect.map((all) =>
            Array.from(all).flatMap(([id, turn]) => (turn.running ? [id] : [])),
          ),
        ),
      });
    }),
  );
}
