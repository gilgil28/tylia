// Development page showing every design-system component (docs/DESIGN.md §4.9), in the
// current theme. Not routed in release builds; sample content is not localized.

import {
  ArrowDown,
  ArrowLeft,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
  Inbox,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { themeOptions } from "@/app/AppearanceMenu";
import { useSettings } from "@/app/settings";
import { DiffSection } from "@/features/diff/DiffGallerySection";

import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Checkbox } from "../Checkbox";
import { ConfirmDialog } from "../ConfirmDialog";
import { Dialog } from "../Dialog";
import { EmptyState } from "../EmptyState";
import { ErrorPanel } from "../ErrorPanel";
import { IconButton } from "../IconButton";
import { Input } from "../Input";
import { Kbd } from "../Kbd";
import { ContextMenu, Menu } from "../Menu";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";
import { ProgressRing } from "../ProgressRing";
import { RefBadge, RefBadgeList } from "../RefBadge";
import { RepoTab } from "../RepoTab";
import { SegmentedControl } from "../SegmentedControl";
import { SkeletonRows } from "../Skeleton";
import { SplitButton } from "../SplitButton";
import { SplitPane } from "../SplitPane";
import { Switch } from "../Switch";
import { Textarea } from "../Textarea";
import { toast } from "../Toast";
import { Tooltip } from "../Tooltip";
import { Tree } from "../Tree";
import { VirtualList } from "../VirtualList";
import { branches, commits, manyRefs, sampleError, type SampleBranch } from "./sample-data";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-line-subtle py-6 last:border-b-0">
      <h2 className="text-title font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {label && <span className="w-28 shrink-0 text-small text-fg-muted">{label}</span>}
      {children}
    </div>
  );
}

const SWATCHES = [
  ["--bg-app", "App"],
  ["--bg-panel", "Panel"],
  ["--bg-elevated", "Elevated"],
  ["--bg-input", "Input"],
  ["--bg-selected", "Selected"],
  ["--accent", "Accent"],
  ["--success", "Success"],
  ["--danger", "Danger"],
  ["--warning", "Warning"],
  ["--info", "Info"],
] as const;

function Colors() {
  return (
    <Section title="Colour">
      <div className="grid grid-cols-5 gap-2">
        {SWATCHES.map(([token, name]) => (
          <div key={token} className="flex flex-col gap-1">
            <div
              className="h-10 rounded-control border border-line-subtle"
              style={{ background: `var(${token})` }}
            />
            <span className="text-small text-fg">{name}</span>
            <code className="text-caption text-fg-muted">{token}</code>
          </div>
        ))}
      </div>
      <Row label="Graph lanes">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="flex items-center gap-1.5 text-small text-fg-secondary">
            <span className="size-3 rounded-full" style={{ background: `var(--lane-${i + 1})` }} />
            {i + 1}
          </span>
        ))}
      </Row>
      <Row label="Text">
        <span className="text-fg">Primary</span>
        <span className="text-fg-secondary">Secondary</span>
        <span className="text-fg-muted">Muted</span>
      </Row>
      <Row label="Diff">
        <code className="flex flex-col overflow-hidden rounded-control border border-line-subtle text-small">
          <span className="bg-(--diff-hunk-bg) px-2 text-fg-secondary">
            @@ -10,6 +10,9 @@ fn parse
          </span>
          <span className="bg-(--diff-del-bg) px-2">
            - let y = <span className="bg-(--diff-del-word)">2</span>;
          </span>
          <span className="bg-(--diff-add-bg) px-2">
            + let y = <span className="bg-(--diff-add-word)">compute()</span>;
          </span>
        </code>
      </Row>
    </Section>
  );
}

function Typography() {
  return (
    <Section title="Type">
      <div className="flex flex-col gap-2">
        <span className="text-heading font-semibold">Heading 20 — Welcome to Tylia</span>
        <span className="text-dialog-title font-semibold">Dialog title 16 — Push changes</span>
        <span className="text-title font-semibold">Panel title 14 — Commit details</span>
        <span>Base 13 — Fix parser on CRLF input</span>
        <span className="text-small text-fg-secondary">
          Secondary 12 — a1b2c3d · Ada · 2 hours ago
        </span>
        <span className="text-caption text-fg-muted">Caption 11 — Branches</span>
        <code className="text-small">JetBrains Mono — let y = compute(); // != -&gt; =&gt;</code>
      </div>
    </Section>
  );
}

