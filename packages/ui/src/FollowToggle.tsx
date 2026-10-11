import { clsx } from "clsx";
import { Loader } from "./Loader";

// Whether the code panel tracks the file Claude last touched.
export function FollowToggle({
  following,
  working,
  onToggle,
}: {
  following: boolean;
  // Claude is mid-turn, so following means the file can change any moment.
  working: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={following}
      className={clsx(
        "flex h-7 items-center gap-2 rounded-lg px-2.5 text-xs transition-colors",
        following
          ? "bg-ice/10 text-ice"
          : "text-muted hover:bg-white/[0.05] hover:text-ink",
      )}
    >
      <Loader
        variant="scan"
        active={following && working}
        label="Following"
        className="text-[10px]"
      />
      {following ? "Following Claude" : "Follow Claude"}
    </button>
  );
}
