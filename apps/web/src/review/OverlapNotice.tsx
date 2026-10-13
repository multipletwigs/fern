import type { Walkthrough } from "@repo/api";
import { Callout } from "@repo/ui/Callout";

// Warns that some of a Walkthrough's changes may be another Session's, when Fern ran others in the
// same repository meanwhile.
export function OverlapNotice({ walkthrough }: { walkthrough: Walkthrough }) {
  const others = walkthrough.overlapping.length;
  if (others === 0) return null;
  return (
    <Callout tone="amber">
      Fern ran {others === 1 ? "another Session" : `${others} other Sessions`}{" "}
      in this repository while this changed, so some of these changes may be
      theirs.
    </Callout>
  );
}
