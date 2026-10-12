// Stand-ins for the Claude Code process behind the Agent SDK's query(). Like the real one, each
// takes messages from its open input as soon as they're sent, and lives until it's closed.

interface SentMessage {
  readonly uuid?: string;
  readonly message: {
    readonly content: ReadonlyArray<{ readonly text?: string }> | string;
  };
}
interface QueryArgs {
  readonly prompt: AsyncIterable<SentMessage>;
  readonly options: Record<string, unknown>;
}
type Step = Record<string, unknown>;

const textOf = ({ message }: SentMessage) =>
  typeof message.content === "string"
    ? message.content
    : (message.content.find((part) => part.text)?.text ?? "");

// What the process was sent, in order.
interface Received {
  readonly uuid: string | undefined;
  readonly text: string;
}

// Reads the input the moment a message arrives, as the SDK does, and wakes whoever waits on it.
const reader = (prompt: AsyncIterable<SentMessage>) => {
  const received: Array<Received> = [];
  let wake: (() => void) | undefined;
  const state = { received, closed: false, notify: () => wake?.() };
  void (async () => {
    for await (const message of prompt) {
      received.push({ uuid: message.uuid, text: textOf(message) });
      state.notify();
    }
  })();
  const until = async (condition: () => boolean) => {
    while (!condition() && !state.closed)
      await new Promise<void>((resolve) => (wake = resolve));
  };
  return { state, until };
};

// A replayed process, for the tests to watch and steer.
export interface ReplayedProcess {
  readonly options: Record<string, unknown>;
  readonly received: ReadonlyArray<Received>;
  // What happened, in order: what the process was sent, each message it sent back by label,
  // interrupts, and the close.
  readonly log: Array<string>;
  // The step the replay waits at, if any: `send <text>` for the developer's next message,
  // `interrupt`, or `end` once the fixture is played out.
  waiting: string | undefined;
  readonly closed: boolean;
}

const label = (step: Step): string => {
  if (step.type === "result") return `result ${JSON.stringify(step.result)}`;
  if (step.type === "command_lifecycle")
    return `${String(step.state)} ${String(step.command_uuid)}`;
  if (step.type === "assistant") {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const content = (step.message as { content: Array<Step> }).content;
    return `assistant ${content
      .map((b) =>
        b.type === "text" ? String(b.text) : String(b.name ?? b.type),
      )
      .join(" ")}`;
  }
  if (step.type === "user") return "user";
  return String(step.subtype ?? step.type);
};

// Fixtures name the client uuids of the messages sent "$1", "$2"... in the order sent.
const substitute = (
  value: unknown,
  received: ReadonlyArray<Received>,
): unknown => {
  if (typeof value === "string" && /^\$\d+$/.test(value))
    return received[Number(value.slice(1)) - 1]?.uuid ?? value;
  if (Array.isArray(value)) return value.map((v) => substitute(v, received));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substitute(v, received)]),
    );
  return value;
};

// Fixtures each process opened plays, in order.
export const scripts: Array<ReadonlyArray<Step>> = [];
// Every process opened, in order.
export const processes: Array<ReplayedProcess> = [];
// Holds the replay before the first message whose label matches, until released.
interface Hold {
  readonly match: (label: string) => boolean;
  reached: boolean;
  readonly release: () => void;
  readonly released: Promise<void>;
}
let gate: Hold | undefined;
export const holdAt = (match: (label: string) => boolean): Hold => {
  const { promise, resolve } = Promise.withResolvers<void>();
  gate = { match, reached: false, release: resolve, released: promise };
  return gate;
};

