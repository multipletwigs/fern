import { clsx } from "clsx";

// Opal-style ambient light: ice while the agent is working, nearly dark when it is idle.
export function Glow({ live }: { live: boolean }) {
  return (
    <div
      aria-hidden
      className={clsx(
        "pointer-events-none absolute inset-x-0 -top-40 h-[420px] transition-opacity duration-[2000ms]",
        live ? "opacity-100" : "opacity-30",
      )}
      style={{
        background:
          "radial-gradient(50% 60% at 50% 30%, rgb(159 216 255 / 0.16), transparent 70%)",
      }}
    />
  );
}
