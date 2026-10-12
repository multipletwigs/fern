import { CheckIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { clsx } from "clsx";

// Who passes a boundary between two Phases: the developer (locked, with the clean streak towards
// Autonomy where it can be earned), or Fern under Autonomy, which it may already have done.
export type BoundaryState =
  | { kind: "needsYou"; streak?: { count: number; threshold: number } }
  | { kind: "byFern" }
  | { kind: "approvedByFern" };

export function FlowBoundary({ state }: { state: BoundaryState }) {
  const label =
    state.kind === "approvedByFern"
      ? "Approved by Fern"
      : state.kind === "byFern"
        ? "Fern approves this"
        : state.streak
          ? `Needs you, ${state.streak.count} of ${state.streak.threshold} clean passes towards Autonomy`
          : "Needs you";
  return (
    <li
      aria-label={label}
      title={label}
      className={clsx(
        "flex items-center gap-1.5",
        state.kind === "needsYou" ? "text-faint" : "text-mint/90",
      )}
    >
      <span className="h-px w-4 bg-hairline" />
      {state.kind === "needsYou" ? (
        <LockSimpleIcon weight="bold" className="size-3" />
      ) : (
        <CheckIcon
          weight="bold"
          className={clsx("size-3", state.kind === "byFern" && "opacity-60")}
        />
      )}
      {state.kind === "needsYou" && state.streak && (
        <span className="font-mono text-[10px] tabular-nums">
          {state.streak.count}/{state.streak.threshold}
        </span>
      )}
      {state.kind === "approvedByFern" && (
        <span className="text-[11px]">approved by Fern</span>
      )}
      <span className="h-px w-4 bg-hairline" />
    </li>
  );
}
