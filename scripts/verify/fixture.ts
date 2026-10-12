import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Writes a hand-made External Session with Subagents into a CLAUDE_CONFIG_DIR, in Claude Code's
// own on-disk shape (see packages/server/docs/claude-code-files.md). It covers a background
// Subagent with a nested one, two back-to-back foreground ones (one hands back through
// SubagentHandback, one with plain text), enough finished ones to overflow the tab bar, and one
// still running.

export const FIXTURE_SESSION = "f2121212-2121-4121-8121-212121212121";

// Claude Code names a project's folder after its cwd, every non-alphanumeric made a dash.
const projectFolder = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

const delivered = (agentId: string) =>
  `This agent's report was delivered to you as a message from "${agentId}" (its SubagentHandback call). Read it there; it is not repeated here.`;
const launched = (agentId: string) =>
  `Async agent launched successfully.\nagentId: ${agentId}\nThe agent is working in the background. You will be notified automatically when it completes.`;

export const writeFixture = (configDir: string, cwd: string) => {
  const root = join(configDir, "projects", projectFolder(cwd));
  const subagents = join(root, FIXTURE_SESSION, "subagents");
  mkdirSync(subagents, { recursive: true });

  let clock = 0;
  const timestamp = () => {
    clock += 3;
    const m = String(Math.floor(clock / 60)).padStart(2, "0");
    const s = String(clock % 60).padStart(2, "0");
    return `2026-10-12T09:${m}:${s}.000Z`;
  };

  const transcript = (agentId?: string) => {
    const lines: Array<object> = [];
    let parent: string | null = null;
    const add = (type: string, message: object, extra: object = {}) => {
      const uuid = randomUUID();
      lines.push({
        parentUuid: parent,
        isSidechain: agentId !== undefined,
        type,
        message,
        uuid,
        timestamp: timestamp(),
        userType: "external",
        // Fern hides `sdk-ts` Sessions, so the fixture says it came from the CLI.
        entrypoint: "cli",
        cwd,
        sessionId: FIXTURE_SESSION,
        version: "2.1.296",
        ...(agentId ? { agentId } : {}),
        ...extra,
      });
      parent = uuid;
    };
    const assistant = (block: object) =>
      add("assistant", {
        model: "claude-opus-5-5",
        id: `msg_${randomUUID().slice(0, 20)}`,
        type: "message",
        role: "assistant",
        content: [block],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1000,
          output_tokens: 50,
        },
      });
    const t = {
      user: (content: unknown, extra: object = {}) =>
        add("user", { role: "user", content }, extra),
      text: (text: string) => assistant({ type: "text", text }),
      tool: (id: string, name: string, input: object) =>
        assistant({ type: "tool_use", id, name, input }),
      result: (id: string, text: string) =>
        t.user([
          {
            tool_use_id: id,
            type: "tool_result",
            content: [{ type: "text", text }],
          },
        ]),
      // A Hand-back delivered to the delegating agent as a peer message.
      handBack: (from: string, name: string, body: string) =>
        t.user(
          `<agent-message from="${from}">\n[Subagent hand-back] The report follows:\n  ${body}\n</agent-message>`,
          {
            isMeta: true,
            origin: { kind: "peer", from, name, body, handback: true },
          },
        ),
      write: (path: string) =>
        writeFileSync(
          path,
          lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
        ),
    };
    return t;
  };

  const subagent = (
    agentId: string,
    meta: object,
    build: (t: ReturnType<typeof transcript>) => void,
  ) => {
    const t = transcript(agentId);
    build(t);
    t.write(join(subagents, `agent-${agentId}.jsonl`));
    writeFileSync(
      join(subagents, `agent-${agentId}.meta.json`),
      JSON.stringify({ requestNonInteractive: true, ...meta }),
    );
  };

  // Agent ids take Claude Code's shape, `a` and 16 hex digits: the SDK checks them.
  const BG = "a0b0000000000000b";
  const NEST = "a0e0000000000000e";
  const A1 = "a0c0000000000000c";
  const A2 = "a0d0000000000000d";
  const DONE = ["a1f0000000000000f", "a2f0000000000000f", "a3f0000000000000f"];
  const RUNNING = "a4f0000000000000f";

  const main = transcript();
  main.user(
    "Fixture: audit the transcript code with background and foreground Subagents.",
    { origin: { kind: "human" } },
  );
  main.tool("toolu_fixtureBackground01", "Agent", {
    description: "Background audit of View.ts",
    subagent_type: "general-purpose",
    run_in_background: true,
    prompt:
      "Audit packages/server/src/transcript/View.ts for how Agent calls are rendered. Spawn an Explore Subagent for the web side.",
  });
  main.result("toolu_fixtureBackground01", launched(BG));
  main.tool("toolu_fixtureForegroundA1", "Agent", {
    description: "Find rows.ts folding",
    subagent_type: "Explore",
    prompt: "Where does apps/web fold runs of the same tool?",
  });
  main.result("toolu_fixtureForegroundA1", delivered(A1));
  main.handBack(
    A1,
    "Explore",
    "rows.ts `toRows` folds back-to-back calls to the same tool.",
  );
  main.tool("toolu_fixtureForegroundA2", "Agent", {
    description: "Find toolName nouns",
    subagent_type: "Explore",
    prompt: "What does apps/web/src/session/toolName.ts call each tool?",
  });
  main.result(
    "toolu_fixtureForegroundA2",
    'toolName.ts has `displayName` and a `nouns` table; Agent has no entry, so a run reads "N calls".',
  );
  DONE.forEach((agentId, i) => {
    main.tool(`toolu_fixtureDone0000${i}`, "Agent", {
      description: `Implement ticket ${i + 1}`,
      subagent_type: "general-purpose",
      run_in_background: true,
      prompt: `Implement ticket ${i + 1}.`,
    });
    main.result(`toolu_fixtureDone0000${i}`, launched(agentId));
  });
  main.tool("toolu_fixtureRunning0001", "Agent", {
    description: "Implement the last ticket",
    subagent_type: "general-purpose",
    run_in_background: true,
    prompt: "Implement the last ticket.",
  });
  main.result("toolu_fixtureRunning0001", launched(RUNNING));
  main.handBack(
    BG,
    "general-purpose",
    "View.ts turns an Agent call into a generic ToolCall.",
  );
  DONE.forEach((agentId, i) =>
    main.handBack(agentId, "general-purpose", `Ticket ${i + 1} is done.`),
  );
  main.text("Most Subagents are back; the last ticket is still running.");
  main.write(join(root, `${FIXTURE_SESSION}.jsonl`));

  subagent(
    BG,
    {
      agentType: "general-purpose",
      description: "Background audit of View.ts",
      toolUseId: "toolu_fixtureBackground01",
      spawnDepth: 1,
      requestShape: "background",
    },
    (t) => {
      t.user(
        "Audit packages/server/src/transcript/View.ts for how Agent calls are rendered. Spawn an Explore Subagent for the web side.",
      );
      t.tool("toolu_fixtureBgRead000001", "Read", {
        file_path: join(cwd, "packages/server/src/transcript/View.ts"),
      });
      t.result(
        "toolu_fixtureBgRead000001",
        "// Turns the messages the Agent SDK reads …",
      );
      t.tool("toolu_fixtureNested000001", "Agent", {
        description: "Web side of Agent rows",
        subagent_type: "Explore",
        prompt: "How does apps/web render an Agent tool call?",
      });
      t.result("toolu_fixtureNested000001", delivered(NEST));
      t.handBack(
        NEST,
        "Explore",
        "ItemView renders it as a plain ToolCallRow.",
      );
      t.tool("toolu_fixtureBgHandback01", "SubagentHandback", {
        message: "View.ts turns an Agent call into a generic ToolCall.",
      });
      t.result("toolu_fixtureBgHandback01", "Delivered.");
    },
  );

  subagent(
    NEST,
    {
      agentType: "Explore",
      description: "Web side of Agent rows",
      toolUseId: "toolu_fixtureNested000001",
      spawnDepth: 2,
      parentAgentId: BG,
      requestShape: "foreground",
    },
    (t) => {
      t.user("How does apps/web render an Agent tool call?");
      t.tool("toolu_fixtureNestGrep0001", "Grep", { pattern: "ToolCallRow" });
      t.result(
        "toolu_fixtureNestGrep0001",
        "apps/web/src/session/ItemView.tsx",
      );
      t.tool("toolu_fixtureNestHandbk01", "SubagentHandback", {
        message: "ItemView renders it as a plain ToolCallRow.",
      });
      t.result("toolu_fixtureNestHandbk01", "Delivered.");
    },
  );

  subagent(
    A1,
    {
      agentType: "Explore",
      description: "Find rows.ts folding",
      toolUseId: "toolu_fixtureForegroundA1",
      spawnDepth: 1,
      requestShape: "foreground",
    },
    (t) => {
      t.user("Where does apps/web fold runs of the same tool?");
      t.tool("toolu_fixtureA1Grep00001", "Grep", { pattern: "toRows" });
      t.result("toolu_fixtureA1Grep00001", "apps/web/src/session/rows.ts");
      t.tool("toolu_fixtureA1Handbk001", "SubagentHandback", {
        message: "rows.ts `toRows` folds back-to-back calls to the same tool.",
      });
      t.result("toolu_fixtureA1Handbk001", "Delivered.");
    },
  );

  // Hands back with plain final text, no SubagentHandback.
  subagent(
    A2,
    {
      agentType: "Explore",
      description: "Find toolName nouns",
      toolUseId: "toolu_fixtureForegroundA2",
      spawnDepth: 1,
      requestShape: "foreground",
    },
    (t) => {
      t.user("What does apps/web/src/session/toolName.ts call each tool?");
      t.tool("toolu_fixtureA2Read00001", "Read", {
        file_path: join(cwd, "apps/web/src/session/toolName.ts"),
      });
      t.result("toolu_fixtureA2Read00001", "export const displayName = …");
      t.text(
        'toolName.ts has `displayName` and a `nouns` table; Agent has no entry, so a run reads "N calls".',
      );
    },
  );

  DONE.forEach((agentId, i) =>
    subagent(
      agentId,
      {
        agentType: "general-purpose",
        description: `Implement ticket ${i + 1}`,
        toolUseId: `toolu_fixtureDone0000${i}`,
        spawnDepth: 1,
        requestShape: "background",
      },
      (t) => {
        t.user(`Implement ticket ${i + 1}.`);
        t.tool(`toolu_fixtureDoneHb000${i}`, "SubagentHandback", {
          message: `Ticket ${i + 1} is done.`,
        });
        t.result(`toolu_fixtureDoneHb000${i}`, "Delivered.");
      },
    ),
  );

  // Ends on a tool call with no result yet: still at work while the Session's files are fresh.
  subagent(
    RUNNING,
    {
      agentType: "general-purpose",
      description: "Implement the last ticket",
      toolUseId: "toolu_fixtureRunning0001",
      spawnDepth: 1,
      requestShape: "background",
    },
    (t) => {
      t.user("Implement the last ticket.");
      t.tool("toolu_fixtureRunTest0001", "Bash", { command: "pnpm test" });
    },
  );
};
