import {
  createSdkMcpServer,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { Context, Effect, Layer, Ref, type Scope } from "effect";
import { z } from "zod";

// What a Hosted Session's turns run with besides the message: Fern's own tools, as MCP servers
// keyed by name, the tools' names as Claude Code calls them, allowed without asking, and steering
// appended to Claude Code's system prompt.
export interface HostedOptions {
  readonly mcpServers: Readonly<Record<string, McpServerConfig>>;
  readonly allowedTools: ReadonlyArray<string>;
  readonly appendSystemPrompt: string;
}

// The steering every Hosted Session gets, before what each set of tools adds.
export const FLOW_STEERING = `This Session is hosted by Fern and follows Fern's Flow: Grill, then Spec, then Implement, then Retro. Grill sharpens the idea with the developer, Spec writes the Brief and its tickets, Implement builds them, and Retro looks back on the Session for Findings about the Setup. Fern moves the Session from one Phase to the next.`;

// Fern's tools reach Claude Code as one in-process MCP server under this name, so each is called
// `mcp__fern__<tool>`.
export const SERVER = "fern";

// A tool bound to one Session, its input type left behind so tools of any shape list together.
export type FernTool = NonNullable<
  Parameters<typeof createSdkMcpServer>[0]["tools"]
>[number];

// A Fern tool. Claude Code checks the input against `shape` before the handler runs; checking it
// here as well gives the handler its type.
export const fernTool = <Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  handler: (
    args: z.infer<z.ZodObject<Shape>>,
  ) => ReturnType<FernTool["handler"]>,
): FernTool => ({
  name,
  description,
  inputSchema: shape,
  handler: (args) => handler(z.object(shape).parse(args)),
});

// Tools one service gives every Hosted Session, and the steering on when to use them.
export interface Toolset {
  // The tools for one Session, their handlers bound to it.
  tools(session: string): ReadonlyArray<FernTool>;
  readonly steering: string;
}

// Supplies the extra options for each Hosted Session, so Turns gets Fern's tools and steering
// without depending on the services that answer them: each of those adds its own Toolset.
// External Sessions never ask.
export class FernTools extends Context.Service<
  FernTools,
  {
    // The options for the Hosted Session's next turn.
    options(id: string): Effect.Effect<HostedOptions>;
    // Gives every Hosted Session's turns the tools for as long as the scope lasts.
    add(toolset: Toolset): Effect.Effect<void, never, Scope.Scope>;
  }
>()("@repo/server/turn/FernTools") {
  static readonly layer = Layer.effect(
    FernTools,
    Effect.gen(function* () {
      const toolsets = yield* Ref.make<ReadonlyArray<Toolset>>([]);
      return FernTools.of({
        options: (id) =>
          Ref.get(toolsets).pipe(
            Effect.map((all): HostedOptions => {
              const tools = all.flatMap((set) => set.tools(id));
              return {
                mcpServers:
                  tools.length === 0
                    ? {}
                    : {
                        [SERVER]: createSdkMcpServer({
                          name: SERVER,
                          version: "1.0.0",
                          tools: [...tools],
                          alwaysLoad: true,
                        }),
                      },
                allowedTools: tools.map(
                  (tool) => `mcp__${SERVER}__${tool.name}`,
                ),
                appendSystemPrompt: [
                  FLOW_STEERING,
                  ...all.map((set) => set.steering),
                ].join("\n\n"),
              };
            }),
          ),
        add: (toolset) =>
          Effect.acquireRelease(
            Ref.update(toolsets, (all) => [...all, toolset]),
            () =>
              Ref.update(toolsets, (all) => all.filter((t) => t !== toolset)),
          ),
      });
    }),
  );
}
