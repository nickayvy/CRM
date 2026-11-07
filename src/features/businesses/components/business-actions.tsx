"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { enrichAction } from "@/features/ingest/actions";
import { deleteBusinessAction } from "../actions";

/** Header actions on /businesses/[id]: Enrich from Yelp details, Delete with confirm. */
export function BusinessHeaderActions({ id, name, enriched }: { id: string; name: string; enriched: boolean }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [enriching, startEnrich] = React.useTransition();
  const [deleting, startDelete] = React.useTransition();

  const enrich = () =>
    startEnrich(async () => {
      const r = await enrichAction(id);
      if (r.ok) {
        toast.success(`Enriched: score ${r.data.score}, ${r.data.isClaimed ? "claimed" : "not claimed"}`);
        router.refresh();
      } else toast.error(r.message ?? "Enrichment failed.");
    });

  const remove = async () => {
    const yes = await confirm({
      title: `Delete ${name}?`,
      description: "This removes the business, its activity history and its campaign memberships. It cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!yes) return;
    startDelete(async () => {
      const r = await deleteBusinessAction(id);
      if (r.ok) {
        toast.success(`Deleted ${name}`);
        router.push("/businesses");
      } else toast.error(r.message ?? "Could not delete.");
    });
  };

  return (
    <>
      {dialog}
      <Button size="sm" variant="outline" onClick={enrich} disabled={enriching}>
        <RefreshCwIcon className={enriching ? "animate-spin" : undefined} /> {enriched ? "Re-enrich" : "Enrich"}
      </Button>
      <Button size="sm" variant="destructive" onClick={() => void remove()} disabled={deleting}>
        <Trash2Icon /> Delete
      </Button>
    </>
  );
}
