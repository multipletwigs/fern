import type { ModelChoice } from "@repo/ui/ModelPicker";

// The models the composer offers: the latest of each family, by the aliases Claude Code resolves
// to them. Kept by hand for now.
export const MODELS: ReadonlyArray<ModelChoice & { readonly id: string }> = [
  { value: "opus", label: "Opus 5.5", id: "claude-opus-5-5" },
  { value: "sonnet", label: "Sonnet 5.5", id: "claude-sonnet-5-5" },
  { value: "fable", label: "Fable 5.1", id: "claude-fable-5-1" },
  { value: "haiku", label: "Haiku 5.5", id: "claude-haiku-5-5" },
];

// What a new Session starts on unless another model is picked.
export const NEW_SESSION_MODEL = "opus";

// A model id as people say it, e.g. "Opus 4.7" for "claude-opus-4-7", leaving out any date stamp.
const spoken = (id: string) => {
  const [family = id, ...version] = id
    .replace(/^claude-/, "")
    .split("-")
    .filter((part) => !/^\d{8}$/.test(part));
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return [name, version.join(".")].filter(Boolean).join(" ");
};

// The model the next message runs on: the picked one, else the one the Session last ran on. Its
// `value` is the option to check in the picker, when it's one of them.
export const currentModel = (
  picked: string | undefined,
  ranOn: string | undefined,
): { readonly value: string | undefined; readonly label: string } => {
  // Claude Code records "<synthetic>" for messages it wrote itself.
  const id = picked ?? (ranOn?.startsWith("<") ? undefined : ranOn);
  if (!id) return { value: undefined, label: "Model" };
  const option = MODELS.find((model) => model.value === id || model.id === id);
  return { value: option?.value, label: option?.label ?? spoken(id) };
};
