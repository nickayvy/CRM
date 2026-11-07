"use client";

import * as React from "react";
import { MotionConfig } from "motion/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import {
  BuildingIcon,
  InboxIcon,
  MailIcon,
  PhoneCallIcon,
  PhoneIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ShuffleIcon,
  SparklesIcon,
  Trash2Icon,
  TrophyIcon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  ChartCard,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FilterBar,
  FilterRange,
  FilterSelect,
  Kbd,
  KbdGroup,
  KeyValue,
  KeyValueList,
  PageHeader,
  PageSection,
  PageShell,
  ProgressBar,
  ReasonChip,
  ScoreRing,
  SidePanel,
  StatCard,
  StatGrid,
  StatusBadge,
  Timeline,
  TimelineItem,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarSpacer,
  dataTableColumnHelper,
  useConfirm,
  type ActiveFilter,
  type RangeValue,
  type SortState,
  type RowSelectionState,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnimatedItem, AnimatedList, AnimatedNumber, FadeIn, Presence, durations, easings, springs } from "@/lib/motion";
import { formatPhone, formatRating, formatRelative } from "@/lib/format";
import { CAMPAIGN_STATUS_LABELS, QUALIFICATION_LABELS, STATUS_LABELS, type Tone } from "@/lib/labels";
import type { BusinessStatus, Qualification } from "@/db/schema";
import { ACTIVITIES, BUSINESSES, CALLS_PER_DAY, CAMPAIGNS, REASON_TEXT, type SampleBusiness } from "./sample-data";

