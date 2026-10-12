import { DetailRow } from "./DetailRow";
import { DetailSection } from "./DetailSection";

// The context window in full: the tokens in it and, once the window's size is known, how much of
// it they fill and how much is left.
export function ContextDetails({
  tokens,
  limit,
}: {
  tokens: number;
  limit: number | undefined;
}) {
  return (
    <DetailSection title="Context">
      <DetailRow label="In context">{tokens.toLocaleString()}</DetailRow>
      {limit ? (
        <>
          <DetailRow label="Window">{limit.toLocaleString()}</DetailRow>
          <DetailRow label="Used">
            {`${((tokens / limit) * 100).toFixed(1)}%`}
          </DetailRow>
          <DetailRow label="Left">
            {Math.max(0, limit - tokens).toLocaleString()}
          </DetailRow>
        </>
      ) : (
        <DetailRow label="Window" tone="text-faint">
          known once Fern runs a turn
        </DetailRow>
      )}
    </DetailSection>
  );
}
