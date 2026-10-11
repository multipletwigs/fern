"use client";

import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Cause } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { ApiClient } from "./ApiClient";

// Server rendering and hydration both see "Loading…"; the request runs in the browser. Without this,
// the query runs during SSR in Node, where the relative /api URL can't resolve, and hydration fails.
const greetingAtom = ApiClient.query("greetings", "hello", {
  query: { name: "Fern" },
}).pipe(Atom.withServerValueInitial);

export function Greeting() {
  const result = useAtomValue(greetingAtom);
  const refresh = useAtomRefresh(greetingAtom);

  const text = AsyncResult.match(result, {
    onInitial: () => "Loading…",
    onFailure: ({ cause }) => `Error: ${Cause.pretty(cause)}`,
    onSuccess: ({ value }) => `${value.message} (#${value.count})`,
  });

  return (
    <div>
      <p>{text}</p>
      <button type="button" onClick={refresh}>
        Something
      </button>
    </div>
  );
}
