import { FernApi } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Greeter } from "./Greeter";
import { Transcripts } from "./transcript/Transcripts";

export const GreetingsHandlers = HttpApiBuilder.group(
  FernApi,
  "greetings",
  Effect.fn(function* (handlers) {
    const greeter = yield* Greeter;
    return handlers.handle("hello", ({ query }) =>
      greeter.greet(query.name ?? "world"),
    );
  }),
);

export const SystemHandlers = HttpApiBuilder.group(
  FernApi,
  "system",
  (handlers) => handlers.handle("health", () => Effect.void),
);

export const SessionsHandlers = HttpApiBuilder.group(
  FernApi,
  "sessions",
  Effect.fn(function* (handlers) {
    const transcripts = yield* Transcripts;
    return handlers
      .handle("current", () => transcripts.current)
      .handle("live", ({ params }) => transcripts.live(params.id));
  }),
);

// Handlers with their services still required, so tests can swap implementations.
export const HandlersNoDeps = Layer.mergeAll(
  GreetingsHandlers,
  SystemHandlers,
  SessionsHandlers,
);

export const Handlers = HandlersNoDeps.pipe(
  Layer.provide([Greeter.layer, Transcripts.layer]),
);
