// Custom actions in commit, branch and file menus, and in the palette.

import { SquareChevronRight } from "lucide-react";

import type { Action, ActionGroup } from "@/app/actions";
import { useSettings } from "@/app/settings";
import { t } from "@/i18n";
import type { ActionContext, ActionScope, CustomAction } from "@/ipc";
import type { ContextMenu, Menu } from "@/ui/Menu";

import { startCustomAction } from "./run";

/** The actions shown for `scope`, in Settings order (unnamed ones are left out). */
export function useCustomActions(scope: ActionScope): CustomAction[] {
  const actions = useSettings((s) => s.settings.customActions);
  return actions.filter((a) => a.scope === scope && a.name.trim() !== "");
}

/** Menu items for the actions of `scope`, after a separator; nothing when there are none. */
export function CustomActionItems({
  M,
  scope,
  context,
}: {
  M: typeof Menu | typeof ContextMenu;
  scope: ActionScope;
  context: ActionContext;
}) {
  const actions = useCustomActions(scope);
  if (actions.length === 0) return null;
  return (
    <>
      <M.Separator />
      {actions.map((action) => (
        <M.Item
          key={action.id}
          icon={SquareChevronRight}
          onSelect={() => void startCustomAction(action, context)}
        >
          {action.name}
        </M.Item>
      ))}
    </>
  );
}

const GROUPS: Record<ActionScope, ActionGroup> = {
  repository: "repository",
  commit: "history",
  branch: "branch",
  file: "file",
};

/** Palette entries for every custom action; `context` is null where its scope has no target. */
export function customPaletteActions(
  actions: CustomAction[],
  context: (scope: ActionScope) => ActionContext | null,
): Action[] {
  return actions
    .filter((a) => a.name.trim() !== "")
    .map((action) => {
      const ctx = context(action.scope);
      return {
        id: `custom.${action.id}`,
        title: action.name,
        group: GROUPS[action.scope],
        icon: SquareChevronRight,
        keywords: [t("customActions.keyword"), action.program],
        disabled: ctx === null,
        run: () => {
          if (ctx) void startCustomAction(action, ctx);
        },
      };
    });
}
