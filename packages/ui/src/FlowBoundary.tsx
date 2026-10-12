import { CheckIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// Who passes a boundary between two Phases: the developer (locked, with the clean streak towards
// Autonomy where it can be earned), or Fern under Autonomy, which it may already have done. A
// boundary whose Autonomy an Escape withdrew needs the developer again, and says why.
export type BoundaryState =
  | { kind: "needsYou"; streak?: { count: number; threshold: number } }
  | {
      kind: "withdrawn";
      reason: string;
      streak: { count: number; threshold: number };
    }
  | { kind: "byFern" }
  | { kind: "approvedByFern" };

export function FlowBoundary({ state }: { state: BoundaryState }) {
  const label =
    state.kind === "approvedByFern"
      ? "Approved by Fern"
      : state.kind === "byFern"
        ? "Fern approves this"
        : state.kind === "withdrawn"
          ? `Needs you, Autonomy withdrawn: ${state.reason}. ${state.streak.count} of ${state.streak.threshold} clean passes towards Autonomy`
          : state.streak
            ? `Needs you, ${state.streak.count} of ${state.streak.threshold} clean passes towards Autonomy`
            : "Needs you";
  const locked = state.kind === "needsYou" || state.kind === "withdrawn";
  const streak =
    state.kind === "needsYou" || state.kind === "withdrawn"
      ? state.streak
      : undefined;
  return (
    <li
      aria-label={label}
      title={label}
      className={clsx(
        "flex items-center gap-1.5",
        state.kind === "needsYou" && "text-faint",
        state.kind === "withdrawn" && "text-amber/90",
        !locked && "text-mint/90",
      )}
    >
      <span className="h-px w-4 bg-hairline" />
      {locked ? (
        <LockSimpleIcon weight="bold" className="size-3" />
      ) : (
        <CheckIcon
          weight="bold"
          className={clsx("size-3", state.kind === "byFern" && "opacity-60")}
        />
      )}
      {streak && (
        <span className="font-mono text-[10px] tabular-nums">
          {streak.count}/{streak.threshold}
        </span>
      )}
      {state.kind === "approvedByFern" && (
        <span className="text-[11px]">approved by Fern</span>
      )}
      {state.kind === "withdrawn" && (
        <span className="text-[11px]">Autonomy withdrawn</span>
      )}
      <span className="h-px w-4 bg-hairline" />
    </li>
  );
}
