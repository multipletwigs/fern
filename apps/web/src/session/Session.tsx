import { useAtomValue } from "@effect/atom-react";
import type { SessionHeader } from "@repo/api";
import { CacheCountdown } from "@repo/ui/CacheCountdown";
import { Empty } from "@repo/ui/Empty";
import { Glow } from "@repo/ui/Glow";
import { LiveStatus } from "@repo/ui/LiveStatus";
import { TopBar } from "@repo/ui/TopBar";
import { TranscriptRow } from "@repo/ui/TranscriptRow";
import { TranscriptTitle } from "@repo/ui/TranscriptTitle";
import { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { type Components, Virtuoso } from "react-virtuoso";
import { transcriptAtom } from "./atoms";
import { ItemView } from "./ItemView";
import { type Row, toRows } from "./rows";
import { SessionComposer } from "./SessionComposer";
import { isLive, useNow } from "./time";
import { ToolRun } from "./ToolRun";

export function Session({ id }: { id: string }) {
  const result = useAtomValue(transcriptAtom(id));
  const now = useNow();
  const transcript = AsyncResult.isSuccess(result) ? result.value : undefined;
  const header = transcript?.header;
  const items = transcript?.items;
  const rows = useMemo(() => (items ? toRows(items) : []), [items]);
  const live =
    header !== undefined &&
    isLive(DateTime.toEpochMillis(header.lastActivityAt), now);

  return (
    <div className="relative flex h-full flex-col">
      <Glow live={live} />
      <TopBar>
        {header?.cacheExpiresAt && (
          <CacheCountdown
            remainingMs={DateTime.toEpochMillis(header.cacheExpiresAt) - now}
          />
        )}
        <LiveStatus live={live} />
      </TopBar>
      {header ? (
        <Virtuoso
          className="flex-1"
          data={rows}
          context={header}
          computeItemKey={(_, row) => row.id}
          initialTopMostItemIndex={{ index: "LAST", align: "end" }}
          followOutput="smooth"
          increaseViewportBy={800}
          components={listComponents}
          itemContent={renderItem}
        />
      ) : (
        <Empty text="Opening transcript…" />
      )}
      {header && <SessionComposer header={header} now={now} />}
    </div>
  );
}

const titleMeta = (header: SessionHeader) =>
  [header.cwd?.split("/").at(-1), header.gitBranch, header.model]
    .filter(Boolean)
    .join("  ·  ");

const listComponents: Components<Row, SessionHeader> = {
  Header: ({ context }) => (
    <TranscriptTitle meta={titleMeta(context)} title={context.title} />
  ),
  Footer: () => <div className="h-6" />,
};

const renderItem = (_: number, row: Row) => (
  <TranscriptRow>
    {row._tag === "ToolRun" ? (
      <ToolRun name={row.name} calls={row.calls} />
    ) : (
      <ItemView item={row.item} />
    )}
  </TranscriptRow>
);
