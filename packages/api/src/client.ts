import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { FernApi } from "./Api";

export const makeClient = (baseUrl?: string) =>
  HttpApiClient.make(FernApi, { baseUrl }).pipe(Effect.provide(FetchHttpClient.layer));
