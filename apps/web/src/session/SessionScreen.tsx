import { useAtomValue } from "@effect/atom-react";
import type { SessionHeader, TranscriptItem } from "@repo/api";
import { clsx } from "clsx";
import { DateTime } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { type Components, Virtuoso } from "react-virtuoso";
import { currentSessionAtom, transcriptAtom } from "./atoms";
import { ItemView } from "./ItemView";

// A Session counts as live while its transcript was written to within this window.
const LIVE_WINDOW_MS = 30_000;

const useNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
};

export function SessionScreen() {
  const current = useAtomValue(currentSessionAtom);
  return AsyncResult.match(current, {
    onInitial: () => <Empty text="Looking for your latest session…" />,
    onFailure: () => <Empty text="No Claude Code sessions found yet." />,
    onSuccess: ({ value }) => <Session id={value.id} />,
  });
}

function Session({ id }: { id: string }) {
  const result = useAtomValue(transcriptAtom(id));
  const now = useNow();
  const transcript = AsyncResult.isSuccess(result) ? result.value : undefined;
  const header = transcript?.header;
  const live =
    header !== undefined &&
    now - DateTime.toEpochMillis(header.lastActivityAt) < LIVE_WINDOW_MS;

  return (
    <div className="relative flex h-full flex-col">
      <Glow live={live} />
      <TopBar header={header} live={live} now={now} />
      {header ? (
        <Virtuoso
          className="flex-1"
          data={transcript.items}
          context={header}
          computeItemKey={(_, item) => item.id}
          initialTopMostItemIndex={{ index: "LAST", align: "end" }}
          followOutput="smooth"
          increaseViewportBy={800}
          components={listComponents}
          itemContent={renderItem}
        />
      ) : (
        <Empty text="Opening transcript…" />
      )}
    </div>
  );
}

const listComponents: Components<TranscriptItem, SessionHeader> = {
  Header: ({ context }) => <Title header={context} />,
  Footer: () => <div className="h-24" />,
};

const renderItem = (_: number, item: TranscriptItem) => (
  // flow-root keeps item margins inside the row, so Virtuoso measures its true height.
  <div className="mx-auto flow-root w-full max-w-[720px] px-6">
    <ItemView item={item} />
  </div>
);

// Opal-style ambient light: ice while the agent is working, nearly dark when the Session is idle.
function Glow({ live }: { live: boolean }) {
  return (
    <div
      aria-hidden
      className={clsx(
        "pointer-events-none absolute inset-x-0 -top-40 h-[420px] transition-opacity duration-[2000ms]",
        live ? "opacity-100" : "opacity-30",
      )}
      style={{
        background:
          "radial-gradient(50% 60% at 50% 30%, rgb(159 216 255 / 0.16), transparent 70%)",
      }}
    />
  );
}

function TopBar({
  header,
  live,
  now,
}: {
  header: SessionHeader | undefined;
  live: boolean;
  now: number;
}) {
  return (
    <div className="drag relative z-10 flex h-12 shrink-0 items-center justify-end gap-5 pr-5 pl-24">
      {header?.cacheExpiresAt && (
        <CacheCountdown
          remainingMs={DateTime.toEpochMillis(header.cacheExpiresAt) - now}
        />
      )}
      <span className="flex items-center gap-2 text-xs text-muted">
        <span
          className={clsx(
            "size-1.5 rounded-full transition-colors duration-700",
            live ? "bg-ice shadow-[0_0_10px_2px] shadow-ice/60" : "bg-faint",
          )}
        />
        {live ? "Live" : "Idle"}
      </span>
    </div>
  );
}

// Time left before the prompt cache goes cold and the next message pays a full cache rewrite.
function CacheCountdown({ remainingMs }: { remainingMs: number }) {
  const cold = remainingMs <= 0;
  const seconds = Math.max(0, Math.floor(remainingMs / 1000));
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span
      className="flex items-baseline gap-2 text-xs text-muted"
      title="Prompt cache time remaining"
    >
      cache
      <span
        className={clsx(
          "font-pixel text-xl leading-none tabular-nums",
          cold ? "text-faint" : seconds < 300 ? "text-amber" : "text-ink",
        )}
      >
        {cold ? "cold" : label}
      </span>
    </span>
  );
}

function Title({ header }: { header: SessionHeader }) {
  const where = [header.cwd?.split("/").at(-1), header.gitBranch, header.model]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 pt-10 pb-12">
      <p className="font-mono text-xs text-faint">{where}</p>
      <h1 className="mt-3 text-[28px] leading-tight font-medium tracking-tight text-balance">
        {header.title}
      </h1>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="drag flex h-full items-center justify-center text-sm text-muted">
      {text}
    </div>
  );
}
