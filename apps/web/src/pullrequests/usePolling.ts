import { useEffect, useRef } from "react";
import { startPolling } from "./poll";

// Calls `refresh` every `every` milliseconds while the component is on screen and the window is
// visible; never while the window is hidden, nor once the component is gone.
export function usePolling(refresh: () => void, every: number) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);
  useEffect(
    () =>
      startPolling({
        every,
        refresh: () => latest.current(),
        visible: () => document.visibilityState === "visible",
        onVisibilityChange: (listener) => {
          document.addEventListener("visibilitychange", listener);
          return () =>
            document.removeEventListener("visibilitychange", listener);
        },
      }),
    [every],
  );
}
