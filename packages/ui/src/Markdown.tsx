import { code } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import { ImageLeftOut } from "./ImageLeftOut";

const plugins = { code, mermaid };

// Inline code is set in Geist Pixel on a translucent white chip.
const inlineCode =
  "[&_[data-streamdown=inline-code]]:bg-white/10 [&_[data-streamdown=inline-code]]:text-ink [&_[data-streamdown=inline-code]]:font-pixel";

const withoutImages = { img: ImageLeftOut };

// Markdown, with its images unless `images` is false, as for text written from someone else's
// words, where loading one would tell its server who read it.
export function Markdown({
  children,
  images = true,
}: {
  children: string;
  images?: boolean;
}) {
  return (
    <div className={`my-4 text-[15px] leading-7 text-ink/90 ${inlineCode}`}>
      <Streamdown
        plugins={plugins}
        shikiTheme={["github-dark", "github-dark"]}
        components={images ? undefined : withoutImages}
      >
        {children}
      </Streamdown>
    </div>
  );
}
