"use client";

import { makeClient } from "@repo/api/client";
import { Effect } from "effect";
import { useEffect, useState } from "react";

export function Greeting() {
  const [message, setMessage] = useState("Loading…");

  useEffect(() => {
    const program = Effect.gen(function* () {
      const client = yield* makeClient(window.location.origin);
      const greeting = yield* client.greetings.hello({ query: { name: "Fern" } });
      return `${greeting.message} (from ${greeting.runtime})`;
    }).pipe(Effect.catch((error) => Effect.succeed(`Error: ${String(error)}`)));

    Effect.runPromise(program).then(setMessage);
  }, []);

  return <p>{message}</p>;
}
