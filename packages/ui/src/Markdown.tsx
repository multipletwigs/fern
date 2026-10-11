import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";

const plugins = { code, mermaid };

export function Markdown({ children }: { children: string }) {
  return (
    <div className="my-4 text-[15px] leading-7 text-ink/90">
      <Streamdown plugins={plugins} shikiTheme={["github-dark", "github-dark"]}>
        {children}
      </Streamdown>
    </div>
  );
}
