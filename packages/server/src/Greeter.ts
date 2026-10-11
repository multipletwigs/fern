import { Greeting } from "@repo/api";
import { Context, DateTime, Effect, Layer, Ref } from "effect";

export class Greeter extends Context.Service<
  Greeter,
  {
    greet(name: string): Effect.Effect<Greeting>;
  }
>()("@repo/server/Greeter") {
  static readonly layer = Layer.effect(
    Greeter,
    Effect.gen(function* () {
      const count = yield* Ref.make(0);

      const greet = Effect.fn("Greeter.greet")(function* (name: string) {
        const n = yield* Ref.updateAndGet(count, (c) => c + 1);
        const greetedAt = yield* DateTime.now;
        return Greeting.make({
          message: `Hello, ${name}!`,
          count: n,
          greetedAt,
        });
      });

      return Greeter.of({ greet });
    }),
  );
}
