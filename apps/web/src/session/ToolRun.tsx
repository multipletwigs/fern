import { ToolCallRow } from "@repo/ui/ToolCallRow";
import { ItemView } from "./ItemView";
import type { ToolCall } from "./rows";
import { displayName, runSummary } from "./toolName";

// Back-to-back calls to one tool folded into one row; expanding it lists each call.
export function ToolRun({
  sessionId,
  name,
  calls,
}: {
  sessionId: string;
  name: string;
  calls: ReadonlyArray<ToolCall>;
}) {
  const status = calls.some((call) => !call.result)
    ? "running"
    : calls.some((call) => call.result?.isError)
      ? "failed"
      : "done";
  return (
    <ToolCallRow
      name={displayName(name)}
      summary={runSummary(name, calls.length)}
      status={status}
    >
      {calls.map((call) => (
        <ItemView key={call.id} sessionId={sessionId} item={call} />
      ))}
    </ToolCallRow>
  );
}
