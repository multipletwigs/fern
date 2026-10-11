import type { TranscriptItem } from "@repo/api";

export interface SessionCommit {
  // The tool call that made it.
  readonly id: string;
  readonly subject: string;
  // Short hash, when the command's output names it.
  readonly hash: string | undefined;
}

// `git commit` reports "[branch abc1234] Subject"; a push in the same command reports "a..b main -> main".
const COMMITTED = /^\[\S+(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/m;
const PUSHED = /\b[0-9a-f]{7,40}\.\.([0-9a-f]{7,40})\s+\S+\s+->\s/;
// The first line of the message, given with -m or as a heredoc.
const MESSAGE_FLAG = /\s-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/;
const HEREDOC = /<<-?\s*['"]?(\w+)['"]?\n\s*([^\n]+)/;
// `git commit` run as a command, at the start of a line or after a separator, not merely mentioned.
const RUNS_COMMIT = /(?:^|[;&|(]|\n)\s*git(?:\s+-C\s+\S+)?\s+commit\b/;

const commandOf = (input: string) => {
  try {
    const parsed: unknown = JSON.parse(input);
    return typeof parsed === "object" &&
      parsed !== null &&
      "command" in parsed &&
      typeof parsed.command === "string"
      ? parsed.command
      : undefined;
  } catch {
    return undefined;
  }
};

// The commits Claude made this Session, in order, read from its successful `git commit` calls.
export const sessionCommits = (items: ReadonlyArray<TranscriptItem>) =>
  items.flatMap((item): Array<SessionCommit> => {
    if (item._tag !== "ToolCall" || item.name !== "Bash") return [];
    const command = commandOf(item.input);
    const { result } = item;
    const run = command ? RUNS_COMMIT.exec(command) : null;
    if (!command || !run || !result || result.isError) return [];
    // The message belongs to that `git commit`, not to anything before it.
    const commit = command.slice(run.index);
    if (/nothing to commit|no changes added to commit/.test(result.text))
      return [];
    const committed = COMMITTED.exec(result.text);
    const flag = MESSAGE_FLAG.exec(commit);
    const subject =
      committed?.[2] ??
      (flag?.[1] ?? flag?.[2])?.split("\n")[0] ??
      HEREDOC.exec(commit)?.[2] ??
      "Commit";
    const hash = committed?.[1] ?? PUSHED.exec(result.text)?.[1];
    return [{ id: item.id, subject: subject.trim(), hash: hash?.slice(0, 7) }];
  });
