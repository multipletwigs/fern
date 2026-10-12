import { useAtomValue } from "@effect/atom-react";
import { AssignmentCard } from "@repo/ui/AssignmentCard";
import { Empty } from "@repo/ui/Empty";
import { HandBackCard } from "@repo/ui/HandBackCard";
import { SubagentHeading } from "@repo/ui/SubagentHeading";
import { ThinkingLine } from "@repo/ui/ThinkingLine";
import { TranscriptRow } from "@repo/ui/TranscriptRow";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { type Components, Virtuoso } from "react-virtuoso";
import { type SubagentView as View, subagentAtom, subagentKey } from "./atoms";
import { ItemView } from "./ItemView";
import { type Row, toRows } from "./rows";
import { ToolRun } from "./ToolRun";

interface ListContext {
  readonly sessionId: string;
  readonly view: View;
  readonly onOpenSubagent: (agentId: string) => void;
}

// A Subagent's tab, in place of the chat: its header and Assignment, then its work drawn as the
// chat draws it, kept current while it runs, then its Hand-back. Read-only: a Subagent can't be
// messaged.
export function SubagentView({
  sessionId,
  agentId,
  onOpenSubagent,
}: {
  sessionId: string;
  agentId: string;
  onOpenSubagent: (agentId: string) => void;
}) {
  const result = useAtomValue(subagentAtom(subagentKey(sessionId, agentId)));
  const view = AsyncResult.isSuccess(result) ? result.value : undefined;
  const items = view?.items;
  const rows = useMemo(() => (items ? toRows(items) : []), [items]);
  const context = useMemo(
    () => (view ? { sessionId, view, onOpenSubagent } : undefined),
    [sessionId, view, onOpenSubagent],
  );
  return (
    <div className="absolute inset-0 z-[1] flex flex-col bg-[#0a0a0a]">
      {context?.view.header ? (
        <Virtuoso
          className="flex-1"
          data={rows}
          context={context}
          computeItemKey={(_, row) => row.id}
          followOutput="auto"
          increaseViewportBy={800}
          components={listComponents}
          itemContent={renderItem}
        />
      ) : (
        <Empty text="Opening Subagent…" />
      )}
    </div>
  );
}

const listComponents: Components<Row, ListContext> = {
  Header: ({ context: { view } }) => (
    <TranscriptRow id="assignment">
      {view.header && (
        <SubagentHeading
          agentType={view.header.agentType}
          description={view.header.description}
          status={view.header.status}
          durationMs={view.header.durationMs}
          toolCalls={view.header.toolCalls}
          tokens={view.header.tokens}
        />
      )}
      <AssignmentCard>{view.assignment}</AssignmentCard>
    </TranscriptRow>
  ),
  Footer: ({ context: { view } }) => (
    <>
      {view.handBack !== undefined && (
        <TranscriptRow id="hand-back">
          <HandBackCard>{view.handBack}</HandBackCard>
        </TranscriptRow>
      )}
      <div className="h-14">
        {view.header?.status === "running" && <ThinkingLine />}
      </div>
    </>
  ),
};

const renderItem = (_: number, row: Row, context: ListContext) => (
  <TranscriptRow id={row.id}>
    {row._tag === "ToolRun" ? (
      <ToolRun
        sessionId={context.sessionId}
        name={row.name}
        calls={row.calls}
      />
    ) : (
      <ItemView
        sessionId={context.sessionId}
        item={row.item}
        onOpenSubagent={context.onOpenSubagent}
      />
    )}
  </TranscriptRow>
);
