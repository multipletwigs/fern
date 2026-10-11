import { clsx } from "clsx";
import type { ReactNode } from "react";

// A centred pill marking an event in the transcript, such as an interruption.
export function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="my-5 flex justify-center">
      <span
        className={clsx(
          "rounded-full border border-hairline px-3 py-1 text-xs",
          className,
        )}
      >
        {children}
      </span>
    </div>
  );
}
