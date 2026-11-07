"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { requalifyAllAction } from "@/features/ingest/actions";

/** Header action on /settings/rules: re-runs the qualification engine over every business. */
export function RequalifyButton() {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = React.useTransition();

  const run = async () => {
    const yes = await confirm({
      title: "Re-qualify all businesses?",
      description:
        "This re-runs the saved rules over every business and may change their qualified, review and rejected results. Save any rule edits first.",
      confirmLabel: "Re-qualify all",
    });
    if (!yes) return;
    startTransition(async () => {
      const r = await requalifyAllAction();
      if (r.ok) {
        const { qualified, review, rejected } = r.data;
        toast.success(`Re-qualified: ${qualified} qualified · ${review} review · ${rejected} rejected`);
        router.refresh();
      } else toast.error(r.message ?? "Re-qualification failed.");
    });
  };

  return (
    <>
      {dialog}
      <Button size="sm" variant="outline" onClick={() => void run()} disabled={pending}>
        <RefreshCwIcon className={pending ? "animate-spin" : undefined} /> {pending ? "Re-qualifying…" : "Re-qualify all"}
      </Button>
    </>
  );
}
