// The command palette (Mod+K): every registered action, fuzzy-searched, with its shortcut.
// While searching it also offers per-item actions (switch to a branch, open a recent repo).

import { CornerDownLeft, Search } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { allActions, useActionRegistry, type Action, type ActionGroup } from "@/app/actions";
import { effectiveShortcut } from "@/app/keyboard";
import { useOverlays } from "@/app/overlays";
import { useSettings } from "@/app/settings";
import { t } from "@/i18n";
import { cn } from "@/ui/cn";
import { Kbd } from "@/ui/Kbd";

import { fuzzyMatch } from "./fuzzy";

/** Results shown at most (searching narrows them anyway). */
const MAX_RESULTS = 60;
/** Recently run action ids, newest first, shown first with an empty query. */
const recent: string[] = [];
const MAX_RECENT = 5;

const GROUP_ORDER: ActionGroup[] = [
  "repository",
  "remote",
  "branch",
  "changes",
  "history",
  "file",
  "view",
  "tabs",
  "app",
];

interface Result {
  action: Action;
  indices: number[];
  score: number;
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-accent">
            {ch}
          </span>
        ) : (
          ch
        ),
      )}
    </>
  );
}

function search(actions: Action[], query: string): Result[] {
  if (!query.trim()) {
    const listed = actions.filter((a) => !a.hidden && !a.searchOnly);
    const rank = (a: Action) => {
      const r = recent.indexOf(a.id);
      return r >= 0 ? r : MAX_RECENT + GROUP_ORDER.indexOf(a.group);
    };
    return listed
      .map((action, i) => ({ action, indices: [], score: -rank(action) * 1000 - i }))
      .sort((a, b) => b.score - a.score);
  }
  const results: Result[] = [];
  for (const action of actions) {
    if (action.hidden) continue;
    const title = fuzzyMatch(query, action.title);
    const keyword = (action.keywords ?? [])
      .map((k) => fuzzyMatch(query, k))
      .reduce<number>((best, m) => Math.max(best, m ? m.score - 10 : -Infinity), -Infinity);
    const score = Math.max(title?.score ?? -Infinity, keyword);
    if (score === -Infinity) continue;
    // Disabled actions sink below runnable ones.
    results.push({
      action,
      indices: title?.indices ?? [],
      score: score - (action.disabled ? 200 : 0),
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}

export function CommandPalette() {
  const open = useOverlays((s) => s.palette);
  const setOpen = useOverlays((s) => s.setPalette);
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[14vh] left-1/2 z-50 flex max-h-[70vh] w-160 max-w-[calc(100vw-32px)] -translate-x-1/2 animate-dialog-in flex-col overflow-hidden rounded-dialog bg-elevated text-fg shadow-float outline-none"
        >
          <D.Title className="sr-only">{t("palette.title")}</D.Title>
          {open && <PaletteBody onClose={() => setOpen(false)} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const sources = useActionRegistry((s) => s.sources);
  const bindings = useSettings((s) => s.settings.shortcuts);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => search(allActions(sources), query), [sources, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  const runResult = (r: Result | undefined) => {
    if (!r || r.action.disabled) return;
    onClose();
    recent.splice(0, recent.length, r.action.id, ...recent.filter((id) => id !== r.action.id));
    recent.length = Math.min(recent.length, MAX_RECENT);
    // After the dialog has closed and returned focus, so the action's own focus wins.
    requestAnimationFrame(() => r.action.run());
  };

  const move = (to: number) => {
    const next = Math.max(0, Math.min(results.length - 1, to));
    setActive(next);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") move(current + 1);
    else if (e.key === "ArrowUp") move(current - 1);
    else if (e.key === "PageDown") move(current + 8);
    else if (e.key === "PageUp") move(current - 8);
    else if (e.key === "Enter") runResult(results[current]);
    else return;
    e.preventDefault();
  };

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line-subtle px-4">
        <Search size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-fg-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.placeholder")}
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={results[current] ? `palette-${current}` : undefined}
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-title text-fg outline-none placeholder:text-fg-muted"
        />
      </div>
      <div
        ref={listRef}
        id="palette-results"
        role="listbox"
        aria-label={t("palette.title")}
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {results.length === 0 && (
          <p className="px-3 py-6 text-center text-fg-muted">{t("palette.none")}</p>
        )}
        {results.map((r, i) => {
          const Icon = r.action.icon;
          const shortcut = effectiveShortcut(r.action, bindings);
          return (
            <div
              key={r.action.id}
              id={`palette-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === current}
              aria-disabled={r.action.disabled || undefined}
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => runResult(r)}
              className={cn(
                "flex h-9 cursor-default items-center gap-3 rounded-control px-3",
                i === current && "bg-selected [&_kbd>span]:text-fg",
                r.action.disabled && "opacity-50",
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">
                {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 truncate text-fg">
                <Highlighted text={r.action.title} indices={r.indices} />
              </span>
              <span
                className={cn(
                  "shrink-0 text-small",
                  i === current ? "text-fg-secondary" : "text-fg-muted",
                )}
              >
                {t(`palette.group.${r.action.group}`)}
              </span>
              {shortcut && <Kbd shortcut={shortcut} />}
            </div>
          );
        })}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-4 border-t border-line-subtle bg-panel px-4 text-small text-fg-muted">
        <span className="flex items-center gap-1.5">
          <CornerDownLeft size={12} strokeWidth={2} aria-hidden />
          {t("palette.run")}
        </span>
        <span>{t("palette.navigate")}</span>
        <span className="flex-1" />
        <span>{t("palette.hint")}</span>
      </div>
    </>
  );
}
