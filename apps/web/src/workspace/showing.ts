import { Atom } from "effect/reactivity";

// What can be under Settings: a Session, the one picked in the sidebar or else the current one, a
// blank one about to be started in a Project's folder, or a Project's Pull requests page.
export type Underneath =
  | { readonly _tag: "Session" }
  | { readonly _tag: "NewSession"; readonly root: string }
  | { readonly _tag: "PullRequests"; readonly root: string };

// What's right of the sidebar: one of those, or Settings in place of it, until Settings goes back
// to it.
export type Showing =
  Underneath | { readonly _tag: "Settings"; readonly over: Underneath };

export const showingAtom = Atom.make<Showing>({ _tag: "Session" }).pipe(
  Atom.keepAlive,
);

// What's showing, or what Settings is showing in place of.
const underneath = (showing: Showing): Underneath =>
  showing._tag === "Settings" ? showing.over : showing;

// Whether Settings is on screen. Opening it keeps what it's opened over, to go back to.
export const settingsOpenAtom = Atom.writable(
  (get) => get(showingAtom)._tag === "Settings",
  (ctx, open: boolean) => {
    const under = underneath(ctx.get(showingAtom));
    ctx.set(showingAtom, open ? { _tag: "Settings", over: under } : under);
  },
);

// The folder of a blank Session on screen, opened by /clear or a Project's new-session button,
// until its first message starts it; also while Settings is over it. Opening one, or closing it to
// show a Session, puts Settings away.
export const newSessionAtom = Atom.writable(
  (get) => {
    const under = underneath(get(showingAtom));
    return under._tag === "NewSession" ? under.root : undefined;
  },
  (ctx, root: string | undefined) =>
    ctx.set(
      showingAtom,
      root === undefined ? { _tag: "Session" } : { _tag: "NewSession", root },
    ),
);

// The Project whose Pull requests page is on screen, opened from its group in the sidebar; also
// while Settings is over it. Opening it puts Settings away; picking a Session, or starting one,
// leaves it.
export const pullRequestsPageAtom = Atom.writable(
  (get) => {
    const under = underneath(get(showingAtom));
    return under._tag === "PullRequests" ? under.root : undefined;
  },
  (ctx, root: string | undefined) =>
    ctx.set(
      showingAtom,
      root === undefined ? { _tag: "Session" } : { _tag: "PullRequests", root },
    ),
);
