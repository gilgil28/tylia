// The details pane while several commits are selected: how many, by whom, over what span of
// time, and every file they change. What to do with them is in their context menu.

import { useQueries } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";

import { absoluteTime } from "@/app/format";
import { plural, t } from "@/i18n";
import { ipc, type CommitDetails } from "@/ipc";
import { Skeleton } from "@/ui/Skeleton";

/** Details are read for this many commits at most; beyond it only the count is shown. */
const MAX_DETAILED = 100;

export function SeveralCommits({ repo, oids }: { repo: string; oids: string[] }) {
  const detailed = oids.slice(0, MAX_DETAILED);
  const commits = useQueries({
    queries: detailed.map((oid) => ({
      queryKey: ["commit", repo, oid],
      queryFn: () => ipc.getCommit(repo, oid),
      staleTime: Infinity,
    })),
  });
  const loaded = commits.map((q) => q.data).filter((c): c is CommitDetails => !!c);
  const pending = loaded.length < detailed.length;

  const authors = new Map<string, number>();
  const files = new Set<string>();
  let oldest = Infinity;
  let newest = -Infinity;
  for (const c of loaded) {
    authors.set(c.author.name, (authors.get(c.author.name) ?? 0) + 1);
    for (const f of c.files) files.add(f.path);
    oldest = Math.min(oldest, c.author.time);
    newest = Math.max(newest, c.author.time);
  }
  const byCount = [...authors].sort((a, b) => b[1] - a[1]);
  const fileList = [...files].sort();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-app p-4">
      <h2 className="flex items-center gap-2 text-title font-semibold text-fg">
        <ListChecks size={18} className="text-fg-secondary" aria-hidden />
        {t("details.severalTitle", { commits: plural("count.commits", oids.length) })}
      </h2>
      <p className="text-small text-fg-muted">{t("details.severalHint")}</p>
      {pending && loaded.length === 0 ? (
        <Skeleton className="h-16" />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
          <dt className="text-fg-secondary">{t("details.severalAuthors")}</dt>
          <dd className="text-fg" data-selectable>
            {byCount.map(([name, count]) => `${name} (${count})`).join(", ")}
          </dd>
          <dt className="text-fg-secondary">{t("details.severalSpan")}</dt>
          <dd className="text-fg">
            {oldest === newest
              ? absoluteTime(oldest)
              : `${absoluteTime(oldest)} – ${absoluteTime(newest)}`}
          </dd>
        </dl>
      )}
      {oids.length > MAX_DETAILED && (
        <p className="text-small text-fg-muted">
          {t("details.severalPartial", { count: String(MAX_DETAILED) })}
        </p>
      )}
      <section className="flex min-h-0 flex-col gap-1">
        <h3 className="text-small font-semibold text-fg-secondary">
          {plural("count.files", fileList.length)}
        </h3>
        <ul
          className="flex min-h-0 flex-col overflow-auto rounded-menu border border-line-subtle bg-panel py-1"
          data-selectable
        >
          {fileList.map((path) => (
            <li
              key={path}
              className="truncate px-3 py-0.5 font-code text-small text-fg"
              title={path}
            >
              {path}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
