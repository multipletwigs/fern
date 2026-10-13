import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { GhostButton } from "./GhostButton";
import { Loader } from "./Loader";
import { PanelBar } from "./PanelBar";
import { SettingsSection } from "./SettingsSection";

// Fern's Settings, in the content card: a way back to the Session, the Tools section with its
// Re-check button, and the Projects section. While `checking`, the button says so and the rows
// shown are the last ones read.
export function SettingsPanel({
  onBack,
  onRecheck,
  checking,
  children,
  projects,
}: {
  onBack: () => void;
  onRecheck: () => void;
  checking: boolean;
  // The Tools section's rows, or what stands in for them.
  children: ReactNode;
  // The Projects section's rows, one per Project.
  projects: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelBar
        start={
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink/75 transition-colors hover:bg-white/[0.05] hover:text-ink"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to Session
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-10">
          <h1 className="text-xl text-ink">Settings</h1>
          <SettingsSection
            title="Tools"
            description="What Fern runs on, as its own processes find it on the PATH."
            action={
              <GhostButton disabled={checking} onClick={onRecheck}>
                {checking ? (
                  <span className="flex items-center gap-2">
                    <Loader label="Checking" className="text-sm" />
                    Checking…
                  </span>
                ) : (
                  "Re-check"
                )}
              </GhostButton>
            }
          >
            {children}
          </SettingsSection>
          <SettingsSection
            title="Projects"
            description="In a Project on GitHub, each ticket a Hosted Session lands goes up as a draft PR on the Session's Stack. Turn it off to land work as before."
          >
            {projects}
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