const TONES: Tone[] = ["neutral", "info", "success", "warning", "danger"];
const SOFT_REASONS = new Set(["unclaimed", "low_score"]);

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-6 shrink-0 rounded-md border" style={{ background: `var(${varName})` }} aria-hidden />
      <div className="flex min-w-0 flex-col">
        <span className="text-xs font-medium">{name}</span>
        <code className="truncate font-mono text-2xs text-muted-foreground">{varName}</code>
      </div>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border bg-card p-4 ${className ?? ""}`}>{children}</div>;
}

const col = dataTableColumnHelper<SampleBusiness>();

function useBusinessColumns() {
  return React.useMemo(
    () =>
      col.columns([
        col.accessor("name", {
          header: "Business",
          cell: (c) => (
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{c.getValue()}</span>
              <span className="truncate text-xs text-muted-foreground">
                {c.row.original.category} · {c.row.original.city}
              </span>
            </div>
          ),
        }),
        col.accessor("phone", {
          header: "Phone",
          enableSorting: false,
          cell: (c) => <span className="font-mono text-xs">{formatPhone(c.getValue())}</span>,
        }),
        col.accessor("rating", {
          header: "Rating",
          meta: { align: "right" },
          cell: (c) => formatRating(c.getValue()),
        }),
        col.accessor("reviewCount", { header: "Reviews", meta: { align: "right" } }),
        col.accessor("score", {
          header: "Score",
          meta: { align: "right" },
          cell: (c) => (
            <span className="inline-flex justify-end">
              <ScoreRing value={c.getValue()} size={26} thickness={3} />
            </span>
          ),
        }),
        col.accessor("qualification", {
          header: "Qualification",
          cell: (c) => (
            <div className="flex items-center gap-1">
              <StatusBadge label={QUALIFICATION_LABELS[c.getValue()]} />
              {c.row.original.reasons.map((r) => (
                <ReasonChip key={r} code={r} label={REASON_TEXT[r] ?? r} tone={SOFT_REASONS.has(r) ? "warning" : "danger"} />
              ))}
            </div>
          ),
        }),
        col.accessor("status", {
          header: "Status",
          cell: (c) => <StatusBadge variant="dot" label={STATUS_LABELS[c.getValue()]} />,
        }),
        col.accessor("lastActivityAt", {
          header: "Last activity",
          meta: { align: "right" },
          cell: (c) => (
            <time dateTime={c.getValue()} className="text-muted-foreground" suppressHydrationWarning>
              {formatRelative(c.getValue())}
            </time>
          ),
        }),
      ]),
    [],
  );
}

function compare(a: SampleBusiness, b: SampleBusiness, id: string): number {
  const av = a[id as keyof SampleBusiness];
  const bv = b[id as keyof SampleBusiness];
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

/** Businesses table driven like a server page: filters, sort and page are "URL state" and the data is sliced here. */
function BusinessesDemo() {
  const columns = useBusinessColumns();
  const [query, setQuery] = React.useState("");
  const [statuses, setStatuses] = React.useState<string[]>([]);
  const [quals, setQuals] = React.useState<string[]>([]);
  const [rating, setRating] = React.useState<RangeValue>([null, null]);
  const [sort, setSort] = React.useState<SortState | null>({ id: "score", desc: true });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [density, setDensity] = React.useState<"compact" | "comfortable">("compact");
  const [loading, setLoading] = React.useState(false);
  const [forceEmpty, setForceEmpty] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const filtered = React.useMemo(() => {
    if (forceEmpty) return [];
    const q = query.trim().toLowerCase();
    const rows = BUSINESSES.filter(
      (b) =>
        (!q || b.name.toLowerCase().includes(q) || b.city.toLowerCase().includes(q)) &&
        (statuses.length === 0 || statuses.includes(b.status)) &&
        (quals.length === 0 || quals.includes(b.qualification)) &&
        (rating[0] === null || b.rating >= rating[0]) &&
        (rating[1] === null || b.rating <= rating[1]),
    );
    if (sort) rows.sort((a, b) => compare(a, b, sort.id) * (sort.desc ? -1 : 1));
    return rows;
  }, [query, statuses, quals, rating, sort, forceEmpty]);

  const pageRows = React.useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);
  const resetPage = () => setPage(1);

  const active: ActiveFilter[] = [
    ...statuses.map((s) => ({
      id: `status:${s}`,
      label: `Status: ${STATUS_LABELS[s as BusinessStatus].label}`,
      onRemove: () => setStatuses((v) => v.filter((x) => x !== s)),
    })),
    ...quals.map((q) => ({
      id: `qual:${q}`,
      label: `Qualification: ${QUALIFICATION_LABELS[q as Qualification].label}`,
      onRemove: () => setQuals((v) => v.filter((x) => x !== q)),
    })),
    ...(rating[0] !== null || rating[1] !== null
      ? [
          {
            id: "rating",
            label: `Rating: ${rating[0] ?? 1}–${rating[1] ?? 5}`,
            onRemove: () => setRating([null, null]),
          },
        ]
      : []),
  ];

  const open = BUSINESSES.find((b) => b.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {dialog}
      <FilterBar
        search={{
          value: query,
          onChange: (v) => {
            setQuery(v);
            resetPage();
          },
          placeholder: "Search businesses…",
        }}
        activeFilters={active}
        onClearAll={() => {
          setStatuses([]);
          setQuals([]);
          setRating([null, null]);
          setQuery("");
          resetPage();
        }}
        actions={
          <>
            <Tabs value={density} onValueChange={(v) => setDensity(v as "compact" | "comfortable")}>
              <TabsList className="h-7">
                <TabsTrigger value="compact" className="text-xs">
                  Compact
                </TabsTrigger>
                <TabsTrigger value="comfortable" className="text-xs">
                  Comfortable
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button size="sm" variant="outline" onClick={() => toast.success("Export queued")}>
              <UploadIcon /> Export
            </Button>
          </>
        }
      >
        <FilterSelect
          label="Status"
          options={(Object.keys(STATUS_LABELS) as BusinessStatus[]).map((s) => ({
            value: s,
            label: STATUS_LABELS[s].label,
            count: BUSINESSES.filter((b) => b.status === s).length,
          }))}
          value={statuses}
          onChange={(v) => {
            setStatuses(v);
            resetPage();
          }}
        />
        <FilterSelect
          label="Qualification"
          options={(Object.keys(QUALIFICATION_LABELS) as Qualification[]).map((q) => ({
            value: q,
            label: QUALIFICATION_LABELS[q].label,
            count: BUSINESSES.filter((b) => b.qualification === q).length,
          }))}
          value={quals}
          onChange={(v) => {
            setQuals(v);
            resetPage();
          }}
        />
        <FilterRange
          label="Rating"
          min={1}
          max={5}
          step={0.5}
          format="decimal"
          value={rating}
          onChange={(v) => {
            setRating(v);
            resetPage();
          }}
        />
      </FilterBar>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <Switch checked={loading} onCheckedChange={setLoading} aria-label="Show loading state" /> Loading
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={forceEmpty} onCheckedChange={setForceEmpty} aria-label="Show empty state" /> Empty
        </label>
        <span className="flex items-center gap-1.5">
          <KbdGroup keys={["j", "k"]} /> or <KbdGroup keys={["↑", "↓"]} /> move, <Kbd>Enter</Kbd> opens, <Kbd>x</Kbd> selects
        </span>
      </div>
      <DataTable
        aria-label="Sample businesses"
        columns={columns}
        data={pageRows}
        getRowId={(b) => b.id}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          resetPage();
        }}
        manualSorting
        enableSelection
        selection={selection}
        onSelectionChange={setSelection}
        bulkActions={({ selectedIds, clear }) => (
          <>
            <Button size="sm" variant="ghost" onClick={() => toast.success(`Added ${selectedIds.length} to campaign`)}>
              <PhoneCallIcon /> Add to campaign
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toast(`Enrolled ${selectedIds.length} in sequence`)}>
              <MailIcon /> Enroll
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={async () => {
                const ok = await confirm({
                  title: `Mark ${selectedIds.length} as do not call?`,
                  description: "They will be removed from every calling queue.",
                  confirmLabel: "Mark do not call",
                  tone: "danger",
                });
                if (ok) {
                  toast.success(`${selectedIds.length} marked do not call`);
                  clear();
                }
              }}
            >
              <Trash2Icon /> Do not call
            </Button>
          </>
        )}
        loading={loading}
        emptyState={
          <EmptyState
            size="compact"
            icon={<InboxIcon />}
            title="No businesses match"
            description="Clear a filter or run a new search."
            action={
              <Button size="sm" variant="outline" onClick={() => setForceEmpty(false)}>
                Reset demo
              </Button>
            }
          />
        }
        onRowClick={(b) => setOpenId(b.id)}
        activeRowId={openId}
        density={density}
        maxHeight="28rem"
        pagination={{
          page,
          pageSize,
          total: filtered.length,
          onPageChange: setPage,
          onPageSizeChange: (n) => {
            setPageSize(n);
            setPage(1);
          },
          pageSizeOptions: [10, 25, 50],
        }}
      />
      <SidePanel
        open={open !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open?.name ?? ""}
        description={open ? `${open.category} · ${open.city}` : undefined}
        headerActions={open ? <StatusBadge label={QUALIFICATION_LABELS[open.qualification]} /> : null}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpenId(null)}>
              Close
            </Button>
            <Button size="sm" onClick={() => toast.success("Call started")}>
              <PhoneIcon /> Call
            </Button>
          </>
        }
      >
        {open ? (
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <ScoreRing value={open.score} size={48} thickness={5} />
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Lead score</span>
                <div className="flex flex-wrap gap-1">
                  {open.reasons.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No flags</span>
                  ) : (
                    open.reasons.map((r) => <ReasonChip key={r} code={r} label={REASON_TEXT[r] ?? r} />)
                  )}
                </div>
              </div>
            </div>
            <KeyValueList>
              <KeyValue label="Phone" mono>
                {formatPhone(open.phone)}
              </KeyValue>
              <KeyValue label="Rating" hint={`${open.reviewCount} reviews`}>
                {formatRating(open.rating)}
              </KeyValue>
              <KeyValue label="Status">
                <StatusBadge label={STATUS_LABELS[open.status]} />
              </KeyValue>
              <KeyValue label="Website">{null}</KeyValue>
              <KeyValue label="Yelp id" mono>
                {open.id}
              </KeyValue>
            </KeyValueList>
            <PageSection title="Activity">
              <Timeline>
                {ACTIVITIES.map((a) => (
                  <TimelineItem key={a.id} type={a.type} time={a.at} agent={a.agent} title={a.title}>
                    {a.body}
                  </TimelineItem>
                ))}
              </Timeline>
            </PageSection>
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

function MotionDemo() {
  const [replay, setReplay] = React.useState(0);
  const [items, setItems] = React.useState(() => CAMPAIGNS.map((c) => c.name).concat(["Austin roofers", "Dallas landscapers"]));
  const [showPresence, setShowPresence] = React.useState(true);
  const [n, setN] = React.useState(1284);
  const nextId = React.useRef(1);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">FadeIn</span>
          <Button size="xs" variant="outline" onClick={() => setReplay((r) => r + 1)}>
            <PlayIcon /> Replay
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {(["up", "fade", "scale", "right"] as const).map((v, i) => (
            <FadeIn key={`${v}-${replay}`} variant={v} delay={i * 0.05} className="rounded-md border bg-muted/50 p-3 text-center text-xs">
              {v}
            </FadeIn>
          ))}
        </div>
      </Panel>
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">AnimatedNumber</span>
          <Button size="xs" variant="outline" onClick={() => setN(Math.round(500 + Math.random() * 20000))}>
            <RefreshCwIcon /> Randomize
          </Button>
        </div>
        <div className="flex flex-wrap items-baseline gap-6">
          <span className="text-3xl font-semibold tracking-tight">
            <AnimatedNumber value={n} />
          </span>
          <span className="text-xl font-medium text-muted-foreground">
            <AnimatedNumber value={n * 12} format="currency" />
          </span>
          <span className="text-xl font-medium text-muted-foreground">
            <AnimatedNumber value={(n % 100) / 100} format="percent" />
          </span>
          <span className="text-xl font-medium text-muted-foreground">
            <AnimatedNumber value={n * 1000} format="compact" />
          </span>
        </div>
      </Panel>
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">AnimatedList + AnimatedItem</span>
          <div className="flex gap-1">
            <Button size="xs" variant="outline" onClick={() => setItems((l) => [`New list ${nextId.current++}`, ...l])}>
              <PlusIcon /> Add
            </Button>
            <Button size="xs" variant="outline" onClick={() => setItems((l) => [...l].sort(() => Math.random() - 0.5))}>
              <ShuffleIcon /> Shuffle
            </Button>
          </div>
        </div>
        <AnimatedList as="ul" className="flex flex-col gap-1">
          {items.map((name) => (
            <AnimatedItem
              key={name}
              as="li"
              className="flex items-center justify-between rounded-md border bg-background px-2.5 py-1.5 text-dense"
            >
              <span className="truncate">{name}</span>
              <Button size="icon-xs" variant="ghost" aria-label={`Remove ${name}`} onClick={() => setItems((l) => l.filter((x) => x !== name))}>
                <Trash2Icon />
              </Button>
            </AnimatedItem>
          ))}
        </AnimatedList>
      </Panel>
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Presence</span>
          <Switch checked={showPresence} onCheckedChange={setShowPresence} aria-label="Toggle presence demo" />
        </div>
        <div className="min-h-24">
          <Presence>
            {showPresence ? (
              <FadeIn key="card" variant="scale" className="rounded-md border bg-muted/50 p-3 text-xs">
                Enters with <code className="font-mono">scaleIn</code>, exits with its <code className="font-mono">exit</code> variant before unmounting.
              </FadeIn>
            ) : null}
          </Presence>
        </div>
        <div className="grid gap-1 text-2xs text-muted-foreground">
          <span className="font-mono">
            durations: fast {durations.fast}s · base {durations.base}s · slow {durations.slow}s
          </span>
          <span className="font-mono">easings.standard: [{easings.standard.join(", ")}]</span>
          <span className="font-mono">
            springs.snappy: {springs.snappy.stiffness}/{springs.snappy.damping} · gentle: {springs.gentle.stiffness}/{springs.gentle.damping}
          </span>
        </div>
      </Panel>
    </div>
  );
}

/** Every primitive and motion component with sample data. */
export function DesignShowcase() {
  const [forceReduced, setForceReduced] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [statsLoading, setStatsLoading] = React.useState(false);

  return (
    <MotionConfig reducedMotion={forceReduced ? "always" : "user"}>
      <PageShell width="full" className="max-w-[90rem]">
        <PageHeader
          breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Design system" }]}
          title="Design system"
          meta={
            <>
              <StatusBadge tone="info">WP-02</StatusBadge>
              <StatusBadge tone="success" variant="dot">
                Stable
              </StatusBadge>
            </>
          }
          description="Primitives and motion used by every screen. Toggle light/dark with the theme button in the top bar."
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
                Confirm dialog
              </Button>
              <Button size="sm" onClick={() => toast.success("Primary action")}>
                <SparklesIcon /> Primary
              </Button>
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-2 font-medium text-foreground">
            <Switch checked={forceReduced} onCheckedChange={setForceReduced} aria-label="Force reduced motion" />
            Force reduced motion
          </label>
          <span>
            Every motion component also follows the OS setting (<code className="font-mono">prefers-reduced-motion: reduce</code>): it then renders
            static, without opacity/transform animation. Press <Kbd>[</Kbd> to collapse the sidebar, <KbdGroup keys={["⌘", "/"]} /> to focus search.
          </span>
        </div>

        <PageSection title="Stat cards" description="StatCard + StatGrid; numeric values count up via AnimatedNumber." actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={statsLoading} onCheckedChange={setStatsLoading} aria-label="Show stat loading state" /> Loading
          </label>
        }>
          <StatGrid columns={4}>
            <StatCard
              label="Qualified leads"
              value={1284}
              icon={<BuildingIcon />}
              delta={{ value: 0.124, format: "percent", label: "vs last week" }}
              hint="Across 3 searches"
              href="/businesses"
              loading={statsLoading}
            />
            <StatCard label="Calls today" value={64} icon={<PhoneIcon />} delta={{ value: -7, label: "vs yesterday" }} loading={statsLoading} />
            <StatCard
              label="Reply rate"
              value={0.087}
              format="percent"
              icon={<MailIcon />}
              delta={{ value: 0, format: "percent", label: "flat" }}
              loading={statsLoading}
            />
            <StatCard label="Pipeline" value={48200} format="currency" icon={<TrophyIcon />} hint="Converted this month" loading={statsLoading} />
          </StatGrid>
        </PageSection>

        <PageSection title="Data table" description="FilterBar + DataTable driven like a URL-param page: manual sort, pagination, selection with bulk bar, row click opens a SidePanel.">
          <BusinessesDemo />
        </PageSection>

        <div className="grid gap-6 lg:grid-cols-2">
          <PageSection title="Badges" description="StatusBadge (soft and dot) by tone; ReasonChip with tooltip.">
            <Panel className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {TONES.map((t) => (
                  <StatusBadge key={t} tone={t}>
                    {t}
                  </StatusBadge>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                {TONES.map((t) => (
                  <StatusBadge key={t} tone={t} variant="dot">
                    {t}
                  </StatusBadge>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(STATUS_LABELS) as BusinessStatus[]).map((s) => (
                  <StatusBadge key={s} label={STATUS_LABELS[s]} />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(REASON_TEXT).map(([code, text]) => (
                  <ReasonChip key={code} code={code} label={text} tone={SOFT_REASONS.has(code) ? "warning" : "danger"} />
                ))}
              </div>
            </Panel>
          </PageSection>

          <PageSection title="Score and progress" description="ScoreRing (auto tone by threshold) and ProgressBar.">
            <Panel className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-4">
                {[95, 63, 38, 15].map((v) => (
                  <ScoreRing key={v} value={v} />
                ))}
                <ScoreRing value={82} size={56} thickness={6} />
              </div>
              <div className="flex flex-col gap-3">
                {CAMPAIGNS.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <ProgressBar
                      className="flex-1"
                      label={c.name}
                      value={c.done}
                      max={c.total}
                      showValue
                      tone={c.status === "running" ? "success" : c.status === "paused" ? "warning" : "neutral"}
                    />
                    <StatusBadge label={CAMPAIGN_STATUS_LABELS[c.status]} />
                  </div>
                ))}
                <ProgressBar value={40} size="sm" tone="info" label="Small" />
              </div>
            </Panel>
          </PageSection>

          <PageSection title="Key-value list">
            <Panel>
              <KeyValueList columns={2}>
                <KeyValue label="Phone" mono>
                  {formatPhone(BUSINESSES[0].phone)}
                </KeyValue>
                <KeyValue label="Rating" hint={`${BUSINESSES[0].reviewCount} reviews`}>
                  {formatRating(BUSINESSES[0].rating)}
                </KeyValue>
                <KeyValue label="Category">{BUSINESSES[0].category}</KeyValue>
                <KeyValue label="City">{BUSINESSES[0].city}</KeyValue>
                <KeyValue label="Website">{""}</KeyValue>
                <KeyValue label="Owner">Dana Whitfield</KeyValue>
              </KeyValueList>
            </Panel>
          </PageSection>

          <PageSection title="Timeline">
            <Panel>
              <Timeline>
                {ACTIVITIES.map((a) => (
                  <TimelineItem key={a.id} type={a.type} time={a.at} agent={a.agent} title={a.title}>
                    {a.body}
                  </TimelineItem>
                ))}
              </Timeline>
            </Panel>
          </PageSection>

          <PageSection title="Empty state">
            <div className="grid gap-3 sm:grid-cols-2">
              <EmptyState
                bordered
                icon={<InboxIcon />}
                title="No campaigns yet"
                description="Create a calling campaign from a saved filter."
                action={
                  <Button size="sm">
                    <PlusIcon /> New campaign
                  </Button>
                }
              />
              <EmptyState bordered size="compact" icon={<MailIcon />} title="No replies" description="Replies show up here." />
            </div>
          </PageSection>

          <PageSection title="Chart card" description="Thin wrapper; charts themselves arrive in WP-07.">
            <ChartCard title="Calls per day" description="This week" height={200} footer="Connect rate 27%">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 200 }}>
                <BarChart data={CALLS_PER_DAY} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                  <ChartTooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      fontSize: 12,
                      color: "var(--popover-foreground)",
                    }}
                  />
                  <Bar dataKey="calls" fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="connects" fill="var(--chart-2)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </PageSection>
        </div>

        <PageSection title="Toolbar and keys">
          <Toolbar variant="bar" aria-label="Campaign actions">
            <ToolbarGroup>
              <Button size="sm" variant="ghost">
                <PlayIcon /> Start
              </Button>
              <Button size="sm" variant="ghost">
                Pause
              </Button>
            </ToolbarGroup>
            <ToolbarSeparator />
            <ToolbarGroup>
              <Button size="sm" variant="ghost">
                <RefreshCwIcon /> Requalify
              </Button>
            </ToolbarGroup>
            <ToolbarSpacer />
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Command palette <KbdGroup keys={["⌘", "K"]} />
            </span>
          </Toolbar>
        </PageSection>

        <PageSection title="Motion" description="Tokens, variants and wrappers from src/lib/motion.">
          <MotionDemo />
        </PageSection>

        <PageSection title="Foundations" description="Tokens from globals.css (light and dark), 4px radius scale, 14px body / 13px dense.">
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel className="grid grid-cols-2 gap-3">
              {[
                ["Background", "--background"],
                ["Card", "--card"],
                ["Muted", "--muted"],
                ["Border", "--border"],
                ["Foreground", "--foreground"],
                ["Muted fg", "--muted-foreground"],
                ["Accent (primary)", "--primary"],
                ["Ring", "--ring"],
              ].map(([n, v]) => (
                <Swatch key={v} name={n} varName={v} />
              ))}
            </Panel>
            <Panel className="grid grid-cols-2 gap-3">
              {TONES.map((t) => (
                <Swatch key={t} name={`Tone ${t}`} varName={`--tone-${t}`} />
              ))}
              {[1, 2, 3, 4, 5].map((i) => (
                <Swatch key={i} name={`Chart ${i}`} varName={`--chart-${i}`} />
              ))}
            </Panel>
            <Panel className="flex flex-col gap-2">
              <span className="text-xl font-semibold tracking-tight">Page title 20/600</span>
              <span className="text-sm font-semibold">Section 14/600</span>
              <span className="text-sm">Body 14 — The quick brown fox, 1,234.56</span>
              <span className="text-dense">Dense 13 — tables and controls, 1,234.56</span>
              <span className="text-xs text-muted-foreground">Caption 12 — labels and hints</span>
              <span className="font-mono text-2xs text-muted-foreground">Mono 11 — ids, codes</span>
              <div className="mt-2 flex items-end gap-2">
                {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((r) => (
                  <div key={r} className={`flex size-12 items-end justify-center border bg-muted pb-0.5 text-2xs text-muted-foreground ${r}`}>
                    {r.replace("rounded-", "")}
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </PageSection>

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Delete this search?"
          description="Businesses found by it stay in the database."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => toast.success("Search deleted")}
        />
      </PageShell>
    </MotionConfig>
  );
}
