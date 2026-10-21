import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

import { lastInputWasKeyboard } from "./inputModality";
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
      <T.Trigger
        asChild
        // Open on focus only when the keyboard moved it. A menu or dialog closed with the
        // mouse hands focus back to its button, which must not bring up a tooltip that stays.
        onFocus={(e) => {
          if (!lastInputWasKeyboard()) e.preventDefault();
        }}
      >
        {children}
      </T.Trigger>
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
