import { assert, it } from "@effect/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { startPolling } from "../src/pullrequests/poll";

// The Pull requests page asks GitHub again every minute while it's in sight, and never while the
// window is hidden.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// A window the test hides and shows, and how many times the list was fetched again.
const page = () => {
  let visible = true;
  const listeners = new Set<() => void>();
  let refreshes = 0;
  const stop = startPolling({
    every: 60_000,
    refresh: () => {
      refreshes++;
    },
    visible: () => visible,
    onVisibilityChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const show = (shown: boolean) => {
    visible = shown;
    for (const listener of listeners) listener();
  };
  return { stop, show, refreshes: () => refreshes, listeners };
};

it("refreshes every minute while the page is visible", () => {
  const { refreshes, stop } = page();
  vi.advanceTimersByTime(59_999);
  assert.strictEqual(refreshes(), 0);
  vi.advanceTimersByTime(1);
  assert.strictEqual(refreshes(), 1);
  vi.advanceTimersByTime(120_000);
  assert.strictEqual(refreshes(), 3);
  stop();
});

it("never refreshes while the window is hidden, and catches up when it shows again late", () => {
  const { refreshes, show, stop } = page();
  vi.advanceTimersByTime(30_000);
  show(false);
  vi.advanceTimersByTime(600_000);
  assert.strictEqual(refreshes(), 0);
  show(true);
  assert.strictEqual(refreshes(), 1);
  vi.advanceTimersByTime(59_999);
  assert.strictEqual(refreshes(), 1);
  vi.advanceTimersByTime(1);
  assert.strictEqual(refreshes(), 2);
  stop();
});

it("doesn't refresh on showing again within the minute", () => {
  const { refreshes, show, stop } = page();
  vi.advanceTimersByTime(10_000);
  show(false);
  vi.advanceTimersByTime(10_000);
  show(true);
  assert.strictEqual(refreshes(), 0);
  vi.advanceTimersByTime(40_000);
  assert.strictEqual(refreshes(), 1);
  stop();
});

it("stops for good once the page leaves the screen", () => {
  const { refreshes, stop, listeners } = page();
  stop();
  vi.advanceTimersByTime(600_000);
  assert.strictEqual(refreshes(), 0);
  assert.strictEqual(listeners.size, 0);
});
