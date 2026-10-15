import { clsx } from "clsx";
import type { ComponentProps } from "react";

// The reading column every view centres its content in, as wide as the composer, so the
// transcript, the Grill, Review and the composer keep one left edge from tab to tab.
export function Column({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={clsx("mx-auto w-full max-w-[720px] px-6", className)}
    />
  );
}
