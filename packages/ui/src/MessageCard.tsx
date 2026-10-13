import { clsx } from "clsx";
import type { ReactNode } from "react";
import { ImageThumb } from "./ImageThumb";

// A developer's turn in the transcript, marked by a thick white rule down its left edge. Any images
// they sent sit above the text, and anything to say about the message itself, such as it going
// unanswered, below.
export function MessageCard({
  images = [],
  children,
  footer,
}: {
  images?: ReadonlyArray<string>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mt-10 mb-6 border-l-3 border-white py-1 pl-4 text-[15px] leading-7 whitespace-pre-wrap">
      {images.length > 0 && (
        <div className={clsx("flex flex-wrap gap-2", children && "mb-3")}>
          {images.map((url, index) => (
            <ImageThumb key={index} url={url} />
          ))}
        </div>
      )}
      {children}
      {footer}
    </div>
  );
}
