import { LIVE_WINDOW_MS } from "@repo/api";
import { useEffect, useState } from "react";

export const isLive = (lastActivityMs: number, now: number) =>
  now - lastActivityMs < LIVE_WINDOW_MS;

export const useNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
};

// A compact "time since", e.g. "now", "5m", "3h", "2d".
export const ago = (ms: number) => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`;
};
