import { Loader } from "./Loader";
import { Column } from "./Column";

// Under the latest message while Claude works on it and nothing else shows that it is.
export function ThinkingLine() {
  return (
    <Column>
      <span className="flex items-center gap-2 text-sm leading-6">
        <Loader className="text-base text-muted" label="Thinking" />
        <span className="animate-shimmer bg-linear-to-r from-muted via-ink to-muted bg-[length:200%_100%] bg-clip-text text-transparent motion-reduce:animate-none">
          Thinking
        </span>
      </span>
    </Column>
  );
}
