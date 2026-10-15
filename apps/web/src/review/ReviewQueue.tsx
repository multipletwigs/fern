import { useAtom, useAtomSet } from "@effect/atom-react";
import type { VerdictKind, Walkthrough } from "@repo/api";
import { ReviewEntry } from "@repo/ui/ReviewEntry";
import { ReviewHeading } from "@repo/ui/ReviewHeading";
import { ReviewLayout } from "@repo/ui/ReviewLayout";
import { VerdictBar } from "@repo/ui/VerdictBar";
import { Exit } from "effect";
import {
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { verdictAtom } from "../walkthrough/atoms";
import { prStatus, rowStatus, sinceOf } from "../walkthrough/review";
import { reviewAtAtom } from "./atoms";
import { moveFrom } from "./navigation";
import { PendingPane } from "./PendingPane";
import {
  afterVerdict,
  isWaiting,
  openAt,
  type ReviewQueueItem,
  verdictOf,
} from "./queue";
import { SectionPane } from "./SectionPane";
import { UnexplainedPane } from "./UnexplainedPane";

// The id the verdict endpoint knows an item by.
const itemId = (item: ReviewQueueItem) =>
  item.kind === "section"
    ? item.section.id
    : item.kind === "unexplained"
      ? item.change.hunk.id
      : undefined;

const entryTitle = (item: ReviewQueueItem) =>
  item.kind === "section"
    ? item.section.title
    : item.kind === "unexplained"
      ? item.change.hunk.path
      : item.kind === "writing"
        ? "Being written"
        : "Couldn't be written";

// What the list says under an entry: a Rejection's note, or how big an Unexplained change is.
const entryDetail = (item: ReviewQueueItem) => {
  const verdict = verdictOf(item);
  if (verdict?.kind === "rejected") return verdict.note;
  if (item.kind === "unexplained")
    return `+${item.change.hunk.added} −${item.change.hunk.removed}`;
  return undefined;
};

// Walkthroughs in the review layout, a Session's or a Foreign PR's: each one's Sections, then its
// Unexplained changes, listed on the left under the Walkthrough, itself under its PR when the
// Session's work lands as a Stack, bottom PR first, and one item at a time on the right. `a`
// approves, `r` opens the note a Rejection needs, `j`/`k` move. After a verdict the view snaps to
// the next item still waiting. `active` is false while it's out of sight. `reviewKey` keeps what's
// open while it is; `actions` sit above the list, `outcome` under a Reviewed Walkthrough's items,
// and `retry`, when given, is how a Walkthrough that couldn't be written is tried again.
export function ReviewQueue({
  reviewKey,
  walkthroughs,
  queue,
  waiting,
  active,
  actions,
  outcome: Outcome,
  retry,
}: {
  reviewKey: string;
  walkthroughs: ReadonlyArray<Walkthrough>;
  queue: ReadonlyArray<ReviewQueueItem>;
  waiting: number;
  active: boolean;
  actions: ReactNode;
  outcome: ComponentType<{ walkthrough: Walkthrough }>;
  retry?: ReactNode;
}) {
  const [target, setTarget] = useAtom(reviewAtAtom(reviewKey));
  const send = useAtomSet(verdictAtom, { mode: "promiseExit" });
  // By item key: the one whose verdict is on its way, whose verdict didn't save, and whose note
  // field is open.
  const [pending, setPending] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const [noting, setNoting] = useState<string>();
  const [note, setNote] = useState("");

  const index = openAt(queue, target) ?? 0;
  const item = queue[index];
  // The item on screen, for a verdict that lands after the developer moved on.
  const shown = useRef(item?.key);
  useLayoutEffect(() => {
    shown.current = item?.key;
  });

  const goTo = (to: number) => {
    const key = queue[to]?.key;
    if (key !== undefined) setTarget({ item: key });
  };

  const decide = async (kind: VerdictKind, text?: string) => {
    const id = item && itemId(item);
    if (!item || id === undefined || item.walkthrough.reviewedAt) return;
    if (pending !== undefined) return;
    setPending(item.key);
    setFailed(undefined);
    const exit = await send({
      params: { id: item.walkthrough.id, item: id },
      payload: { kind, note: text },
    });
    setPending(undefined);
    if (Exit.isFailure(exit)) {
      setFailed(item.key);
      return;
    }
    setNoting(undefined);
    if (shown.current === item.key) goTo(afterVerdict(queue, index));
  };
  const startNote = () => {
    if (!item || itemId(item) === undefined || item.walkthrough.reviewedAt)
      return;
    setNote(verdictOf(item)?.note ?? "");
    setNoting(item.key);
  };

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    const settled = queue.map((entry) => !isWaiting(entry));
    if (event.key === "j" || event.key === "k") {
      event.preventDefault();
      const to = moveFrom(
        settled,
        index,
        event.key === "j" ? "next" : "previous",
      );
      if (to !== undefined) goTo(to);
      return;
    }
    if (event.key === "a") {
      event.preventDefault();
      if (item && verdictOf(item)?.kind !== "approved") void decide("approved");
      return;
    }
    if (event.key === "r") {
      event.preventDefault();
      startNote();
    }
  };

  const items = queue.map((entry, at) => {
    const verdict = verdictOf(entry);
    const previous = queue[at - 1];
    const starts = previous?.walkthrough.id !== entry.walkthrough.id;
    const pr = entry.walkthrough.pr;
    const startsPr =
      pr !== undefined && previous?.walkthrough.pr?.number !== pr.number;
    const status = rowStatus(entry.walkthrough);
    const prState =
      pr && prStatus(walkthroughs.filter((w) => w.pr?.number === pr.number));
    const heading = starts ? (
      <>
        {startsPr && prState && (
          <ReviewHeading
            title={`PR #${pr.number} · ${pr.title}`}
            status={prState.status}
            tone={prState.tone}
            hint={pr.ticket === undefined ? undefined : `Ticket #${pr.ticket}`}
            link={{ href: pr.url, label: `Open PR #${pr.number} on GitHub` }}
          />
        )}
        <ReviewHeading
          title={`Walkthrough ${entry.walkthrough.number}`}
          status={status.status}
          tone={status.tone}
          hint={sinceOf(entry.walkthrough)}
          minor={pr !== undefined}
        />
      </>
    ) : entry.kind === "unexplained" && previous?.kind === "section" ? (
      <ReviewHeading title="Unexplained changes" minor />
    ) : undefined;
    const locked = entry.walkthrough.reviewedAt !== undefined;
    const footer = (
      <div className="space-y-3">
        <VerdictBar
          verdict={verdict}
          locked={locked}
          pending={pending === entry.key}
          failed={failed === entry.key}
          noting={noting === entry.key}
          note={note}
          onNote={setNote}
          onApprove={() => void decide("approved")}
          onNoting={(open) => (open ? startNote() : setNoting(undefined))}
          onReject={() => void decide("rejected", note.trim())}
          notePlaceholder={
            entry.walkthrough.foreignPr === undefined
              ? undefined
              : "What should change? This stays in Fern until you post a review."
          }
        />
        {locked && <Outcome walkthrough={entry.walkthrough} />}
      </div>
    );
    return {
      key: entry.key,
      heading,
      entry: (
        <ReviewEntry
          number={entry.kind === "section" ? entry.index + 1 : undefined}
          title={entryTitle(entry)}
          detail={entryDetail(entry)}
          settled={verdict !== undefined}
          risk={entry.kind === "section" ? entry.section.risk : undefined}
          mark={
            entry.kind === "writing" || entry.kind === "failed"
              ? entry.kind
              : verdict?.kind
          }
        />
      ),
      pane:
        entry.kind === "section" ? (
          <SectionPane
            walkthrough={entry.walkthrough}
            section={entry.section}
            index={entry.index}
            footer={footer}
          />
        ) : entry.kind === "unexplained" ? (
          <UnexplainedPane
            walkthrough={entry.walkthrough}
            change={entry.change}
            footer={footer}
          />
        ) : (
          <PendingPane walkthrough={entry.walkthrough} retry={retry} />
        ),
    };
  });

  return (
    <ReviewLayout
      label="Review"
      header={
        <div className="space-y-3">
          <p className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-ink">Review</span>
            <span
              className={
                waiting > 0
                  ? "font-mono text-[11px] text-amber/90 tabular-nums"
                  : "font-mono text-[11px] text-faint"
              }
            >
              {waiting > 0 ? `${waiting} waiting` : "Nothing waiting"}
            </span>
          </p>
          {actions}
        </div>
      }
      items={items}
      at={index}
      active={active}
      onSelect={goTo}
      onKeyDown={onKey}
    />
  );
}
