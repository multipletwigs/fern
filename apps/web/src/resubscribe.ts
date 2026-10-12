import { Data, type Schedule, Stream } from "effect";

// A live stream that ended. The server keeps a live stream open while anyone watches it, so one
// that ends has lost its source, and the page would otherwise keep its last update for good.
export class LiveStreamEnded extends Data.TaggedError("LiveStreamEnded") {}

// Keeps a live stream from the server going: resubscribes on `schedule` when the connection drops,
// the server fails it, or the server ends it.
export const resubscribe =
  <X, E2, R2>(schedule: Schedule.Schedule<X, unknown, E2, R2>) =>
  <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    stream.pipe(
      Stream.concat(Stream.fail(new LiveStreamEnded())),
      Stream.retry(schedule),
    );