function Buttons() {
  return (
    <Section title="Buttons">
      {(["primary", "secondary", "ghost", "danger"] as const).map((variant) => (
        <Row key={variant} label={variant}>
          <Button variant={variant} size="sm">
            Small
          </Button>
          <Button variant={variant} icon={Upload}>
            Push
          </Button>
          <Button variant={variant} size="lg">
            {variant === "danger" ? "Discard 3 files" : "Commit"}
          </Button>
          <Button variant={variant} loading>
            Fetching
          </Button>
          <Button variant={variant} disabled>
            Disabled
          </Button>
        </Row>
      ))}
      <Row label="Icon buttons">
        <IconButton icon={RefreshCw} label="Fetch" shortcut="Mod+Shift+F" />
        <IconButton icon={Search} label="Search" shortcut="Mod+F" />
        <IconButton icon={History} label="History" active />
        <IconButton icon={Copy} label="Copy hash" compact />
        <IconButton icon={Trash2} label="Delete" disabled />
      </Row>
      <Row label="Split button">
        <SplitButton
          label="Pull"
          icon={ArrowDown}
          onClick={() => toast({ kind: "success", title: "Pulled 3 commits" })}
          menuLabel="Pull options"
          menu={
            <>
              <Menu.Item>Pull (merge)</Menu.Item>
              <Menu.Item>Pull with rebase</Menu.Item>
              <Menu.Item>Pull, fast-forward only</Menu.Item>
            </>
          }
        />
        <SplitButton
          label="Commit"
          variant="primary"
          onClick={() => {}}
          menuLabel="Commit options"
          menu={<Menu.Item>Commit and push</Menu.Item>}
        />
      </Row>
    </Section>
  );
}

function Inputs() {
  const [message, setMessage] = useState(
    "Fix parser on CRLF input\n\nGit on Windows may emit CRLF.",
  );
  const [checks, setChecks] = useState({ a: true, b: false });
  const [on, setOn] = useState(true);
  const [view, setView] = useState<"unified" | "split">("unified");
  const both = checks.a && checks.b ? true : checks.a || checks.b ? "indeterminate" : false;
  return (
    <Section title="Inputs">
      <Row label="Input">
        <Input placeholder="Branch name" className="w-56" />
        <Input icon={Search} placeholder="Filter branches" className="w-56" />
        <Input compact placeholder="Compact" className="w-40" />
        <Input disabled value="Disabled" className="w-40" readOnly />
      </Row>
      <Row label="Textarea">
        <Textarea
          className="w-112"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Summary"
        />
      </Row>
      <Row label="Checkbox">
        <Checkbox
          checked={both}
          onCheckedChange={(v) => setChecks({ a: v, b: v })}
          label="All files"
        />
        <Checkbox
          checked={checks.a}
          onCheckedChange={(a) => setChecks((c) => ({ ...c, a }))}
          label="src/app.ts"
        />
        <Checkbox
          checked={checks.b}
          onCheckedChange={(b) => setChecks((c) => ({ ...c, b }))}
          label="notes.md"
        />
        <Checkbox checked disabled label="Disabled" />
      </Row>
      <Row label="Switch">
        <Switch checked={on} onCheckedChange={setOn} label="Push after commit" />
        <Switch checked={false} disabled label="Disabled" />
      </Row>
      <Row label="Segmented">
        <SegmentedControl
          aria-label="Diff view"
          value={view}
          onValueChange={setView}
          segments={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Side by side" },
          ]}
        />
      </Row>
    </Section>
  );
}

function Badges() {
  return (
    <Section title="Badges, avatars, keys">
      <Row label="Badge">
        <Badge>3</Badge>
        <Badge tone="accent">↑2</Badge>
        <Badge tone="success">+120</Badge>
        <Badge tone="danger">−14</Badge>
        <Badge tone="warning">2 conflicts</Badge>
        <Badge tone="info">renamed</Badge>
      </Row>
      <Row label="Ref badges">
        <RefBadge refInfo={{ kind: "local", name: "main", current: true }} />
        <RefBadge
          refInfo={{ kind: "local", name: "main", current: true, syncedRemote: "origin" }}
        />
        <RefBadge refInfo={{ kind: "local", name: "feature/graph", lane: 2 }} />
        <RefBadge refInfo={{ kind: "remote", name: "origin/feature/x", lane: 5 }} />
        <RefBadge refInfo={{ kind: "tag", name: "v0.1.0" }} />
        <RefBadge refInfo={{ kind: "head", name: "HEAD" }} />
        <RefBadge refInfo={{ kind: "stash", name: "stash@{0}" }} />
      </Row>
      <Row label="Overflow">
        <RefBadgeList refs={manyRefs} />
      </Row>
      <Row label="Avatar">
        <Avatar name="Ada Lovelace" email="ada@example.com" />
        <Avatar name="Grace Hopper" email="grace@example.com" size={24} />
        <Avatar name="Linus Torvalds" email="linus@example.org" size={32} />
        <Avatar name="margaret" email="margaret@example.net" size={32} />
      </Row>
      <Row label="Kbd">
        <Kbd shortcut="Mod+K" />
        <Kbd shortcut="Mod+Shift+P" />
        <Kbd shortcut="Mod+Enter" />
      </Row>
    </Section>
  );
}

