import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export class Greeting extends Schema.Class<Greeting>("Greeting")({
  message: Schema.String,
  runtime: Schema.String,
}) {}

export class GreetingsGroup extends HttpApiGroup.make("greetings").add(
  HttpApiEndpoint.get("hello", "/hello", {
    query: { name: Schema.optional(Schema.String) },
    success: Greeting,
  }),
) {}

// Mounted under /api so it lines up with Next's app/api/[[...path]] route.
export class FernApi extends HttpApi.make("fern").add(GreetingsGroup).prefix("/api") {}
