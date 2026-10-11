import { useAtom } from "@effect/atom-react";
import type { SessionHeader } from "@repo/api";
import { ContextMeter } from "@repo/ui/ContextMeter";
import { ModelPicker } from "@repo/ui/ModelPicker";
import { modelChoiceAtom } from "./atoms";
import { currentModel, MODELS } from "./models";

// Beside the composer's image button: the model the next message runs on, and how full the
// Session's context is.
export function SessionTools({
  header,
  disabled,
}: {
  header: SessionHeader;
  disabled: boolean;
}) {
  const [picked, pick] = useAtom(modelChoiceAtom(header.id));
  const current = currentModel(picked, header.model);
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
        />
      )}
    </>
  );
}
