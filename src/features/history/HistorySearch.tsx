// The history search box: a field picker (message, author, hash, path), `path:` / `author:` /
// `message:` / `hash:` prefixes, and, for paths, suggestions from every file and folder the
// history has had, with this repository's recent path searches first.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, FileText, Folder, History, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { useDebounced } from "@/app/useDebounced";
import { useWorkspace } from "@/app/workspace";
import { useRepoUi } from "@/features/repo/repo-store";
import { t } from "@/i18n";
import { ipc, type PathSuggestion, type SearchField } from "@/ipc";
import { Badge } from "@/ui/Badge";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { Kbd } from "@/ui/Kbd";
import { Menu } from "@/ui/Menu";
import { ProgressRing } from "@/ui/ProgressRing";

const FIELDS: { value: SearchField; label: string; placeholder: string }[] = [
  { value: "message", label: t("search.message"), placeholder: t("search.placeholder.message") },
  { value: "author", label: t("search.author"), placeholder: t("search.placeholder.author") },
  { value: "hash", label: t("search.hash"), placeholder: t("search.placeholder.hash") },
  { value: "path", label: t("search.path"), placeholder: t("search.placeholder.path") },
];

/** Typing one of these switches the field ("path:build.gradle"). */
const PREFIXES: Record<string, SearchField> = {
  path: "path",
  file: "path",
  author: "author",
  message: "message",
  msg: "message",
  hash: "hash",
  sha: "hash",
};

const MAX_RECENT = 8;
const MAX_SUGGESTIONS = 12;

type Item = { recent: true; path: string } | ({ recent: false } & PathSuggestion);

/** `text` with the first case-insensitive occurrence of `query` emphasised. */
function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold text-fg">{text.slice(i, i + query.length)}</span>
      {text.slice(i + query.length)}
    </>
  );
}

function splitPath(path: string): { name: string; dir: string } {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const i = trimmed.lastIndexOf("/");
  return {
    name: trimmed.slice(i + 1) + (path.endsWith("/") ? "/" : ""),
    dir: trimmed.slice(0, i + 1),
  };
}

