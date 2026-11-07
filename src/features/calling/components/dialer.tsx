"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon, PhoneIcon, PlayIcon, SkipForwardIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  Kbd,
  KeyValue,
  KeyValueList,
  ScoreRing,
  StatusBadge,
  Timeline,
  TimelineItem,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CallOutcome, CampaignStatus, PauseReason } from "@/db/schema";
import { formatDate, formatPhone, formatRating } from "@/lib/format";
import { CAMPAIGN_STATUS_LABELS, OUTCOME_LABELS, PAUSE_REASON_LABELS } from "@/lib/labels";
import { FadeIn, Presence } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { claimNextAction, recordOutcomeAction, resumeAction, skipAction } from "../actions";
import { defaultCallbackValue } from "../time";
import { CALL_OUTCOMES, type CampaignStatusPayload, type DialerCall, type DialerCampaign } from "../types";
import { CallScript } from "./call-script";

export type DialerProps = {
  campaign: DialerCampaign;
  agent: string;
  /** Status poll interval (ms). Default 5000. */
  pollMs?: number;
};

const PAUSE_SHORT: Record<PauseReason, string> = {
  manual: "manual",
  daily_cap: "daily cap",
  outside_hours: "outside hours",
  exhausted: "waiting on callbacks",
};

const OUTCOME_BUTTON_TONE: Partial<Record<CallOutcome, string>> = {
  interested: "border-success/40 hover:bg-success/10",
  do_not_call: "border-destructive/40 text-destructive hover:bg-destructive/10",
  callback: "border-info/40 hover:bg-info/10",
};

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

type Notice = { title: string; description?: string } | null;

