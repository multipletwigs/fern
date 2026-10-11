import { clsx } from "clsx";
import type { ReactNode } from "react";

// A quiet text button, lifted on hover; tinted when it approves or rejects something.
export function GhostButton({
  children,
  tone = "plain",
  disabled,
  onClick,
}: {
  children: ReactNode;
  tone?: "plain" | "ice" | "danger";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "h-8 rounded-lg border border-hairline px-3 text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40",
        tone === "ice" && "text-ice/90 hover:border-ice/30 hover:bg-ice/[0.06]",
        tone === "danger" &&
          "text-danger/90 hover:border-danger/30 hover:bg-danger/[0.06]",
        tone === "plain" && "text-ink/75 hover:bg-white/[0.05] hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
