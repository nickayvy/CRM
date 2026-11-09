"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { deleteCampaignAction } from "../actions";

/** Delete-with-confirm for one call campaign; returns to /calling on success. */
export function DeleteCampaignButton({ campaignId, name }: { campaignId: string; name: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, start] = React.useTransition();

  const remove = async () => {
    const yes = await confirm({
      title: `Delete ${name}?`,
      description:
        "This removes the campaign, its queue, its call history and AI call records, and its own ElevenLabs agent. Statuses and last-contact dates it set on businesses and leads are rolled back. It cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!yes) return;
    start(async () => {
      const r = await deleteCampaignAction(campaignId);
      if (r.ok) {
        toast.success(`Deleted ${name}`);
        router.push("/calling");
        router.refresh();
      } else toast.error(r.message ?? "Could not delete.");
    });
  };

  return (
    <>
      {dialog}
      <Button size="sm" variant="destructive" onClick={() => void remove()} disabled={pending}>
        <Trash2Icon aria-hidden /> Delete
      </Button>
    </>
  );
}
