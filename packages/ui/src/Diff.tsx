import { clsx } from "clsx";

// Unified-diff style lines: "+" for added, anything else for removed.
export function Diff({ lines }: { lines: ReadonlyArray<string> }) {
  return (
    <pre className="my-2 max-h-96 overflow-auto rounded-xl bg-white/[0.025] py-3 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div
          // Lines in a diff are positional; nothing else identifies them.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={clsx(
            "px-3 whitespace-pre-wrap",
            line.startsWith("+")
              ? "bg-mint/[0.07] text-mint/90"
              : "bg-danger/[0.07] text-danger/85",
          )}
        >
          {line}
        </div>
      ))}
    </pre>
  );
}
