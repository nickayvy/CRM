import { StatusBadge as ToneBadge } from "@/components/primitives/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CallHistoryRow } from "@/features/leads/types";
import { OUTCOME_LABELS } from "@/lib/labels";

/** Dialer call activities on the user's leads, newest first. */
export function CallHistoryTable({ calls }: { calls: CallHistoryRow[] }) {
  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg bg-surface py-16" data-testid="history-empty">
        <p className="font-serif text-lg text-muted-foreground">No conversations yet</p>
        <p className="mt-3 text-sm text-muted-foreground">Calls logged in the dialer on your leads show up here.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg bg-surface shadow-[var(--shadow-elevated)]">
      <Table data-testid="history-table">
        <TableHeader>
          <TableRow>
            <TableHead>Business</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="max-w-[200px] truncate">{c.businessName}</TableCell>
              <TableCell>
                {c.outcome ? <ToneBadge label={OUTCOME_LABELS[c.outcome]} /> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{c.agent ?? "—"}</TableCell>
              <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={c.notes || undefined}>
                {c.notes || "—"}
              </TableCell>
              <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                <time dateTime={c.occurredAt} title={c.occurredAt}>
                  {c.relative}
                </time>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
