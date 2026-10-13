import { useAtomValue } from "@effect/atom-react";
import { TerminalExited } from "@repo/ui/TerminalExited";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Effect, Fiber } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { LiveClient } from "../LiveClient";
import { isTerminalToggle } from "./atoms";
import { restartTerminal, runTerminal } from "./connect";

const FONT_SIZE = 12.5;

// Fern's colours, read from its theme so the terminal matches the card it sits on.
const fernTheme = (): ITheme => {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    css.getPropertyValue(`--color-${name}`).trim() || fallback;
  const ink = token("ink", "#ededed");
  return {
    background: token("panel", "#0a0a0a"),
    foreground: ink,
    cursor: ink,
    cursorAccent: token("panel", "#0a0a0a"),
    selectionBackground: "rgb(159 216 255 / 0.25)",
    black: "#1b1c20",
    brightBlack: token("faint", "#4d4d4d"),
    red: token("danger", "#ff7a7a"),
    brightRed: "#ffa3a3",
    green: token("mint", "#7ee2a8"),
    brightGreen: "#a8f0c6",
    yellow: token("amber", "#f5b14c"),
    brightYellow: "#ffd08a",
    blue: "#7aa7ff",
    brightBlue: "#a8c6ff",
    magenta: "#c79bff",
    brightMagenta: "#dcc0ff",
    cyan: token("ice", "#9fd8ff"),
    brightCyan: "#c6e9ff",
    white: token("muted", "#8b8b8b"),
    brightWhite: ink,
  };
};

// A Session's terminal: its shell, in an xterm sized to fit the space it's given. Mounting it
// opens the shell, or attaches to the one already running and shows what it printed; unmounting
// detaches. Focused whenever it becomes `visible`. Once the shell exits, it says so and offers a
// fresh one, which it ends the old one for before telling `onRestarted`, to be mounted afresh.
export function SessionTerminal({
  sessionId,
  visible,
  onRestarted,
}: {
  sessionId: string;
  visible: boolean;
  onRestarted: () => void;
}) {
  const runtime = useAtomValue(LiveClient.runtime);
  const context = AsyncResult.isSuccess(runtime) ? runtime.value : undefined;
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal>(undefined);
  const shown = useRef(visible);
  const [exited, setExited] = useState<number>();
  const restarting = useRef(false);

  useEffect(() => {
    shown.current = visible;
    if (visible) term.current?.focus();
  }, [visible]);

  useEffect(() => {
    const element = host.current;
    if (!element || !context) return undefined;
    const css = getComputedStyle(document.documentElement);
    const fontFamily =
      css.getPropertyValue("--font-mono").trim() || "monospace";
    let unmount: (() => void) | undefined;
    let cancelled = false;
    const mount = () => {
      const terminal = new Terminal({
        fontFamily,
        fontSize: FONT_SIZE,
        lineHeight: 1.2,
        cursorBlink: true,
        theme: fernTheme(),
        allowProposedApi: false,
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.loadAddon(
        new WebLinksAddon((_, uri) =>
          window.open(uri, "_blank", "noopener,noreferrer"),
        ),
      );
      // Ctrl+` belongs to the page, which shows and hides the terminal.
      terminal.attachCustomKeyEventHandler((event) => !isTerminalToggle(event));
      terminal.open(element);
      // Hidden, the panel has no size to fit to; it fits again once shown.
      const refit = () => {
        if (element.clientWidth > 0 && element.clientHeight > 0) fit.fit();
      };
      refit();
      const observer = new ResizeObserver(refit);
      observer.observe(element);
      term.current = terminal;
      const fiber = Effect.runForkWith(context)(
        runTerminal(terminal, sessionId, setExited),
      );
      if (shown.current) terminal.focus();
      unmount = () => {
        observer.disconnect();
        Effect.runFork(Fiber.interrupt(fiber));
        terminal.dispose();
        term.current = undefined;
      };
    };
    // xterm measures its cells once, so the font has to be there first.
    void document.fonts
      .load(`${FONT_SIZE}px ${fontFamily}`)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) mount();
      });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [context, sessionId]);

  const restart = () => {
    if (!context || restarting.current) return;
    restarting.current = true;
    void Effect.runPromiseWith(context)(
      restartTerminal(sessionId).pipe(Effect.ignore),
    ).then(onRestarted);
  };

  return (
    <>
      <div className="h-full py-2 pl-3">
        <div ref={host} className="h-full w-full" />
      </div>
      {exited !== undefined && (
        <TerminalExited code={exited} onRestart={restart} />
      )}
    </>
  );
}
