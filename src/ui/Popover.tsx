import { Popover as P } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({ className, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          "z-50 animate-float-in rounded-menu bg-elevated p-3 text-fg shadow-float outline-none",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
