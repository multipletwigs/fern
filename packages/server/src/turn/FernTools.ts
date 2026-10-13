import {
  createSdkMcpServer,
  type McpServerConfig,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { Context, Effect, Layer, Ref } from "effect";

// What a Hosted Session's turns run with besides the message: Fern's own tools, as MCP servers
// keyed by name, the tools' names as Claude Code calls them, so they run without asking, and
// steering appended to Claude Code's system prompt.
export interface HostedOptions {
  readonly mcpServers: Readonly<Record<string, McpServerConfig>>;
  readonly allowedTools: ReadonlyArray<string>;
  readonly appendSystemPrompt: string;
}

// The steering every Hosted Session gets, before what each service contributes.
export const FLOW_STEERING = `This Session is hosted by Fern and follows Fern's Flow: Grill, then Spec, then Implement, then Retro. Grill sharpens the idea with the developer, Spec writes the Brief and its tickets, Implement builds them, and Retro looks back on the Session for Findings about the Setup. Fern moves the Session from one Phase to the next.`;

// The MCP server Fern's tools are on, which names them `mcp__fern__<tool>`.
export const SERVER = "fern";

// What one service adds to every Hosted Session's turns: tools that answer for the Session, and
// the steering that tells the agent how to use them.
export interface Contribution {
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly tools: (id: string) => ReadonlyArray<SdkMcpToolDefinition<any>>;
  // What the agent is told about them, if anything more than each tool's own description.
  readonly steering?: string;
  // Whether the Session gets this at all; every Hosted Session does when left out.
  readonly when?: (id: string) => Effect.Effect<boolean>;
}

// Supplies the extra options for each Hosted Session, so Turns gets Fern's tools and steering
// without depending on the services that answer them: those register what they contribute here.
// External Sessions never ask.
export class FernTools extends Context.Service<
  FernTools,
  {
    // Adds a service's tools and steering to every Hosted Session's turns from now on.
    register(contribution: Contribution): Effect.Effect<void>;
    // The options for the Hosted Session's next turn.
    options(id: string): Effect.Effect<HostedOptions>;
  }
>()("@repo/server/turn/FernTools") {
  static readonly layer = Layer.effect(
    FernTools,
    Effect.gen(function* () {
      const contributions = yield* Ref.make<ReadonlyArray<Contribution>>([]);
      return FernTools.of({
        register: (contribution) =>
          Ref.update(contributions, (all) => [...all, contribution]),
        options: (id) =>
          Ref.get(contributions).pipe(
            Effect.flatMap((all) =>
              Effect.filter(all, (c) => c.when?.(id) ?? Effect.succeed(true)),
            ),
            Effect.map((all): HostedOptions => {
              const tools = all.flatMap((c) => c.tools(id));
              const appendSystemPrompt = [
                FLOW_STEERING,
                ...all.flatMap((c) => (c.steering ? [c.steering] : [])),
              ].join("\n\n");
              if (tools.length === 0)
                return { mcpServers: {}, allowedTools: [], appendSystemPrompt };
              return {
                mcpServers: {
                  [SERVER]: createSdkMcpServer({
                    name: SERVER,
                    version: "1.0.0",
                    tools: [...tools],
                    alwaysLoad: true,
                  }),
                },
                allowedTools: tools.map((t) => `mcp__${SERVER}__${t.name}`),
                appendSystemPrompt,
              };
            }),
          ),
      });
    }),
  );
}
