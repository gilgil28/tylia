// Dropdown menu and context menu with identical styling. Both expose the same parts:
// Root, Trigger, Content, Item, CheckboxItem, RadioGroup, RadioItem, Label, Separator,
// Sub, SubTrigger, SubContent.

import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";
import { Kbd } from "./Kbd";

const content =
  "z-50 min-w-48 animate-float-in rounded-menu bg-elevated p-1 text-fg shadow-float outline-none";
const item =
  "relative flex h-7 cursor-default items-center gap-2 rounded-control px-2 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover";
const danger =
  "text-danger data-[highlighted]:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]";

interface ItemExtras {
  icon?: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  children: ReactNode;
}

function ItemBody({ icon: Icon, shortcut, children }: Omit<ItemExtras, "danger">) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center opacity-80">
        {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}
      </span>
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <Kbd shortcut={shortcut} className="ml-4" />}
    </>
  );
}

function makeMenu(P: typeof DM | typeof CM) {
  // The two Radix menus share part names and props, so one set of wrappers serves both.
  const Parts = P as typeof DM;
  return {
    Root: Parts.Root,
    Trigger: Parts.Trigger,
    RadioGroup: Parts.RadioGroup,
    Sub: Parts.Sub,

    Content({ className, ...props }: ComponentProps<typeof DM.Content>) {
      return (
        <Parts.Portal>
          <Parts.Content
            sideOffset={4}
            collisionPadding={8}
            className={cn(content, className)}
            {...props}
          />
        </Parts.Portal>
      );
    },

    Item({
      icon,
      shortcut,
      danger: isDanger,
      children,
      className,
      ...props
    }: ItemExtras & Omit<ComponentProps<typeof DM.Item>, "children">) {
      return (
        <Parts.Item className={cn(item, isDanger && danger, className)} {...props}>
          <ItemBody icon={icon} shortcut={shortcut}>
            {children}
          </ItemBody>
        </Parts.Item>
      );
    },

    CheckboxItem({
      children,
      className,
      ...props
    }: { children: ReactNode } & Omit<ComponentProps<typeof DM.CheckboxItem>, "children">) {
      return (
        <Parts.CheckboxItem className={cn(item, className)} {...props}>
          <span className="size-4 shrink-0" />
          <span className="flex-1 truncate">{children}</span>
          <Parts.ItemIndicator className="text-accent">
            <Check size={14} strokeWidth={2} aria-hidden />
          </Parts.ItemIndicator>
        </Parts.CheckboxItem>
      );
    },

    RadioItem({
      icon: Icon,
      children,
      className,
      ...props
    }: { icon?: LucideIcon; children: ReactNode } & Omit<
      ComponentProps<typeof DM.RadioItem>,
      "children"
    >) {
      return (
        <Parts.RadioItem className={cn(item, className)} {...props}>
          <span className="flex size-4 shrink-0 items-center justify-center opacity-80">
            {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}
          </span>
          <span className="flex-1 truncate">{children}</span>
          <Parts.ItemIndicator className="text-accent">
            <Check size={14} strokeWidth={2} aria-hidden />
          </Parts.ItemIndicator>
        </Parts.RadioItem>
      );
    },

    Label({ className, ...props }: ComponentProps<typeof DM.Label>) {
      return (
        <Parts.Label
          className={cn("px-2 pt-2 pb-1 text-caption font-medium text-fg-muted", className)}
          {...props}
        />
      );
    },

    Separator({ className, ...props }: ComponentProps<typeof DM.Separator>) {
      return (
        <Parts.Separator className={cn("-mx-1 my-1 h-px bg-line-subtle", className)} {...props} />
      );
    },

    SubTrigger({
      icon,
      children,
      className,
      ...props
    }: { icon?: LucideIcon; children: ReactNode } & Omit<
      ComponentProps<typeof DM.SubTrigger>,
      "children"
    >) {
      return (
        <Parts.SubTrigger className={cn(item, "data-[state=open]:bg-hover", className)} {...props}>
          <ItemBody icon={icon}>{children}</ItemBody>
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="text-fg-muted" />
        </Parts.SubTrigger>
      );
    },

    SubContent({ className, ...props }: ComponentProps<typeof DM.SubContent>) {
      return (
        <Parts.Portal>
          <Parts.SubContent
            sideOffset={4}
            collisionPadding={8}
            className={cn(content, className)}
            {...props}
          />
        </Parts.Portal>
      );
    },
  };
}

export const Menu = makeMenu(DM);
export const ContextMenu = makeMenu(CM);
