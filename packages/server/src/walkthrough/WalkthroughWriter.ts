import {
  query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { WalkthroughError, type WalkthroughSince } from "@repo/api";
import { Context, Effect, Layer, Schema, type Scope } from "effect";

// What the Fork returns: Sections claiming hunks by id, and the hunks it didn't make.
export const Draft = Schema.Struct({
  sections: Schema.Array(
    Schema.Struct({
      title: Schema.String.annotate({
        description: "A few words, sentence case, naming the change.",
      }),
      explanation: Schema.String.annotate({
        description:
          "Markdown for the developer: why this changed, and what to look at, in one to three sentences. The hunks are shown right below, so don't walk through the code.",
      }),
      dropped: Schema.optional(Schema.String).annotate({
        description:
          "One line on an approach tried and abandoned on the way to this change. Omit when there was none.",
      }),
      hunks: Schema.Array(Schema.String).annotate({
        description: "Ids of every hunk that implements this change, e.g. h3.",
      }),
      fixes: Schema.optional(Schema.String).annotate({
        description:
          "Id of the open Rejection this change addresses, e.g. r1. Omit when it addresses none.",
      }),
    }),
  ),
  notFromSession: Schema.Array(Schema.String).annotate({
    description:
      "Ids of hunks that none of your own tool calls in this conversation made. Don't claim these in a section.",
  }),
});
export type Draft = typeof Draft.Type;

const draftCodec = Schema.toCodecJson(Draft);
const outputFormat = {
  type: "json_schema" as const,
  schema: Schema.toJsonSchemaDocument(Draft).schema as Record<string, unknown>,
};

export interface DraftHunk {
  readonly id: string;
  readonly path: string;
  readonly header: string;
  readonly lines: ReadonlyArray<string>;
}

// A Rejection from an earlier Walkthrough that no Section has addressed yet.
export interface OpenRejection {
  readonly id: string;
  readonly title: string;
  readonly note: string;
}

export interface WriteRequest {
  readonly sessionId: string;
  readonly cwd: string;
  readonly since: WalkthroughSince;
  readonly hunks: ReadonlyArray<DraftHunk>;
  readonly rejections: ReadonlyArray<OpenRejection>;
}

// A Fork that has written its draft, still open for one revision.
export interface Fork {
  readonly draft: Draft;
  // Asks for the draft again with these hunks claimed or marked as not from this Session.
  revise(
    unclaimed: ReadonlyArray<string>,
  ): Effect.Effect<Draft, WalkthroughError>;
}

// Keeps the prompt within reach of the context window; the Walkthrough itself keeps every line.
const MAX_LINES_PER_HUNK = 120;
const MAX_PROMPT_CHARS = 160_000;

const SINCE: Record<WalkthroughSince, string> = {
  previous: "since your previous Walkthrough",
  start: "since this Session started",
  head: "since the last commit (Fern didn't see this Session start)",
};

const renderHunk = ({ id, path, header, lines }: DraftHunk) => {
  const shown = lines.slice(0, MAX_LINES_PER_HUNK);
  const more = lines.length - shown.length;
  return [
    `### ${id} · ${path}`,
    header,
    ...shown,
    ...(more > 0 ? [`… ${more} more lines`] : []),
  ].join("\n");
};

export const writePrompt = ({ since, hunks, rejections }: WriteRequest) => {
  let budget = MAX_PROMPT_CHARS;
  const rendered = hunks.map((hunk) => {
    const full = renderHunk(hunk);
    if (full.length <= budget) {
      budget -= full.length;
      return full;
    }
    return `### ${hunk.id} · ${hunk.path}\n${hunk.header}\n(lines left out to fit)`;
  });
  return `Fern, the app hosting this Session, needs a Walkthrough of the net change in the repository ${SINCE[since]}. The developer reviews your Walkthrough instead of the raw diff, so it has to account for every changed line.

Group the hunks below into Sections. Each Section is one semantic change, explained for the developer in one to three sentences: why it changed, citing the intent and any decisions from this conversation, and anything they should look at closely. The developer reads the hunks right under your explanation, so don't restate what the code does, and skip headings, lists and recaps. Order Sections so they read well, most important first. Claim every hunk you made in exactly one Section. List hunks that none of your own tool calls made in notFromSession instead of claiming them; another agent or the developer may have made them. Note in one line any approach you tried and dropped on the way.
${
  rejections.length > 0
    ? `
The developer rejected these earlier Sections. When a Section addresses one, set its fixes to the Rejection's id:
${rejections.map((r) => `- ${r.id}: "${r.title}". Note: ${r.note}`).join("\n")}
`
    : ""
}
Don't use any tools and don't change any files. Answer only with the structured output.

## Hunks

${rendered.join("\n\n")}`;
};

export const revisePrompt = (unclaimed: ReadonlyArray<string>) =>
  `These hunks are in neither a Section nor notFromSession: ${unclaimed.join(", ")}. Return the whole Walkthrough again with each of them claimed by a Section, or listed in notFromSession if you didn't make it.`;

const userMessage = (text: string): SDKUserMessage => ({
  type: "user",
  parent_tool_use_id: null,
  message: { role: "user", content: text },
});

// Messages for the Fork's input, sent one at a time as Fern asks for them. Claude Code reads the
// input as it arrives, so the conversation stays open between the draft and the revision.
const inbox = () => {
  const queued: Array<SDKUserMessage> = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  return {
    push(message: SDKUserMessage) {
      queued.push(message);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    async *messages() {
      while (true) {
        const next = queued.shift();
        if (next) yield next;
        else if (closed) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
};

const failed = (message: string) => new WalkthroughError({ message });

const draftOf = (result: SDKResultMessage) =>
  result.subtype === "success" && !result.is_error
    ? Schema.decodeUnknownEffect(draftCodec)(result.structured_output).pipe(
        Effect.mapError((e) =>
          failed(`The Fork's Walkthrough didn't parse: ${e.message}`),
        ),
      )
    : Effect.fail(
        failed(
          result.subtype === "success"
            ? result.result
            : result.errors.join("\n") || result.subtype,
        ),
      );

// Writes Walkthroughs by forking the Session, so the writer knows the intent, the decisions, and
// the approaches tried and dropped (ADR 0003). The Fork has no tools, so it can't change anything,
// and it isn't saved, so it never shows up as a Session.
export class WalkthroughWriter extends Context.Service<
  WalkthroughWriter,
  {
    write(
      request: WriteRequest,
    ): Effect.Effect<Fork, WalkthroughError, Scope.Scope>;
  }
>()("@repo/server/walkthrough/WalkthroughWriter") {
  static readonly layer = Layer.succeed(
    WalkthroughWriter,
    WalkthroughWriter.of({
      write: Effect.fn("WalkthroughWriter.write")(function* (request) {
        const input = inbox();
        input.push(userMessage(writePrompt(request)));
        const fork = yield* Effect.acquireRelease(
          Effect.sync(() =>
            query({
              prompt: input.messages(),
              options: {
                resume: request.sessionId,
                forkSession: true,
                persistSession: false,
                cwd: request.cwd,
                tools: [],
                outputFormat,
              },
            }),
          ),
          (running) =>
            Effect.sync(() => {
              input.close();
              running.close();
            }),
        );

        const nextResult = Effect.tryPromise({
          try: async () => {
            while (true) {
              const next: IteratorResult<SDKMessage> = await fork.next();
              if (next.done)
                throw new Error("the Fork ended without an answer");
              if (next.value.type === "result") return next.value;
            }
          },
          catch: (cause) => failed(`The Fork failed: ${String(cause)}`),
        }).pipe(Effect.flatMap(draftOf));

        const draft = yield* nextResult;
        return {
          draft,
          revise: (unclaimed) =>
            Effect.suspend(() => {
              input.push(userMessage(revisePrompt(unclaimed)));
              return nextResult;
            }),
        };
      }),
    }),
  );
}
