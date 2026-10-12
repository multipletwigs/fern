import { useAtomValue } from "@effect/atom-react";
import { isWorking, type SessionHeader } from "@repo/api";
import { CacheCountdown } from "@repo/ui/CacheCountdown";
import { Empty } from "@repo/ui/Empty";
import { Glow } from "@repo/ui/Glow";
import { ThinkingLine } from "@repo/ui/ThinkingLine";
import { TopBar } from "@repo/ui/TopBar";
import { TranscriptRow } from "@repo/ui/TranscriptRow";
import { TranscriptTitle } from "@repo/ui/TranscriptTitle";
import { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Components, Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { SessionChecklist } from "../flow/SessionChecklist";
import { type PendingPrompt, pendingPromptAtom, transcriptAtom } from "./atoms";
import { ItemView } from "./ItemView";
import { type Row, toRows } from "./rows";
import { SessionComposer } from "./SessionComposer";
import { useNow } from "./time";
import { ToolRun } from "./ToolRun";

// Space kept under the last row, room for the Thinking line included.
const FOOTER = 56;

const isRunningCall = (row: Row | undefined) =>
  row?._tag === "ToolRun"
    ? row.calls.some((call) => !call.result)
    : row?.item._tag === "ToolCall" && !row.item.result;

const isDeveloperTurn = (row: Row) =>
  row._tag === "Item" &&
  (row.item._tag === "Prompt" || row.item._tag === "Command");

interface ListContext {
  readonly header: SessionHeader;
  readonly spacer: number;
  // Claude is working and the last row doesn't already say so.
  readonly thinking: boolean;
  // Row ids before the latest arrivals; unset while nothing has arrived since opening.
  readonly prior: ReadonlySet<string> | undefined;
}

// The stand-in looks like what Claude Code will record: a command card, or the message.
const pendingRow = ({ id, command, text, images }: PendingPrompt): Row => ({
  _tag: "Item",
  id,
  item: command
    ? { _tag: "Command", id, name: `/${command}`, args: text }
    : {
        _tag: "Prompt",
        id,
        text,
        images: images.length > 0 ? images : undefined,
      },
});

// A row's box as laid out, read from the list's own item wrapper so a row mid fade-in doesn't
// skew it.
const rowRect = (scroller: HTMLElement, id: string) =>
  scroller
    .querySelector(`[data-row-id="${CSS.escape(id)}"]`)
    ?.closest("[data-index]")
    ?.getBoundingClientRect();

// Calls `onPainted` once its list shows, or there's nothing to list, so a screen holding it out
// of sight knows it can show it without a blank frame. `visible` is false while held out of sight.
export function Session({
  id,
  visible = true,
  onPainted,
}: {
  id: string;
  visible?: boolean;
  onPainted?: (id: string) => void;
}) {
  const result = useAtomValue(transcriptAtom(id));
  const now = useNow();
  const transcript = AsyncResult.isSuccess(result) ? result.value : undefined;
  const header = transcript?.header;
  const items = transcript?.items;
  const recorded = useMemo(() => (items ? toRows(items) : []), [items]);
  // A message just sent stands at the end until Claude Code records it.
  const pending = useAtomValue(pendingPromptAtom(id));
  const lastTurnId = recorded.findLast(isDeveloperTurn)?.id;
  const endedAt = header?.hostedTurn?.endedAt;
  const waiting =
    pending !== undefined &&
    pending.after === lastTurnId &&
    !(endedAt && DateTime.toEpochMillis(endedAt) > pending.sentAt);
  const rows = useMemo(
    () => (waiting && pending ? [...recorded, pendingRow(pending)] : recorded),
    [recorded, waiting, pending],
  );
  const live =
    header !== undefined &&
    isWorking(
      DateTime.toEpochMillis(header.lastActivityAt),
      header.hostedTurn,
      now,
    );

  const list = useRef<VirtuosoHandle>(null);
  const scroller = useRef<HTMLElement>(null);
  // The latest message sent from here, kept with room under it for the reply. It scrolls to the top
  // of the view when sent; the recorded message that later takes its place doesn't scroll again.
  const [anchor, setAnchor] = useState<{ id: string; scroll: boolean }>();
  // The space under the last row, and the anchor it was sized for.
  const [spacer, setSpacer] = useState({ for: "", height: FOOTER });
  const scrolledTo = useRef<string>(undefined);

  // Row ids as of the latest update, and as of the one before: rows missing from the earlier set
  // just arrived and fade in. Both stay unset until the transcript first arrives, which doesn't.
  const [tracked, setTracked] = useState<{
    rows: ReadonlyArray<Row>;
    known: ReadonlySet<string>;
    prior: ReadonlySet<string> | undefined;
    pendingId: string | undefined;
  }>();
  if (rows.length > 0 && rows !== tracked?.rows) {
    const known = tracked?.known;
    const arrived = known ? rows.filter((row) => !known.has(row.id)) : [];
    const turn = arrived.findLast(isDeveloperTurn);
    const pendingId = waiting ? pending?.id : undefined;
    // The recorded message taking over from its stand-in appears in place, without fading again.
    const handoff = Boolean(known && tracked.pendingId && !pendingId && turn);
    const replaced =
      handoff && known && turn ? new Set([...known, turn.id]) : known;
    setTracked({
      rows,
      known: new Set(rows.map((row) => row.id)),
      prior: arrived.length > 0 ? replaced : tracked?.prior,
      pendingId,
    });
    // Only a message sent from here goes to the top; nothing else moves the view.
    if (turn && turn.id === pendingId) setAnchor({ id: turn.id, scroll: true });
    else if (turn && handoff) setAnchor({ id: turn.id, scroll: false });
  }

  // Sizes the space under the last row so the anchor can sit at the top of the view; it shrinks as
  // the reply fills that space.
  const lastId = rows.at(-1)?.id;
  const anchorId = anchor?.id;
  const anchorPending = anchor?.scroll === true;
  const measure = useCallback(() => {
    const view = scroller.current;
    if (!view || !lastId) return;
    const last = rowRect(view, lastId);
    const top = anchorId ? rowRect(view, anchorId) : undefined;
    const sending = anchorPending && scrolledTo.current !== anchorId;
    let height: number;
    if (last && (top || !anchorId)) {
      // Room for the anchor to sit at the top of the view, shrinking as the reply fills it.
      const room = top ? view.clientHeight - (last.bottom - top.top) : 0;
      // Never less than what's showing now: the browser would pull the view down to make up a
      // shortfall, which is what made collapsing an output jump.
      const showing =
        view.getBoundingClientRect().top + view.clientHeight - last.bottom;
      height = Math.max(FOOTER, Math.round(Math.max(room, showing)));
    } else if (sending) {
      // A just-sent message not on the page yet: reserve a whole view so it can go up at once;
      // the next measurement trims that to fit.
      height = view.clientHeight;
    } else return;
    const target = anchorId ?? "";
    setSpacer((current) =>
      current.for === target && current.height === height
        ? current
        : { for: target, height },
    );
  }, [anchorId, anchorPending, lastId]);

  useLayoutEffect(measure, [measure]);
  const mounted = header !== undefined;
  // Whether the view was at the end of the list when it last scrolled.
  const wasAtEnd = useRef(true);
  // Drawn out of sight, the list may have been laid out at another width; shown, its rows re-wrap
  // while the list measures them again. Hold it at the end, if it was there, until they settle.
  const wasVisible = useRef(visible);
  useLayoutEffect(() => {
    const shownNow = visible && !wasVisible.current;
    wasVisible.current = visible;
    const view = scroller.current;
    if (!shownNow || !view || !wasAtEnd.current) return undefined;
    let frames = 0;
    let frame = 0;
    const hold = () => {
      view.scrollTop = view.scrollHeight;
      if (frames++ < 10) frame = requestAnimationFrame(hold);
    };
    hold();
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  useEffect(() => {
    const view = scroller.current;
    // The list mounts once the transcript's header arrives.
    if (!view || !mounted) return undefined;
    const rowList = view.querySelector("[data-testid=virtuoso-item-list]");
    // When rows shrink with the view at the bottom, as when an output collapses, the browser pulls
    // the view down at once. Undo that in the same frame by growing the space under the rows,
    // before anything paints; `measure` then records the new size.
    let scrollTop = view.scrollTop;
    const onScroll = () => {
      scrollTop = view.scrollTop;
      wasAtEnd.current =
        view.scrollTop + view.clientHeight >= view.scrollHeight - 1;
    };
    const observer = new ResizeObserver(() => {
      const pulled = scrollTop - view.scrollTop;
      const atEnd = view.scrollTop + view.clientHeight >= view.scrollHeight - 1;
      const footer = view.querySelector<HTMLElement>(
        "[data-transcript-footer]",
      );
      if (pulled > 0 && atEnd && footer) {
        footer.style.height = `${footer.offsetHeight + pulled}px`;
        view.scrollTop = scrollTop;
      }
      measure();
    });
    observer.observe(view);
    if (rowList) observer.observe(rowList);
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      view.removeEventListener("scroll", onScroll);
    };
  }, [measure, mounted]);
  // The list hands its footer new props a render late, so the space is written to the page here,
  // in the same frame it's sized; scrolling right after would otherwise run out of room.
  useLayoutEffect(() => {
    const footer = scroller.current?.querySelector<HTMLElement>(
      "[data-transcript-footer]",
    );
    if (footer) footer.style.height = `${spacer.height}px`;
  }, [spacer.height]);

  // Once the space under it is there, bring the anchor up, before the frame paints.
  useLayoutEffect(() => {
    if (
      !anchor?.scroll ||
      spacer.for !== anchor.id ||
      scrolledTo.current === anchor.id
    )
      return;
    // Scroll by what the page measures: the list's own scrollToIndex works from size estimates,
    // which miss while new rows are still being measured, and it corrects itself later, which
    // read as the message jumping down when the next row arrived.
    const view = scroller.current;
    const top = view && rowRect(view, anchor.id);
    if (view && top) {
      scrolledTo.current = anchor.id;
      view.scrollTop += top.top - view.getBoundingClientRect().top;
      return;
    }
    // Not on the page yet: bring it near, and land exactly once it's measured.
    const index = rows.findIndex((row) => row.id === anchor.id);
    if (index >= 0) list.current?.scrollToIndex({ index, align: "start" });
  }, [anchor, spacer, rows]);

  const thinking =
    (header?.hostedTurn?.running === true || waiting) &&
    !isRunningCall(rows.at(-1));
  const context = useMemo(
    () =>
      header
        ? { header, spacer: spacer.height, thinking, prior: tracked?.prior }
        : undefined,
    [header, spacer, thinking, tracked?.prior],
  );

  // Virtuoso keeps its rows hidden until it has scrolled to the end, so a screen holding this
  // Session out of sight waits for that, or for there being nothing to list. Gives up after a
  // while rather than hold the screen.
  const nothingToList =
    AsyncResult.isFailure(result) ||
    (context !== undefined && rows.length === 0);
  const hasRows = context !== undefined && rows.length > 0;
  useEffect(() => {
    if (!onPainted || !(nothingToList || hasRows)) return undefined;
    if (nothingToList) {
      onPainted(id);
      return undefined;
    }
    let frames = 0;
    let frame = 0;
    const check = () => {
      const itemList = scroller.current?.querySelector(
        "[data-testid=virtuoso-item-list]",
      );
      const shown =
        itemList instanceof HTMLElement &&
        itemList.style.visibility !== "hidden" &&
        itemList.querySelector("[data-row-id]") !== null;
      if (shown || frames++ > 40) onPainted(id);
      else frame = requestAnimationFrame(check);
    };
    check();
    return () => cancelAnimationFrame(frame);
  }, [id, hasRows, nothingToList, onPainted]);

  return (
    <div className="relative flex h-full flex-col">
      <Glow live={live} />
      <TopBar>
        {header?.cacheExpiresAt && (
          <CacheCountdown
            remainingMs={DateTime.toEpochMillis(header.cacheExpiresAt) - now}
          />
        )}
      </TopBar>
      <SessionChecklist sessionId={id} />
      {context ? (
        <Virtuoso
          ref={list}
          scrollerRef={(element) => {
            scroller.current = element instanceof HTMLElement ? element : null;
          }}
          className="flex-1"
          data={rows}
          context={context}
          totalListHeightChanged={measure}
          computeItemKey={(_, row) => row.id}
          initialTopMostItemIndex={{ index: "LAST", align: "end" }}
          increaseViewportBy={800}
          components={listComponents}
          itemContent={renderItem}
        />
      ) : (
        <Empty text="Opening transcript…" />
      )}
      {header && (
        <SessionComposer header={header} now={now} lastTurnId={lastTurnId} />
      )}
    </div>
  );
}

// A worktree Fern made is named after its branch, so the two are shown once.
const titleMeta = (header: SessionHeader) =>
  [
    ...new Set(
      [header.cwd?.split("/").at(-1), header.gitBranch, header.model].filter(
        Boolean,
      ),
    ),
  ].join("  ·  ");

const listComponents: Components<Row, ListContext> = {
  Header: ({ context }) => (
    <TranscriptTitle
      meta={titleMeta(context.header)}
      title={context.header.title}
    />
  ),
  // The Thinking line sits inside the space under the rows, so showing it never moves anything.
  Footer: ({ context }) => (
    <div data-transcript-footer style={{ height: context.spacer }}>
      {context.thinking && <ThinkingLine />}
    </div>
  ),
};

const renderItem = (_: number, row: Row, context: ListContext) => (
  <TranscriptRow
    id={row.id}
    fresh={context.prior !== undefined && !context.prior.has(row.id)}
  >
    {row._tag === "ToolRun" ? (
      <ToolRun name={row.name} calls={row.calls} />
    ) : (
      <ItemView item={row.item} />
    )}
  </TranscriptRow>
);
