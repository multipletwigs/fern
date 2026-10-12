import type { SessionRounds } from "@repo/api";
import { GrillRound } from "./GrillRound";
import { SessionDecisions } from "./SessionDecisions";

// The Session's Grill, in place of its transcript: the open Round to answer, or, with none open,
// the Decisions settled so far.
export function GrillView({
  rounds,
  active,
  onSending,
  onFailed,
}: {
  rounds: SessionRounds;
  active: boolean;
  onSending: (text: string) => void;
  onFailed: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[1] bg-[#0a0a0a]">
      {rounds.open ? (
        <GrillRound
          key={rounds.open.id}
          round={rounds.open}
          active={active}
          onSending={onSending}
          onFailed={onFailed}
        />
      ) : (
        <SessionDecisions decisions={rounds.decisions} />
      )}
    </div>
  );
}
