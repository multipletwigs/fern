import { assert, it } from "@effect/vitest";
import { Effect, Ref, Schedule, Stream } from "effect";
import { resubscribe } from "../src/resubscribe";

it.effect("resubscribes when the server ends a live stream", () =>
  Effect.gen(function* () {
    const subscriptions = yield* Ref.make(0);
    const live = Stream.fromEffect(
      Ref.updateAndGet(subscriptions, (n) => n + 1),
    );
    const seen = yield* live.pipe(
      resubscribe(Schedule.recurs(5)),
      Stream.take(3),
      Stream.runCollect,
    );
    assert.deepStrictEqual(seen, [1, 2, 3]);
  }),
);

it.effect("stops when the schedule gives up on the server's error", () =>
  Effect.gen(function* () {
    const subscriptions = yield* Ref.make(0);
    const live = Stream.fromEffect(
      Ref.update(subscriptions, (n) => n + 1),
    ).pipe(Stream.flatMap(() => Stream.fail("gone" as const)));
    const result = yield* live.pipe(
      resubscribe(
        Schedule.recurs(5).pipe(
          Schedule.while(({ input }) => input !== "gone"),
        ),
      ),
      Stream.runCollect,
      Effect.flip,
    );
    assert.strictEqual(result, "gone");
    assert.strictEqual(yield* Ref.get(subscriptions), 1);
  }),
);
