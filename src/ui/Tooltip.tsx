import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

import { Kbd } from "./Kbd";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={500} skipDelayDuration={300}>
    {children}
  </T.Provider>
);

interface TooltipProps {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}

export function Tooltip({ content, shortcut, side = "bottom", children }: TooltipProps) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex animate-fade-in items-center gap-2 rounded-menu bg-elevated px-2 py-1 text-small text-fg shadow-float"
        >
          {content}
          {shortcut && <Kbd shortcut={shortcut} />}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
