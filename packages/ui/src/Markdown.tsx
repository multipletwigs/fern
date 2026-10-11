import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";

const plugins = { code, mermaid };

// Inline code is set in Geist Pixel on a translucent white chip.
const inlineCode =
  "[&_[data-streamdown=inline-code]]:bg-white/10 [&_[data-streamdown=inline-code]]:text-ink [&_[data-streamdown=inline-code]]:font-pixel";

export function Markdown({ children }: { children: string }) {
  return (
    <div className={`my-4 text-[15px] leading-7 text-ink/90 ${inlineCode}`}>
      <Streamdown plugins={plugins} shikiTheme={["github-dark", "github-dark"]}>
        {children}
      </Streamdown>
    </div>
  );
}
