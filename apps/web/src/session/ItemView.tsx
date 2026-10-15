import type { TranscriptItem } from "@repo/api";
import { Chip } from "@repo/ui/Chip";
import { CommandCard } from "@repo/ui/CommandCard";
import { Diff } from "@repo/ui/Diff";
import { Expandable } from "@repo/ui/Expandable";
import { HandBackRow } from "@repo/ui/HandBackRow";
import { Markdown } from "@repo/ui/Markdown";
import { MessageCard } from "@repo/ui/MessageCard";
import { Pre } from "@repo/ui/Pre";
import { QuestionCard } from "@repo/ui/QuestionCard";
import { SubagentRow } from "@repo/ui/SubagentRow";
import { ToolCallRow } from "@repo/ui/ToolCallRow";
import { useFileOpener } from "../code/useFileOpener";
import { GrillSuggestion } from "../flow/GrillSuggestion";
import { displayName } from "./toolName";
import { UnansweredPrompt } from "./UnansweredPrompt";

// Given `onOpenSubagent`, a Subagent row opens that Subagent's tab.
export function ItemView({
  sessionId,
  item,
  onOpenSubagent,
}: {
  sessionId: string;
  item: TranscriptItem;
  onOpenSubagent?: (agentId: string) => void;
}) {
  const opener = useFileOpener();
  switch (item._tag) {
    case "Prompt":
      return item.unanswered ? (
        <UnansweredPrompt
          sessionId={sessionId}
          text={item.text}
          images={item.images}
        />
      ) : (
        <MessageCard images={item.images}>{item.text}</MessageCard>
      );
    case "Command":
      return <CommandCard name={item.name} args={item.args} />;
    case "Text":
      return <Markdown>{item.markdown}</Markdown>;
    case "Thinking":
      return (
        <Expandable label={<span className="italic">Thinking</span>}>
          <p className="text-sm leading-6 whitespace-pre-wrap text-muted">
            {item.text}
          </p>
        </Expandable>
      );
    case "ToolCall": {
      const { result } = item;
      if (item.grillSuggestion)
        return (
          <GrillSuggestion sessionId={sessionId} id={item.grillSuggestion} />
        );
      // AskUserQuestion as the card it was meant to be: the question, its options, and the answer given.
      if (item.questions)
        return item.questions.map((q) => (
          <QuestionCard
            key={q.question}
            header={q.header}
            question={q.question}
            options={q.options}
            picked={q.options.filter((label) =>
              result?.text.includes(`="${label}"`),
            )}
          />
        ));
      return (
        <ToolCallRow
          name={displayName(item.name)}
          summary={item.summary}
          status={!result ? "running" : result.isError ? "failed" : "done"}
          onOpen={opener(item.path)}
        >
          {item.diff ? <Diff lines={item.diff} /> : <Pre text={item.input} />}
          {result && (
            <Pre
              text={result.text || "(no output)"}
              className={result.isError ? "text-danger" : undefined}
            />
          )}
        </ToolCallRow>
      );
    }
    case "Subagent": {
      const { agentId } = item;
      return (
        <SubagentRow
          agentType={item.agentType}
          description={item.description}
          status={item.status}
          onOpen={
            agentId !== undefined && onOpenSubagent
              ? () => onOpenSubagent(agentId)
              : undefined
          }
        />
      );
    }
    case "HandBack": {
      const { agentId } = item;
      return (
        <HandBackRow
          agentType={item.agentType}
          text={item.text}
          onOpen={onOpenSubagent && (() => onOpenSubagent(agentId))}
        />
      );
    }
    case "Interrupt":
      return <Chip className="text-amber">Interrupted</Chip>;
    case "Notice":
      return <Chip className="text-muted">{item.text}</Chip>;
    default:
      return null;
  }
}
