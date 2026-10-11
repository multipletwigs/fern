import { clsx } from "clsx";
import { Loader } from "./Loader";

export function LiveStatus({ live }: { live: boolean }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <Loader
        variant="scan"
        active={live}
        label="Live"
        className={clsx("text-xs", live ? "text-ink" : "text-faint")}
      />
      {live ? "Live" : "Idle"}
    </span>
  );
}