// Plays a fixture of steps captured from the real CLI: SDK messages in order, `{ send }` where the
// developer sent a message (the replay waits until it arrives), `{ interrupt }` where they stopped
// the turn (the replay waits for interrupt(), which answers with that receipt).
export const replayQuery = ({ prompt, options }: QueryArgs) => {
  const steps = scripts.shift() ?? [];
  const { state, until } = reader(prompt);
  let interrupted = false;
  let receipt: unknown;
  const process: ReplayedProcess = {
    options,
    received: state.received,
    log: [],
    waiting: undefined,
    get closed() {
      return state.closed;
    },
  };
  processes.push(process);
  async function* events() {
    let sent = 0;
    for (const step of steps) {
      if (state.closed) return;
      if ("send" in step) {
        sent++;
        process.waiting = `send ${String(step.send)}`;
        await until(() => state.received.length >= sent);
        process.waiting = undefined;
        if (state.closed) return;
        process.log.push(`sent ${state.received[sent - 1]?.text ?? ""}`);
        continue;
      }
      if ("interrupt" in step) {
        process.waiting = "interrupt";
        receipt = step.interrupt;
        await until(() => interrupted);
        process.waiting = undefined;
        continue;
      }
      const message = substitute(step, state.received);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const name = label(message as Step);
      const held = gate;
      if (held?.match(name)) {
        gate = undefined;
        held.reached = true;
        await held.released;
      }
      if (state.closed) return;
      process.log.push(name);
      yield message;
    }
    // Like Claude Code with its input open, it then waits for more until closed.
    process.waiting = "end";
    await until(() => false);
  }
  return Object.assign(events(), {
    interrupt: () => {
      process.log.push("interrupt");
      interrupted = true;
      state.notify();
      return Promise.resolve(substitute(receipt, state.received));
    },
    setModel: () => Promise.resolve(),
    close: () => {
      state.closed = true;
      process.log.push("close");
      state.notify();
    },
  });
};

// A turn a scripted agent runs on one message.
export interface FakeTurn<Options = Record<string, unknown>> {
  readonly sessionId: string;
  readonly text: string;
  // What Fern opened the process with.
  readonly options: Options;
  // Whether this message opened the process.
  readonly first: boolean;
}

// The Session a process was opened on: started, or resumed.
const sessionOf = (options: Record<string, unknown>) =>
  typeof options.sessionId === "string"
    ? options.sessionId
    : typeof options.resume === "string"
      ? options.resume
      : "";

// The Sessions whose scripted processes were closed, in order.
export const closedSessions: Array<string> = [];

// A process that answers every message with a turn of its own, the way Claude Code does once each
// message has been taken in: `run` acts as the agent, then the turn ends with a result. Stamps the
// lifecycle and result fields Claude Code stamps with each message's uuid.
export const scriptedQuery =
  <Options = Record<string, unknown>>(
    run: (
      turn: FakeTurn<Options>,
      interrupted: Promise<void>,
    ) => Promise<void> | void,
  ) =>
  ({ prompt, options }: QueryArgs) => {
    const { state, until } = reader(prompt);
    let stopTurn: (() => void) | undefined;
    async function* events() {
      for (let taken = 0; ; taken++) {
        await until(() => state.received.length > taken);
        if (state.closed) return;
        const { uuid, text } = state.received[taken] ?? {
          uuid: undefined,
          text: "",
        };
        yield {
          type: "command_lifecycle",
          command_uuid: uuid,
          state: "started",
        };
        yield {
          type: "system",
          subtype: "init",
          model: "claude-test",
          capabilities: ["msg_lifecycle_v1"],
        };
        const { promise: interrupted, resolve: stop } =
          Promise.withResolvers<void>();
        stopTurn = stop;
        const sessionId = sessionOf(options);
        // The model takes a moment before the agent acts.
        await new Promise((resolve) => setTimeout(resolve, 5));
        await Promise.race([
          run(
            {
              sessionId,
              text,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion
              options: options as Options,
              first: taken === 0,
            },
            interrupted,
          ),
          interrupted,
        ]);
        if (state.closed) return;
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          num_turns: 1,
          result: "",
          user_message_uuids: uuid ? [uuid] : [],
          modelUsage: { "claude-test": { contextWindow: 1_000 } },
        };
      }
    }
    return Object.assign(events(), {
      interrupt: () => {
        stopTurn?.();
        return Promise.resolve(undefined);
      },
      setModel: () => Promise.resolve(),
      close: () => {
        state.closed = true;
        closedSessions.push(sessionOf(options));
        state.notify();
      },
    });
  };
