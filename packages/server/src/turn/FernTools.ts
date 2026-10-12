import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { Context, Effect, Layer } from "effect";

// What a Hosted Session's turns run with besides the message: Fern's own tools, as MCP servers
// keyed by name, and steering appended to Claude Code's system prompt.
export interface HostedOptions {
  readonly mcpServers: Readonly<Record<string, McpServerConfig>>;
  readonly appendSystemPrompt: string;
}

// The steering every Hosted Session gets until the Flow engine supplies its own.
export const FLOW_STEERING = `This Session is hosted by Fern and follows Fern's Flow: Grill, then Spec, then Implement, then Retro. Grill sharpens the idea with the developer, Spec writes the Brief and its tickets, Implement builds them, and Retro looks back on the Session for Findings about the Setup. Fern moves the Session from one Phase to the next.`;

// Supplies the extra options for each Hosted Session, so Turns gets Fern's tools and steering
// without depending on the Flow engine that answers them. External Sessions never ask.
export class FernTools extends Context.Service<
  FernTools,
  {
    // The options for the Hosted Session's next turn.
    options(id: string): Effect.Effect<HostedOptions>;
  }
>()("@repo/server/turn/FernTools") {
  // No tools yet, and steering that only describes the Flow.
  static readonly layer = Layer.succeed(
    FernTools,
    FernTools.of({
      options: () =>
        Effect.succeed({ mcpServers: {}, appendSystemPrompt: FLOW_STEERING }),
    }),
  );
}
