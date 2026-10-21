import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

import { cn } from "./cn";
import { fieldBase } from "./Input";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with its content up to this height (px), then scrolls. */
  maxHeight?: number;
}

/** Auto-growing multi-line input. */
export function Textarea({ maxHeight = 240, rows = 3, className, ...props }: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight + 2 > maxHeight ? "auto" : "hidden";
  }, [props.value, maxHeight]);

  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(fieldBase, "resize-none px-2 py-1.5 leading-[1.45]", className)}
      {...props}
    />
  );
}
