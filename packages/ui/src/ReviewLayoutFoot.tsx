import type { ReactNode } from "react";
import { listColumn } from "./ReviewLayout";

// Under a `ReviewLayout` as wide as it, such as the composer under the Review tab: while `listed`,
// the layout's list column runs on down beside `children`, so the two read as one. `children`
// stays mounted either way.
export function ReviewLayoutFoot({
  listed,
  children,
}: {
  listed: boolean;
  children: ReactNode;
}) {
  return (
    <div className="@container flex">
      {listed && <div aria-hidden className={listColumn} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
