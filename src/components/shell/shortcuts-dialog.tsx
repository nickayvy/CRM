"use client";

import { KbdGroup } from "@/components/primitives/kbd";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Shortcut = { keys: string[]; label: string };

/** "⌘" on Apple platforms, "Ctrl" elsewhere. Server render and first paint use "⌘". */
export function modKey(): string {
  if (typeof navigator === "undefined") return "⌘";
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}

export function shortcutGroups(mod: string): { title: string; items: Shortcut[] }[] {
  return [
    {
      title: "Global",
      items: [
        { keys: [mod, "K"], label: "Open search and commands" },
        { keys: ["["], label: "Collapse or expand the sidebar" },
        { keys: ["?"], label: "Show this help" },
        { keys: [mod, "/"], label: "Focus the filter search box (tables)" },
      ],
    },
    {
      title: "Tables",
      items: [
        { keys: ["↑", "↓"], label: "Move between rows (also J / K)" },
        { keys: ["Enter"], label: "Open the focused row" },
        { keys: ["X"], label: "Select the focused row" },
      ],
    },
    {
      title: "Dialer",
      items: [
        { keys: ["N"], label: "Claim the next business" },
        { keys: ["1", "–", "8"], label: "Record an outcome (in button order)" },
        { keys: ["S"], label: "Skip to the end of the queue" },
        { keys: ["E"], label: "Focus the call notes" },
        { keys: ["Esc"], label: "Leave the notes field" },
      ],
    },
  ];
}

/** Keyboard shortcut reference, opened with `?`. Shortcuts never fire while typing in a field. */
export function ShortcutsDialog({ open, onOpenChange, mod }: { open: boolean; onOpenChange: (o: boolean) => void; mod: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md" data-testid="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts pause while you type in a field.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {shortcutGroups(mod).map((g) => (
            <section key={g.title} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{g.title}</h3>
              <ul className="flex flex-col divide-y rounded-md border">
                {g.items.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                    <span className="min-w-0">{s.label}</span>
                    <KbdGroup keys={s.keys} className="shrink-0" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
