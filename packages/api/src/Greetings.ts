import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export class Greeting extends Schema.Class<Greeting>("Greeting")({
  message: Schema.String,
  count: Schema.Int,
  greetedAt: Schema.DateTimeUtc,
}) {}

export class GreetingsApi extends HttpApiGroup.make("greetings")
  .add(
    HttpApiEndpoint.get("hello", "/hello", {
      query: { name: Schema.optional(Schema.NonEmptyString) },
      success: Greeting,
    }),
  )
  .prefix("/greetings") {}
