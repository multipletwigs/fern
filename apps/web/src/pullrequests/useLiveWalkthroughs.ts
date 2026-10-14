import { useAtomValue } from "@effect/atom-react";
import type { PrWalkthroughOf } from "@repo/api";
import { Atom, AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { prWalkthroughStatesAtom } from "./atoms";
import { type LiveWalkthroughs, liveWalkthroughs } from "./prWalkthroughs";

// Nothing to watch before the repo is known.
const unknownRepo = Atom.make(
  AsyncResult.initial<ReadonlyArray<PrWalkthroughOf>>(),
);

// Each of the repo's Foreign PRs' latest Walkthrough as it stands now, once the repo and the
// server's answer are known.
export function useLiveWalkthroughs(
  repo: string | undefined,
): LiveWalkthroughs | undefined {
  const result = useAtomValue(
    repo === undefined ? unknownRepo : prWalkthroughStatesAtom(repo),
  );
  return useMemo(
    () =>
      AsyncResult.isSuccess(result)
        ? liveWalkthroughs(result.value)
        : undefined,
    [result],
  );
}
