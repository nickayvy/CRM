import * as React from "react";
import { ArrowRightLeftIcon, CpuIcon, MailIcon, PhoneIcon, StickyNoteIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatRelative } from "@/lib/format";
import type { ActivityType } from "@/db/schema";

export type TimelineProps = {
  className?: string;
  /** `TimelineItem` entries, newest first by convention. */
  children: React.ReactNode;
};

/** Vertical activity feed; a line connects the icon wells of consecutive items. */
export function Timeline({ className, children }: TimelineProps) {
  return (
    <ol data-slot="timeline" className={cn("flex flex-col", className)}>
      {children}
    </ol>
  );
}

const typeIcon: Record<ActivityType, React.ReactNode> = {
  note: <StickyNoteIcon />,
  call: <PhoneIcon />,
  email: <MailIcon />,
  status_change: <ArrowRightLeftIcon />,
  system: <CpuIcon />,
};

export type TimelineItemProps = {
  /** Activity type; picks the default icon and is exposed as `data-type`. */
  type: ActivityType;
  /** When it happened. Shown relative ("5 min ago") with the absolute date in the tooltip. */
  time: Date | string;
  /** Who did it; shown muted after the time as "· name". Omit or null for none. */
  agent?: string | null;
  /** Headline, e.g. "Called, no answer". */
  title?: React.ReactNode;
  /** Body content under the title, e.g. the note text. */
  children?: React.ReactNode;
  /** Replaces the default icon for `type`. */
  icon?: React.ReactNode;
  className?: string;
};

/** One entry in a `Timeline`: icon well, title, relative time, agent and optional body. */
export function TimelineItem({ type, time, agent, title, children, icon, className }: TimelineItemProps) {
  const iso = typeof time === "string" ? time : time.toISOString();
  return (
    <li
      data-slot="timeline-item"
      data-type={type}
      className={cn("group/timeline-item relative flex gap-3 pb-5 last:pb-0", className)}
    >
      <span
        aria-hidden
        className="absolute top-7 bottom-1 left-3 w-px -translate-x-1/2 bg-border group-last/timeline-item:hidden"
      />
      <span
        aria-hidden
        data-slot="timeline-icon"
        className="relative flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5"
      >
        {icon ?? typeIcon[type]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
          {title ? <span className="text-dense font-medium text-foreground">{title}</span> : null}
          <span className="text-muted-foreground">
            <time dateTime={iso} title={formatDate(time)} suppressHydrationWarning>
              {formatRelative(time)}
            </time>
            {agent ? <> · {agent}</> : null}
          </span>
        </div>
        {children ? <div className="text-sm break-words text-foreground/90">{children}</div> : null}
      </div>
    </li>
  );
}
