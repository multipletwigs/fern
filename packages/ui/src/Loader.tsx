import { clsx } from "clsx";
import { useEffect, useState } from "react";

// Text-mode loaders, each a loop of frames drawn in the mono font.
const variants = {
  // A braille dot chasing its tail.
  spin: { frames: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".split(""), ms: 80 },
  // A block sweeping back and forth, like a scanner.
  scan: {
    frames: [
      "▰▱▱▱▱",
      "▱▰▱▱▱",
      "▱▱▰▱▱",
      "▱▱▱▰▱",
      "▱▱▱▱▰",
      "▱▱▱▰▱",
      "▱▱▰▱▱",
      "▱▰▱▱▱",
    ],
    ms: 110,
  },
  // A bar breathing up and down.
  breathe: { frames: "▁▂▃▄▅▆▇█▇▆▅▄▃▂".split(""), ms: 70 },
  // An arc orbiting a centre.
  orbit: { frames: "◜◠◝◞◡◟".split(""), ms: 100 },
  // Braille filling up, then draining.
  fill: { frames: "⡀⡄⡆⡇⣇⣧⣷⣿⣶⣤⣀ ".split(""), ms: 90 },
};

export type LoaderVariant = keyof typeof variants;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Animates while `active`; at rest it holds the first frame, so the shape stays put and only the
// motion says something is happening.
export function Loader({
  variant = "spin",
  active = true,
  label = "Working",
  className,
}: {
  variant?: LoaderVariant;
  active?: boolean;
  label?: string;
  className?: string;
}) {
  const { frames, ms } = variants[variant];
  const [frame, setFrame] = useState(0);
  const animate = active && !prefersReducedMotion();

  useEffect(() => {
    if (!animate) return undefined;
    const timer = setInterval(
      () => setFrame((n) => (n + 1) % frames.length),
      ms,
    );
    return () => clearInterval(timer);
  }, [animate, frames.length, ms]);

  return (
    <span
      role={active ? "status" : undefined}
      aria-label={active ? label : undefined}
      className={clsx(
        "inline-block font-mono leading-none whitespace-pre tabular-nums select-none",
        className,
      )}
    >
      {frames[animate ? frame % frames.length : 0]}
    </span>
  );
}