/** Keyboard-first dialer workspace: N next, 1–8 outcomes, S skip. */
export function Dialer({ campaign, agent, pollMs = 5000 }: DialerProps) {
  const [status, setStatus] = React.useState<{ status: CampaignStatus; pauseReason: PauseReason | null }>({
    status: campaign.status,
    pauseReason: campaign.pauseReason,
  });
  const [call, setCall] = React.useState<DialerCall | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [notes, setNotes] = React.useState("");
  const [sessionCount, setSessionCount] = React.useState(0);
  const [autoNext, setAutoNext] = React.useState(true);
  const [callbackOpen, setCallbackOpen] = React.useState(false);
  const [callbackValue, setCallbackValue] = React.useState("");
  const [callbackError, setCallbackError] = React.useState<string | null>(null);
  const [busy, startBusy] = React.useTransition();
  const notesRef = React.useRef<HTMLTextAreaElement>(null);

  const running = status.status === "running";

  // Follow pause/resume made elsewhere (campaign page, cron).
  React.useEffect(() => {
    let stopped = false;
    const id = window.setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/calling/${campaign.id}/status`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const body = (await res.json()) as CampaignStatusPayload;
        setStatus((s) =>
          s.status === body.campaign.status && s.pauseReason === body.campaign.pauseReason
            ? s
            : { status: body.campaign.status, pauseReason: body.campaign.pauseReason },
        );
      } catch {
        // try again next tick
      }
    }, pollMs);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [campaign.id, pollMs]);

  const claim = React.useCallback(() => {
    startBusy(async () => {
      const r = await claimNextAction(campaign.id);
      if (!r.ok) {
        toast.error(r.message ?? "Could not claim the next call.");
        return;
      }
      const d = r.data;
      if (d.ok) {
        setCall({ item: d.item, business: d.business, history: d.history, recent: d.recent });
        setNotes(d.item.notes ?? "");
        setNotice(null);
        setStatus({ status: "running", pauseReason: null });
        return;
      }
      setCall(null);
      setStatus({ status: d.campaign.status, pauseReason: d.campaign.pauseReason });
      if (d.reason === "empty") {
        setNotice({ title: "No calls available right now", description: "Other agents hold the remaining calls, or callbacks are not due yet." });
      } else if (d.reason === "agent_limit") {
        setNotice({ title: "Agent limit reached", description: "This campaign already has its maximum number of agents dialing. Try again in a minute." });
      } else {
        setNotice(null);
      }
    });
  }, [campaign.id]);

  const submitOutcome = React.useCallback(
    (outcome: CallOutcome, callbackAt?: string) => {
      if (!call) return;
      const itemId = call.item.id;
      const fd = new FormData();
      fd.set("outcome", outcome);
      fd.set("notes", notes);
      if (callbackAt) fd.set("callbackAt", callbackAt);
      startBusy(async () => {
        const r = await recordOutcomeAction(itemId, null, fd);
        if (!r.ok) {
          if (outcome === "callback" && r.fieldErrors?.callbackAt) {
            setCallbackError(r.message ?? "Pick a date and time.");
            return;
          }
          toast.error(r.message ?? "Could not record the outcome.");
          return;
        }
        setSessionCount((n) => n + 1);
        setCallbackOpen(false);
        setCall(null);
        setNotes("");
        toast.success(`${OUTCOME_LABELS[outcome].label} · ${call.business.name}`);
        if (autoNext) {
          const next = await claimNextAction(campaign.id);
          if (next.ok && next.data.ok) {
            const d = next.data;
            setCall({ item: d.item, business: d.business, history: d.history, recent: d.recent });
            setNotes(d.item.notes ?? "");
            setNotice(null);
          } else if (next.ok && !next.data.ok) {
            const d = next.data;
            setStatus({ status: d.campaign.status, pauseReason: d.campaign.pauseReason });
            setNotice(
              d.reason === "empty"
                ? { title: "No calls available right now", description: "Other agents hold the remaining calls, or callbacks are not due yet." }
                : d.reason === "agent_limit"
                  ? { title: "Agent limit reached", description: "Try again in a minute." }
                  : null,
            );
          }
        }
      });
    },
    [call, notes, autoNext, campaign.id],
  );

  const chooseOutcome = React.useCallback(
    (outcome: CallOutcome) => {
      if (!call || busy) return;
      if (outcome === "callback") {
        setCallbackValue(defaultCallbackValue(new Date(), campaign.timezone));
        setCallbackError(null);
        setCallbackOpen(true);
        return;
      }
      submitOutcome(outcome);
    },
    [call, busy, campaign.timezone, submitOutcome],
  );

  const skip = React.useCallback(() => {
    if (!call || busy) return;
    const itemId = call.item.id;
    startBusy(async () => {
      const r = await skipAction(itemId);
      if (!r.ok) {
        toast.error(r.message ?? "Could not skip.");
        return;
      }
      setCall(null);
      setNotes("");
      toast(`Skipped ${call.business.name}`);
      if (autoNext) claim();
    });
  }, [call, busy, autoNext, claim]);

  const resume = React.useCallback(() => {
    startBusy(async () => {
      const r = await resumeAction(campaign.id);
      if (!r.ok) {
        toast.error(r.message ?? "Could not resume.");
        return;
      }
      setStatus({ status: r.data.status as CampaignStatus, pauseReason: r.data.pauseReason as PauseReason | null });
      setNotice(null);
    });
  }, [campaign.id]);

  // Global shortcuts; ignored while typing (notes, callback picker) or with modifiers.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || callbackOpen) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        if (!call && running && !busy) {
          e.preventDefault();
          claim();
        }
      } else if (k === "s") {
        if (call) {
          e.preventDefault();
          skip();
        }
      } else if (/^[1-8]$/.test(e.key)) {
        if (call) {
          e.preventDefault();
          chooseOutcome(CALL_OUTCOMES[Number(e.key) - 1]);
        }
      } else if (k === "e" && call) {
        e.preventDefault();
        notesRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [call, running, busy, callbackOpen, claim, skip, chooseOutcome]);

  const b = call?.business;

  return (
    <div className="grid gap-4" data-testid="dialer">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2 text-sm">
        <Button size="icon-sm" variant="ghost" asChild>
          <Link href={`/calling/${campaign.id}`} aria-label="Back to campaign">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <span className="min-w-0 truncate font-medium">{campaign.name}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <UserIcon className="size-3.5" aria-hidden /> {agent}
        </span>
        <span className="text-muted-foreground" data-testid="session-count">
          This session: <span className="font-medium text-foreground tabular-nums">{sessionCount}</span>
        </span>
        <span data-testid="dialer-status">
          {running ? (
            <StatusBadge label={CAMPAIGN_STATUS_LABELS.running} />
          ) : status.status === "paused" && status.pauseReason ? (
            <StatusBadge tone="warning">Paused ({PAUSE_SHORT[status.pauseReason]})</StatusBadge>
          ) : (
            <StatusBadge label={CAMPAIGN_STATUS_LABELS[status.status]} />
          )}
        </span>
        <label className="ml-auto flex items-center gap-2 text-muted-foreground">
          <Switch checked={autoNext} onCheckedChange={setAutoNext} aria-label="Auto-next" />
          Auto-next
        </label>
      </div>

      <Presence mode="wait">
        {call && b ? (
          <FadeIn key={call.item.id} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Left: business + outcome */}
            <div className="grid min-w-0 content-start gap-4">
              <Card>
                <CardHeader className="gap-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-lg" data-testid="dialer-business-name">
                        {b.name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {[b.city, b.state].filter(Boolean).join(", ")}
                        {b.categories?.[0]?.title ? ` · ${b.categories[0].title}` : ""}
                      </p>
                    </div>
                    <ScoreRing value={b.score} size={44} />
                  </div>
                  {b.phone ? (
                    <a
                      href={`tel:${b.phone}`}
                      className="mt-2 inline-flex w-fit items-center gap-2 text-2xl font-semibold tracking-tight tabular-nums hover:underline sm:text-3xl"
                    >
                      <PhoneIcon className="size-5" aria-hidden />
                      {formatPhone(b.phone)}
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">No phone number</p>
                  )}
                </CardHeader>
                <CardContent className="grid gap-4">
                  <KeyValueList>
                    <KeyValue label="Rating">
                      {formatRating(b.rating)} · {b.reviewCount} reviews
                    </KeyValue>
                    <KeyValue label="Owner">{b.ownerName ?? "—"}</KeyValue>
                    <KeyValue label="Attempt">
                      {call.item.attempts + 1} of {campaign.maxAttempts}
                    </KeyValue>
                    <KeyValue label="Queue position">#{call.item.position}</KeyValue>
                  </KeyValueList>
                  {call.history.length ? (
                    <div className="grid gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Previous outcomes in this campaign</p>
                      <div className="flex flex-wrap gap-1.5">
                        {call.history.map((h) => (
                          <StatusBadge
                            key={h.id}
                            variant="dot"
                            label={h.outcome && h.outcome in OUTCOME_LABELS ? OUTCOME_LABELS[h.outcome as CallOutcome] : undefined}
                            title={`${formatDate(h.occurredAt, campaign.timezone)}${h.agent ? ` · ${h.agent}` : ""}`}
                          >
                            {`${h.outcome && h.outcome in OUTCOME_LABELS ? OUTCOME_LABELS[h.outcome as CallOutcome].label : (h.outcome ?? "Call")} · ${formatDate(h.occurredAt, campaign.timezone)}`}
                          </StatusBadge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="@container grid gap-3">
                  <label htmlFor="dialer-notes" className="flex items-center justify-between text-sm font-medium">
                    Notes
                    <span className="text-xs font-normal text-muted-foreground">
                      <Kbd>E</Kbd> to type · <Kbd>Esc</Kbd> to leave
                    </span>
                  </label>
                  <Textarea
                    id="dialer-notes"
                    ref={notesRef}
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") e.currentTarget.blur();
                    }}
                    placeholder="What happened on the call?"
                  />
                  <div className="grid grid-cols-2 gap-2 @md:grid-cols-4" role="group" aria-label="Outcomes">
                    {CALL_OUTCOMES.map((o, i) => (
                      <Button
                        key={o}
                        variant="outline"
                        disabled={busy}
                        onClick={() => chooseOutcome(o)}
                        className={cn("h-auto min-w-0 justify-start gap-2 px-2.5 py-2 text-left", OUTCOME_BUTTON_TONE[o])}
                        data-outcome={o}
                      >
                        <Kbd>{i + 1}</Kbd>
                        <span className="truncate">{OUTCOME_LABELS[o].label}</span>
                      </Button>
                    ))}
                  </div>

                  <Presence>
                    {callbackOpen ? (
                      <FadeIn key="callback">
                        <form
                          className="grid gap-2 rounded-md border bg-muted/40 p-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!callbackValue) {
                              setCallbackError("Pick a date and time.");
                              return;
                            }
                            submitOutcome("callback", callbackValue);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setCallbackOpen(false);
                            }
                          }}
                        >
                          <label htmlFor="callback-at" className="text-sm font-medium">
                            Call back at{" "}
                            <span className="font-normal text-muted-foreground">({campaign.timezone.replace(/_/g, " ")} time)</span>
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              id="callback-at"
                              type="datetime-local"
                              autoFocus
                              value={callbackValue}
                              onChange={(e) => setCallbackValue(e.target.value)}
                              className="w-auto min-w-0 flex-1"
                              aria-invalid={!!callbackError || undefined}
                            />
                            <Button type="submit" disabled={busy}>
                              Save callback
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setCallbackOpen(false)}>
                              Cancel
                            </Button>
                          </div>
                          {callbackError ? (
                            <p role="alert" className="text-sm text-destructive">
                              {callbackError}
                            </p>
                          ) : null}
                        </form>
                      </FadeIn>
                    ) : null}
                  </Presence>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={skip} disabled={busy}>
                      <SkipForwardIcon aria-hidden /> Skip <Kbd>S</Kbd>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: script + history */}
            <div className="grid min-w-0 content-start gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Script</CardTitle>
                </CardHeader>
                <CardContent>
                  <CallScript script={campaign.script} business={b} agent={agent} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Recent activity</CardTitle>
                </CardHeader>
                <CardContent>
                  {call.recent.length ? (
                    <Timeline>
                      {call.recent.map((a) => (
                        <TimelineItem
                          key={a.id}
                          type={a.type}
                          time={a.occurredAt}
                          agent={a.agent}
                          title={a.outcome && a.outcome in OUTCOME_LABELS ? OUTCOME_LABELS[a.outcome as CallOutcome].label : undefined}
                        >
                          {a.body || null}
                        </TimelineItem>
                      ))}
                    </Timeline>
                  ) : (
                    <p className="text-sm text-muted-foreground">No activity yet.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </FadeIn>
        ) : (
          <FadeIn key={running ? "idle" : `stopped-${status.status}-${status.pauseReason ?? ""}`}>
            {running ? (
              <EmptyState
                bordered
                icon={<PhoneIcon />}
                title={notice?.title ?? "Ready when you are"}
                description={notice?.description ?? "Press N to get the next business."}
                action={
                  <Button onClick={claim} disabled={busy} data-testid="dialer-next">
                    {busy ? "Claiming…" : "Next"} <Kbd>N</Kbd>
                  </Button>
                }
              />
            ) : (
              <EmptyState
                bordered
                icon={<PhoneIcon />}
                title={
                  status.status === "paused" && status.pauseReason
                    ? `Paused (${PAUSE_SHORT[status.pauseReason]})`
                    : status.status === "completed"
                      ? "Campaign completed"
                      : "Campaign not started"
                }
                description={
                  status.status === "paused" && status.pauseReason
                    ? `${PAUSE_REASON_LABELS[status.pauseReason].label}. ${
                        status.pauseReason === "manual" ? "Resume to keep dialing." : "It resumes automatically."
                      }`
                    : status.status === "completed"
                      ? "Every business in the queue has an outcome."
                      : "Start the campaign from its page."
                }
                action={
                  status.status === "paused" && status.pauseReason === "manual" ? (
                    <Button onClick={resume} disabled={busy}>
                      <PlayIcon aria-hidden /> Resume
                    </Button>
                  ) : (
                    <Button variant="outline" asChild>
                      <Link href={`/calling/${campaign.id}`}>Open campaign</Link>
                    </Button>
                  )
                }
              />
            )}
          </FadeIn>
        )}
      </Presence>

      <p className="hidden text-xs text-muted-foreground sm:block">
        Shortcuts: <Kbd>N</Kbd> next · <Kbd>1</Kbd>–<Kbd>8</Kbd> outcome · <Kbd>S</Kbd> skip · <Kbd>E</Kbd> notes. Shortcuts pause while you type.
      </p>
    </div>
  );
}