export function HistorySearch({ repo, recentPaths }: { repo: string; recentPaths: string[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusRequest = useRepoUi((s) => s.focusRequest);
  const focusHandled = useRepoUi((s) => s.focusHandled);
  // Mod+F (from any view) focuses the box once the history has rendered it.
  useEffect(() => {
    if (focusRequest !== "search") return;
    inputRef.current?.focus();
    inputRef.current?.select();
    focusHandled();
  }, [focusRequest, focusHandled]);
  const search = useRepoUi((s) => s.search);
  const setSearch = useRepoUi((s) => s.setSearch);
  const updateLayout = useWorkspace((s) => s.updateLayout);
  const field = FIELDS.find((f) => f.value === search.field) ?? FIELDS[0]!;
  const pathMode = search.field === "path";
  const listId = useId();
  const [focused, setFocused] = useState(false);
  // Escape or a pick closes the list until the next keystroke.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);

  const query = search.query.trim();
  const debounced = useDebounced(query, 120);
  const suggestions = useQuery({
    queryKey: ["path-suggestions", repo, debounced],
    queryFn: () => ipc.pathSuggestions(repo, debounced, MAX_SUGGESTIONS),
    enabled: pathMode && focused && debounced !== "",
    placeholderData: keepPreviousData,
    // While the history is being indexed, ask again for the complete list.
    refetchInterval: (q) => (q.state.data?.indexing ? 1000 : false),
    staleTime: 5_000,
    retry: false,
  });

  const lower = query.toLowerCase();
  const recents = recentPaths
    .filter((p) => p.toLowerCase().includes(lower) && p !== query)
    .slice(0, 5);
  const items: Item[] = [
    ...recents.map((path): Item => ({ recent: true, path })),
    ...(query && suggestions.data ? suggestions.data.items : [])
      .filter((s) => !recents.includes(s.path) && s.path !== query)
      .map((s): Item => ({ recent: false, ...s })),
  ];
  const indexing = !!query && !!suggestions.data?.indexing;
  const open = pathMode && focused && !dismissed && (items.length > 0 || indexing);
  const activeItem = open && active >= 0 ? items[active] : undefined;

  const remember = (path: string) => {
    if (!path) return;
    updateLayout(repo, {
      recentPaths: [path, ...recentPaths.filter((p) => p !== path)].slice(0, MAX_RECENT),
    });
  };
  const pick = (path: string) => {
    setSearch({ query: path });
    remember(path);
    setDismissed(true);
    setActive(-1);
  };

  const onChange = (value: string) => {
    const prefix = /^(\w+):\s*/.exec(value);
    const prefixField = prefix ? PREFIXES[prefix[1]!.toLowerCase()] : undefined;
    if (prefix && prefixField) {
      setSearch({ field: prefixField, query: value.slice(prefix[0].length) });
    } else {
      setSearch({ query: value });
    }
    setDismissed(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && items.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = items.length;
      setActive((a) =>
        e.key === "ArrowDown" ? (a < 0 ? 0 : (a + 1) % n) : a <= 0 ? n - 1 : a - 1,
      );
      return;
    }
    if (e.key === "Enter") {
      if (activeItem) {
        e.preventDefault();
        pick(activeItem.path);
      } else if (pathMode) {
        remember(query);
        setDismissed(true);
      }
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        setActive(-1);
      } else {
        setSearch({ query: "" });
      }
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div
      className={cn(
        "relative flex h-7 w-full max-w-120 min-w-0 items-center rounded-control border border-line bg-input transition-[border-color,box-shadow] duration-(--dur-fast)",
        "focus-within:border-line-strong focus-within:shadow-(--focus-ring) hover:border-line-strong",
      )}
    >
      <Menu.Root>
        <Menu.Trigger
          aria-label={`${t("search.by")}: ${field.label}`}
          className="flex h-full shrink-0 items-center gap-1 rounded-l-control border-r border-line-subtle pr-1.5 pl-2 text-small text-fg-secondary outline-none hover:text-fg focus-visible:text-fg"
        >
          <Search size={14} strokeWidth={1.75} aria-hidden />
          <span className="@max-[32rem]:sr-only">{field.label}</span>
          <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </Menu.Trigger>
        <Menu.Content align="start">
          <Menu.Label>{t("search.by")}</Menu.Label>
          <Menu.RadioGroup
            value={search.field}
            onValueChange={(v) => {
              setSearch({ field: v as SearchField });
              inputRef.current?.focus();
            }}
          >
            {FIELDS.map((f) => (
              <Menu.RadioItem key={f.value} value={f.value}>
                {f.label}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Root>
      <input
        ref={inputRef}
        value={search.query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setActive(-1);
        }}
        placeholder={field.placeholder}
        aria-label={t("search.label")}
        spellCheck={false}
        {...(pathMode && {
          role: "combobox",
          "aria-autocomplete": "list" as const,
          "aria-expanded": open,
          "aria-controls": listId,
          "aria-activedescendant": activeItem ? optionId(active) : undefined,
        })}
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-fg outline-none placeholder:text-fg-muted"
      />
      {search.query ? (
        <IconButton
          icon={X}
          label={t("search.clear")}
          compact
          className="mr-0.5"
          onClick={() => setSearch({ query: "" })}
        />
      ) : (
        <Kbd shortcut="Mod+F" className="mr-1.5 @max-[32rem]:hidden" />
      )}
      {open && (
        <div
          className="absolute top-full left-0 z-50 mt-1 flex w-[min(30rem,calc(100vw-32px))] animate-float-in flex-col rounded-menu bg-elevated p-1 text-fg shadow-float"
          // Keep focus in the input while choosing with the mouse.
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            id={listId}
            role="listbox"
            aria-label={t("search.suggestions")}
            className="flex flex-col"
          >
            {(["recent", "files"] as const).map((section) => {
              const entries = items
                .map((item, i) => ({ item, i }))
                .filter(({ item }) => item.recent === (section === "recent"));
              if (entries.length === 0) return null;
              const labelId = `${listId}-${section}`;
              return (
                <div key={section} role="group" aria-labelledby={labelId} className="flex flex-col">
                  <span
                    id={labelId}
                    className="px-2 pt-1.5 pb-1 text-caption font-medium text-fg-muted"
                  >
                    {section === "recent" ? t("search.recent") : t("search.files")}
                  </span>
                  {entries.map(({ item, i }) => {
                    const { name, dir } = splitPath(item.path);
                    const Icon = item.recent ? History : item.kind === "dir" ? Folder : FileText;
                    return (
                      <div
                        key={item.path}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => pick(item.path)}
                        className={cn(
                          "flex h-8 cursor-default items-center gap-2 rounded-control px-2",
                          i === active && "bg-hover",
                        )}
                      >
                        <Icon
                          size={14}
                          strokeWidth={1.75}
                          aria-hidden
                          className="shrink-0 text-fg-muted"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-fg-secondary">
                            <Highlight text={name} query={query} />
                          </span>
                          {dir && (
                            <span className="ml-2 text-small text-fg-muted">
                              <Highlight text={dir} query={query.includes("/") ? query : ""} />
                            </span>
                          )}
                        </span>
                        {!item.recent && item.deleted && (
                          <span title={t("search.historyOnlyHint")} className="shrink-0">
                            <Badge>{t("search.historyOnly")}</Badge>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {indexing && (
            <p
              className="flex items-center gap-2 px-2 py-1.5 text-small text-fg-muted"
              role="status"
            >
              <ProgressRing size={12} />
              {t("search.indexing")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
