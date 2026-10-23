import { History } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { shortHash } from "@/app/format";
import { useSettings } from "@/app/settings";
import { isMod } from "@/app/keyboard";
import { useWorkspace } from "@/app/workspace";
import { pushRepo } from "@/features/remote/operations";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import { ipc } from "@/ipc";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { useUndo } from "@/features/undo/undo";
import { Kbd } from "@/ui/Kbd";
import { Menu } from "@/ui/Menu";
import { Textarea } from "@/ui/Textarea";
import { toast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";

import { useRepoAction } from "./useRepoAction";

/** Title-line guidance (DESIGN: 50/72). */
const TITLE_SOFT = 50;
const TITLE_HARD = 72;

/** One message box (its first line is the commit title), amend, push after commit, recent
 * messages, Commit (Mod+Enter). */
export function CommitComposer({ repo, stagedCount }: { repo: string; stagedCount: number }) {
  const draft = useRepoUi((s) => s.draft);
  const setDraft = useRepoUi((s) => s.setDraft);
  const focusRequest = useRepoUi((s) => s.focusRequest);
  const focusHandled = useRepoUi((s) => s.focusHandled);
  const rootRef = useRef<HTMLDivElement>(null);
  // The toolbar's Commit button lands here.
  useEffect(() => {
    if (focusRequest !== "composer") return;
    rootRef.current?.querySelector("textarea")?.focus();
    focusHandled();
  }, [focusRequest, focusHandled]);
  const recent = useWorkspace((s) => s.recentMessages[repo]) ?? [];
  const addRecentMessage = useWorkspace((s) => s.addRecentMessage);
  const run = useRepoAction(repo);
  const undo = useUndo(repo);
  const pushAfterCommit = useSettings((s) => s.settings.pushAfterCommit);
  const updateSettings = useSettings((s) => s.update);
  const [busy, setBusy] = useState(false);
  // The message from before "amend" filled in the last commit's, to restore when unticked.
  const [beforeAmend, setBeforeAmend] = useState<string | null>(null);

  const message = draft.message.trim();
  const titleLength = message.split("\n")[0]!.trim().length;
  const canCommit = message.length > 0 && (stagedCount > 0 || draft.amend) && !busy;

  const setAmend = async (amend: boolean) => {
    if (amend) {
      setBeforeAmend(draft.message);
      const last = message ? null : await ipc.headMessage(repo).catch(() => null);
      setDraft({ amend: true, ...(last ? { message: last } : {}) });
    } else {
      setDraft({ amend: false, ...(beforeAmend !== null ? { message: beforeAmend } : {}) });
      setBeforeAmend(null);
    }
  };

  const commit = async () => {
    if (!canCommit) return;
    setBusy(true);
    const oid = await run(() => ipc.commit(repo, message, draft.amend), t("composer.failed"), {
      refs: true,
    });
    setBusy(false);
    if (oid) {
      toast({
        kind: "success",
        title: t("composer.committed", { hash: shortHash(oid) }),
        action: undo.toastAction,
      });
      addRecentMessage(repo, message);
      setDraft({ message: "", amend: false });
      setBeforeAmend(null);
      if (pushAfterCommit) void pushRepo(repo);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isMod(e) && e.key === "Enter") {
      e.preventDefault();
      void commit();
    }
  };

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className="flex shrink-0 flex-col gap-2 border-t border-line bg-panel px-3 py-3"
    >
      <div className="relative">
        <Textarea
          value={draft.message}
          onChange={(e) => setDraft({ message: e.target.value })}
          placeholder={t("composer.messagePlaceholder")}
          aria-label={t("composer.message")}
          rows={3}
          maxHeight={200}
          className="w-full pr-10"
        />
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton
              icon={History}
              label={t("composer.recent")}
              compact
              className="absolute top-1 right-1"
            />
          </Menu.Trigger>
          <Menu.Content align="end" className="max-w-112">
            <Menu.Label>{t("composer.recent")}</Menu.Label>
            {recent.length === 0 ? (
              <Menu.Item disabled>{t("composer.noRecent")}</Menu.Item>
            ) : (
              recent.map((m) => (
                <Menu.Item key={m} onSelect={() => setDraft({ message: m })}>
                  {m.split("\n")[0]}
                </Menu.Item>
              ))
            )}
          </Menu.Content>
        </Menu.Root>
      </div>
      <div className="flex items-center gap-3">
        <Tooltip content={t("composer.amendHint")}>
          <span>
            <Checkbox
              checked={draft.amend}
              onCheckedChange={(v) => void setAmend(v)}
              label={t("composer.amend")}
            />
          </span>
        </Tooltip>
        <Tooltip content={t("composer.pushAfterCommitHint")}>
          <span>
            <Checkbox
              checked={pushAfterCommit}
              onCheckedChange={(v) => updateSettings({ pushAfterCommit: v })}
              label={t("composer.pushAfterCommit")}
            />
          </span>
        </Tooltip>
        <span className="flex-1" />
        {titleLength > 0 && (
          <Tooltip content={t("composer.titleHint")}>
            <span
              className={cn(
                "text-small tabular-nums",
                titleLength > TITLE_HARD
                  ? "text-danger"
                  : titleLength > TITLE_SOFT
                    ? "text-warning"
                    : "text-fg-muted",
              )}
            >
              {t("composer.titleCount", { count: titleLength })}
            </span>
          </Tooltip>
        )}
        <Button
          variant="primary"
          size="lg"
          disabled={!canCommit}
          loading={busy}
          onClick={() => void commit()}
        >
          {draft.amend ? t("composer.amendCommit") : t("composer.commit")}
          <Kbd
            shortcut="Mod+Enter"
            className="ml-1 opacity-80 [&>span]:border-transparent [&>span]:bg-[color-mix(in_srgb,var(--accent-text)_18%,transparent)] [&>span]:text-on-accent"
          />
        </Button>
      </div>
    </div>
  );
}
