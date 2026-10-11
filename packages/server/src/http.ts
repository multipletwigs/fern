import { FernApi } from "@repo/api";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Greeter } from "./Greeter";

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

// Handlers with their services still required, so tests can swap implementations.
export const HandlersNoDeps = Layer.mergeAll(GreetingsHandlers, SystemHandlers);

export const Handlers = HandlersNoDeps.pipe(Layer.provide(Greeter.layer));
