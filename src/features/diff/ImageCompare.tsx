import { useState } from "react";

import { t, type MessageKey } from "@/i18n";
import type { ImagePair } from "@/ipc/bindings/ImagePair";
import { cn } from "@/ui/cn";

/** Transparent areas show a checkerboard in the theme's neutral tones. */
const CHECKERBOARD =
  "bg-[conic-gradient(var(--bg-active)_25%,transparent_0_50%,var(--bg-active)_0_75%,transparent_0)] [background-size:16px_16px]";

const LABEL_COLOR: Partial<Record<MessageKey, string>> = {
  "diff.imageAdded": "text-success",
  "diff.imageDeleted": "text-danger",
};

/** Old and new image side by side, or the one that exists when a file was added or deleted. */
export function ImageCompare({ image, className }: { image: ImagePair; className?: string }) {
  const panes: [MessageKey, string][] = [];
  if (image.old && image.new) {
    panes.push(["diff.imageBefore", image.old], ["diff.imageAfter", image.new]);
  } else if (image.new) panes.push(["diff.imageAdded", image.new]);
  else if (image.old) panes.push(["diff.imageDeleted", image.old]);

  return (
    <div className={cn("flex min-h-0 gap-3 p-3", className)}>
      {panes.map(([label, src]) => (
        <ImagePane key={label} label={label} src={src} />
      ))}
    </div>
  );
}

function ImagePane({ label, src }: { label: MessageKey; src: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // Vector images scale to fit; bitmaps only shrink, so small ones stay sharp.
  const vector = src.startsWith("data:image/svg");
  return (
    <figure className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col gap-1.5">
      <figcaption className="flex items-baseline gap-2 text-small">
        <span className={cn("font-medium", LABEL_COLOR[label] ?? "text-fg-secondary")}>
          {t(label)}
        </span>
        {size && (
          <span className="text-fg-muted tabular-nums">
            {t("diff.imageSize", { width: size.width, height: size.height })}
          </span>
        )}
      </figcaption>
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-control border border-line-subtle p-3",
          CHECKERBOARD,
        )}
      >
        <img
          src={src}
          alt={t(label)}
          draggable={false}
          onLoad={(e) =>
            setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
          }
          className={cn("max-h-full max-w-full object-contain", vector && "size-full")}
        />
      </div>
    </figure>
  );
}
