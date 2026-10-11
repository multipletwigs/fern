import { clsx } from "clsx";
import type { ReactNode } from "react";
import { ImageThumb } from "./ImageThumb";

// A developer's turn in the transcript, raised like the composer it was typed into, with a bezel
// that fades toward the bottom. Any images they sent sit above the text.
export function MessageCard({
  images = [],
  children,
}: {
  images?: ReadonlyArray<string>;
  children: ReactNode;
}) {
  return (
    <div className="relative mt-10 mb-6 rounded-2xl bg-white/[0.06] px-5 py-4 text-[15px] leading-7 whitespace-pre-wrap shadow-[0_1px_2px_rgb(0_0_0/0.5),0_10px_30px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.06)] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-linear-to-b before:from-white/12 before:to-white/0 before:p-px before:[mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]">
      {images.length > 0 && (
        <div className={clsx("flex flex-wrap gap-2", children && "mb-3")}>
          {images.map((url, index) => (
            <ImageThumb key={index} url={url} />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
