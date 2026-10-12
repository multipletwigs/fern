import { useAtom } from "@effect/atom-react";
import type { SessionHeader } from "@repo/api";
import { ContextMeter } from "@repo/ui/ContextMeter";
import { ModelPicker } from "@repo/ui/ModelPicker";
import { DateTime, Duration } from "effect";
import { modelChoiceAtom } from "./atoms";
import { currentModel, MODELS } from "./models";

// Beside the composer's image button: the model the next message runs on, and how full the
// Session's context is, with the prompt cache's state on hover.
export function SessionTools({
  header,
  now,
  disabled,
}: {
  header: SessionHeader;
  now: number;
  disabled: boolean;
}) {
  const [picked, pick] = useAtom(modelChoiceAtom(header.id));
  const current = currentModel(picked, header.model);
  const { cache } = header;
  return (
    <>
      <ModelPicker
        models={MODELS}
        value={current.value}
        label={current.label}
        disabled={disabled}
        onChange={pick}
      />
      {header.contextTokens !== undefined && (
        <ContextMeter
          tokens={header.contextTokens}
          limit={header.contextWindow}
          now={now}
          cache={
            cache && {
              lastRequestMs: DateTime.toEpochMillis(cache.lastRequestAt),
              ttlMs: Duration.toMillis(cache.ttl),
              expiresMs: DateTime.toEpochMillis(cache.expiresAt),
              readTokens: cache.readTokens,
              writtenTokens: cache.writtenTokens,
              uncachedTokens: cache.uncachedTokens,
              outputTokens: cache.outputTokens,
            }
          }
        />
      )}
    </>
  );
}