function Overlays() {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title="Menus, popovers, dialogs, toasts">
      <Row label="Menu">
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button icon={GitBranch}>Branch actions</Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item icon={GitBranch} shortcut="Mod+Shift+N">
              New branch…
            </Menu.Item>
            <Menu.Item icon={GitMerge}>Merge into current</Menu.Item>
            <Menu.Sub>
              <Menu.SubTrigger icon={Copy}>Copy</Menu.SubTrigger>
              <Menu.SubContent>
                <Menu.Item>Branch name</Menu.Item>
                <Menu.Item>Commit hash</Menu.Item>
              </Menu.SubContent>
            </Menu.Sub>
            <Menu.Separator />
            <Menu.Item icon={Trash2} danger>
              Delete branch…
            </Menu.Item>
            <Menu.Item disabled>Rename (disabled)</Menu.Item>
          </Menu.Content>
        </Menu.Root>
        <ContextMenu.Root>
          <ContextMenu.Trigger className="flex h-16 w-64 items-center justify-center rounded-menu border border-dashed border-line text-small text-fg-muted">
            Right-click here
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Item icon={FolderOpen}>Open in file manager</ContextMenu.Item>
            <ContextMenu.Item icon={Copy} shortcut="Mod+C">
              Copy path
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item icon={Trash2} danger>
              Discard changes…
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
      </Row>
      <Row label="Popover, tooltip">
        <Popover>
          <PopoverTrigger asChild>
            <Button>Show popover</Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <p className="font-medium">Upstream</p>
            <p className="text-small text-fg-secondary">main tracks origin/main, 2 ahead.</p>
          </PopoverContent>
        </Popover>
        <Tooltip content="Fetch from all remotes" shortcut="Mod+Shift+F">
          <Button variant="ghost" icon={RefreshCw}>
            Hover for tooltip
          </Button>
        </Tooltip>
      </Row>
      <Row label="Dialog">
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Discard…
        </Button>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Create branch"
          description="Starts at the selected commit a1b2c3d."
          onSubmit={() => setDialog(false)}
          footer={
            <>
              <Button size="lg" onClick={() => setDialog(false)}>
                Cancel
              </Button>
              <Button size="lg" variant="primary" type="submit">
                Create branch
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Input autoFocus placeholder="feature/my-change" />
            <Checkbox checked onCheckedChange={() => {}} label="Check out after creating" />
          </div>
        </Dialog>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          destructive
          title="Discard changes?"
          consequence="This permanently deletes uncommitted changes in 3 files."
          confirmLabel="Discard 3 files"
          onConfirm={() => toast({ kind: "success", title: "Discarded 3 files" })}
        />
      </Row>
      <Row label="Toast">
        <Button
          onClick={() =>
            toast({ kind: "success", title: "Pushed to origin/main", description: "2 commits" })
          }
        >
          Success
        </Button>
        <Button onClick={() => toast({ kind: "error", title: "Push failed", error: sampleError })}>
          Error
        </Button>
        <Button
          onClick={() => {
            const id = toast({ kind: "progress", title: "Fetching origin", progress: 0 });
            let p = 0;
            const timer = setInterval(() => {
              p += 0.1;
              if (p >= 1) {
                clearInterval(timer);
                toast.update(id, { kind: "success", title: "Fetched origin" });
              } else {
                toast.update(id, {
                  kind: "progress",
                  title: "Fetching origin",
                  description: `Receiving objects ${Math.round(p * 100)}%`,
                  progress: p,
                });
              }
            }, 300);
          }}
        >
          Progress
        </Button>
      </Row>
    </Section>
  );
}

