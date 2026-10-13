import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { GhostButton } from "./GhostButton";
import { Loader } from "./Loader";
import { PanelBar } from "./PanelBar";

// Fern's Settings, in the content card: a way back to the Session, and the Tools section with its
// Re-check button. While `checking`, the button says so and the rows shown are the last ones read.
export function SettingsPanel({
  onBack,
  onRecheck,
  checking,
  children,
}: {
  onBack: () => void;
  onRecheck: () => void;
  checking: boolean;
  // The Tools section's rows, or what stands in for them.
  children: ReactNode;
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
          <section aria-label="Tools" className="mt-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-[15px] text-ink">Tools</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  What Fern runs on, as its own processes find it on the PATH.
                </p>
              </div>
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
            </div>
            <ul className="mt-4 divide-y divide-hairline border-t border-hairline">
              {children}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
