import { SegmentedToggle } from "@repo/ui/SegmentedToggle";
import type { SessionView } from "./useGrillView";

const options = [
  { value: "grill", label: "Grill" },
  { value: "transcript", label: "Transcript" },
] as const;

// Switches the Session between the Grill and its transcript. Amber while a Round waits on the
// developer and the transcript shows.
export function GrillToggle({
  view,
  waiting,
  onChange,
}: {
  view: SessionView;
  waiting: boolean;
  onChange: (view: SessionView) => void;
}) {
  return (
    <SegmentedToggle
      value={view}
      onChange={onChange}
      options={options.map((option) =>
        option.value === "grill" && waiting && view !== "grill"
          ? {
              value: option.value,
              label: (
                <>
                  <span className="size-1.5 rounded-full bg-amber shadow-[0_0_8px_rgb(245_177_76/0.8)]" />
                  {option.label}
                </>
              ),
            }
          : option,
      )}
    />
  );
}