function Feedback() {
  return (
    <Section title="Feedback">
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-menu border border-line-subtle">
          <EmptyState
            icon={Inbox}
            title="No stashes"
            description="Stashed changes appear here."
            actions={<Button size="sm">Stash changes</Button>}
          />
        </div>
        <div className="rounded-menu border border-line-subtle py-2">
          <SkeletonRows count={5} />
        </div>
        <div className="flex items-center justify-center gap-4 rounded-menu border border-line-subtle text-accent">
          <ProgressRing size={20} />
          <ProgressRing size={20} value={0.35} />
          <ProgressRing size={20} value={0.8} />
          <ProgressRing size={20} value={1} />
        </div>
      </div>
      <ErrorPanel {...sampleError} />
    </Section>
  );
}

function BranchLeaf({ branch }: { branch: SampleBranch }) {
  return (
    <>
      <GitBranch size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-fg-muted" />
      <span className="flex-1 truncate">{branch.name.split("/").pop()}</span>
      {branch.ahead && (
        <span className="text-caption text-fg-muted tabular-nums">↑{branch.ahead}</span>
      )}
      {branch.behind && (
        <span className="text-caption text-fg-muted tabular-nums">↓{branch.behind}</span>
      )}
    </>
  );
}

function Layout() {
  const [sidebar, setSidebar] = useState(220);
  const [expanded, setExpanded] = useState(new Set(["feature", "feature/graph"]));
  const [selectedBranch, setSelectedBranch] = useState<string | null>("main");
  const [selected, setSelected] = useState<number | null>(0);
  return (
    <Section title="Layout: split pane, tree, virtual list (10,000 rows), repo tabs">
      <Row label="Repo tabs">
        <div className="flex items-center gap-1 rounded-control bg-panel p-1">
          <RepoTab label="tylia" icon={GitBranch} active onClose={() => {}} />
          <RepoTab label="my-app" icon={GitBranch} dirty onClose={() => {}} />
          <RepoTab label="a-repository-with-a-very-long-name" icon={GitBranch} onClose={() => {}} />
        </div>
      </Row>
      <div className="h-96 overflow-hidden rounded-menu border border-line-subtle">
        <SplitPane
          size={sidebar}
          onSizeChange={setSidebar}
          min={180}
          max={400}
          first={
            <div className="flex h-full flex-col gap-1 overflow-auto bg-panel p-2">
              <span className="px-1 pt-1 text-caption font-medium text-fg-muted">Branches</span>
              <Tree
                aria-label="Branches"
                items={branches}
                getPath={(b) => b.name}
                expanded={expanded}
                onExpandedChange={setExpanded}
                selectedId={selectedBranch}
                onSelect={(leaf) => setSelectedBranch(leaf.id)}
                renderLeaf={(leaf) => <BranchLeaf branch={leaf.data} />}
              />
            </div>
          }
          second={
            <VirtualList
              aria-label="History"
              items={commits}
              rowHeight={30}
              getKey={(c) => c.hash}
              selectedIndex={selected}
              onSelect={setSelected}
              renderRow={(c) => (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <GitCommitHorizontal
                    size={14}
                    strokeWidth={1.75}
                    aria-hidden
                    className="shrink-0 text-(--lane-1)"
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <RefBadgeList refs={c.refs} />
                    <span className="truncate">{c.subject}</span>
                  </span>
                  <span className="flex w-36 shrink-0 items-center gap-2 text-fg-secondary">
                    <Avatar name={c.author} email={c.email} />
                    <span className="truncate">{c.author}</span>
                  </span>
                  <span className="w-20 shrink-0 text-small text-fg-secondary">{c.age}</span>
                  <code className="w-14 shrink-0 text-small text-fg-muted">
                    {c.hash.slice(0, 7)}
                  </code>
                </div>
              )}
            />
          }
        />
      </div>
    </Section>
  );
}

export default function Gallery() {
  const { settings, update } = useSettings();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-(--toolbar-h) shrink-0 items-center gap-2 border-b border-line-subtle bg-panel px-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => (location.hash = "")} />
        <FileText size={16} strokeWidth={1.75} aria-hidden className="text-fg-muted" />
        <h1 className="text-title font-semibold">Component gallery</h1>
        <span className="flex-1" />
        <SegmentedControl
          aria-label="Theme"
          value={settings.theme}
          onValueChange={(theme) => update({ theme })}
          segments={themeOptions.map((o) => ({ ...o }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="gallery-scroll">
        <div className="mx-auto max-w-5xl px-8 pb-12">
          <Colors />
          <Typography />
          <Buttons />
          <Inputs />
          <Badges />
          <Overlays />
          <Feedback />
          <DiffSection />
          <Layout />
        </div>
      </div>
    </div>
  );
}
