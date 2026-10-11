import type { ReactNode } from "react";

// A developer's turn in the transcript.
export function MessageCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-10 mb-6 rounded-2xl border border-hairline bg-white/[0.035] px-5 py-4 text-[15px] leading-7 whitespace-pre-wrap">
      {children}
    </div>
  );
}
