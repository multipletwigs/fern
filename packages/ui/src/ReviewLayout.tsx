import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";

export interface ReviewItem {
  readonly key: string;
  // Its row in the list on the left, such as a `ReviewEntry`.
  readonly entry: ReactNode;
  // Above its entry in the list, as for the first item of a group, such as a `ReviewHeading`.
  readonly heading?: ReactNode;
  // What fills the right while it's the open item.
  readonly pane: ReactNode;
}

// Keys typed into a field are the field's.
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

// The list's column on the left, which a `ReviewLayoutFoot` carries on under the layout.
export const listColumn =
  "w-12 shrink-0 border-r border-hairline bg-side-panel @3xl:w-[272px]";

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Anything the developer works through item by item: every item listed on the left, the open one
// filling the right. The panes sit side by side and snap, so a new `at` slides sideways to it, and
// swiping to another pane opens it. In a narrow layout the list folds to a rail of the items'
// marks. Keys reach `onKeyDown` only while focus is inside the layout and not in a field, so typing
// in the composer never moves it. It takes focus when it appears, or when `active` turns on, unless
// the developer is typing somewhere.
export function ReviewLayout({
  label,
  header,
  items,
  at,
  active,
  onSelect,
  onKeyDown,
}: {
  label: string;
  // Above the list, such as how far through the developer is.
  header?: ReactNode;
  items: ReadonlyArray<ReviewItem>;
  at: number;
  active: boolean;
  onSelect: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  useEffect(() => {
    if (!active || isEditable(document.activeElement)) return;
    root.current?.focus({ preventScroll: true });
  }, [active]);

  // Slide to the open pane: at once the first time, smoothly after. A pane that slides away goes
  // inert, so focus inside it comes back to the layout to keep the keys working.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const left = at * element.clientWidth;
    if (Math.abs(element.scrollLeft - left) >= 1)
      element.scrollTo({
        left,
        behavior: placed.current && !reducedMotion() ? "smooth" : "instant",
      });
    placed.current = true;
    list.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest" });
    const focused = document.activeElement;
    if (focused === document.body || focused?.closest("[inert]"))
      root.current?.focus({ preventScroll: true });
  }, [at]);

  // The developer swiped: open the pane it settled on.
  const onScrollEnd = useEffectEvent(() => {
    const element = scroller.current;
    if (!element || element.clientWidth === 0) return;
    const landed = Math.round(element.scrollLeft / element.clientWidth);
    if (landed !== at && landed >= 0 && landed < items.length) onSelect(landed);
  });

  return (
    <div
      ref={root}
      role="group"
      tabIndex={-1}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (isEditable(event.target)) return;
        onKeyDown(event);
      }}
      // Focus that falls out of the layout to nowhere, as when a field lets go of it on Escape,
      // comes back to it. When the window loses focus the field keeps it, so that's left alone.
      onBlur={(event) => {
        if (event.relatedTarget) return;
        setTimeout(() => {
          if (document.activeElement === document.body)
            root.current?.focus({ preventScroll: true });
        });
      }}
      className="@container flex h-full min-h-0 outline-none"
    >
      <nav className={`flex flex-col ${listColumn}`}>
        {header && (
          <div className="hidden shrink-0 px-4.5 pt-5 pb-3 @3xl:block">
            {header}
          </div>
        )}
        <ol
          ref={list}
          className="flex-1 space-y-0.5 overflow-y-auto px-1.5 pt-3 pb-6 @3xl:px-2 @3xl:pt-0"
        >
          {items.map((item, index) => (
            <li key={item.key}>
              {item.heading}
              <button
                type="button"
                tabIndex={-1}
                data-active={index === at || undefined}
                aria-current={index === at ? "step" : undefined}
                // Focus stays with the layout, so its keys keep working after a click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  root.current?.focus({ preventScroll: true });
                  onSelect(index);
                }}
                className="side-row h-auto justify-center py-2 text-left @3xl:px-2.5"
              >
                {item.entry}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div
        ref={scroller}
        onScrollEnd={() => onScrollEnd()}
        className="flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        {items.map((item, index) => (
          <section
            key={item.key}
            inert={index !== at}
            // The browser skips laying out panes out of sight, so a long queue, with a diff in every
            // pane, stays light. Emptying them instead would make a sideways snap overshoot.
            className="h-full w-full shrink-0 snap-start snap-always overflow-x-hidden overflow-y-auto [content-visibility:auto]"
          >
            {item.pane}
          </section>
        ))}
      </div>
    </div>
  );
}
