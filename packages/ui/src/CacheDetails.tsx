import { DetailRow } from "./DetailRow";
import { DetailSection } from "./DetailSection";

// The prompt cache as Claude's latest request left it: times in epoch millis.
export interface PromptCacheFacts {
  readonly lastRequestMs: number;
  readonly ttlMs: number;
  readonly expiresMs: number;
  readonly readTokens: number;
  readonly writtenTokens: number;
  readonly uncachedTokens: number;
  readonly outputTokens: number;
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

// A span of time: "4:07" under an hour, "2h 15m" past it.
const span = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const lifetime = (ms: number) =>
  ms >= 3_600_000 ? `${ms / 3_600_000}h` : `${ms / 60_000}m`;

// Whether the prompt cache is still warm and for how long, when the request that set it ran, and
// what that request read from it and wrote to it. Once it's cold, the next message pays to write
// the whole context to the cache again.
export function CacheDetails({
  cache,
  now,
}: {
  cache: PromptCacheFacts;
  now: number;
}) {
  const remaining = cache.expiresMs - now;
  const cold = remaining <= 0;
  const input = cache.readTokens + cache.writtenTokens + cache.uncachedTokens;
  return (
    <DetailSection title="Prompt cache">
      <DetailRow
        label="Status"
        tone={
          cold ? "text-faint" : remaining < 300_000 ? "text-amber" : "text-mint"
        }
      >
        {cold ? "cold" : `warm, ${span(remaining)} left`}
      </DetailRow>
      <DetailRow label="TTL">{lifetime(cache.ttlMs)}</DetailRow>
      <DetailRow label="Last request">
        {`${clock(cache.lastRequestMs)}, ${span(now - cache.lastRequestMs)} ago`}
      </DetailRow>
      <DetailRow label={cold ? "Expired" : "Expires"}>
        {clock(cache.expiresMs)}
      </DetailRow>
      <DetailRow label="Read from cache">
        {cache.readTokens.toLocaleString()}
      </DetailRow>
      <DetailRow label="Written to cache">
        {cache.writtenTokens.toLocaleString()}
      </DetailRow>
      <DetailRow label="Uncached input">
        {cache.uncachedTokens.toLocaleString()}
      </DetailRow>
      <DetailRow label="Output">
        {cache.outputTokens.toLocaleString()}
      </DetailRow>
      {input > 0 && (
        <DetailRow label="Hit rate">
          {`${((cache.readTokens / input) * 100).toFixed(1)}%`}
        </DetailRow>
      )}
    </DetailSection>
  );
}
