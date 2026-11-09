"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { setAgentAction } from "../actions";

/** Asks for the agent's display name once; stored in the `crm_agent` cookie. */
export function AgentNameForm({ campaignName, initialName }: { campaignName: string; initialName?: string }) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(setAgentAction, null);
  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const err = state && !state.ok ? state.fieldErrors?.name : undefined;
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-lg bg-surface p-4 shadow-[var(--shadow-elevated)]">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-xl tracking-tight">Who is calling?</h2>
        <p className="text-sm text-muted-foreground">
          Your name is saved on this browser and recorded with every call in {campaignName}.
        </p>
      </div>
      <form action={formAction} className="grid gap-4">
        <Field data-invalid={!!err || undefined}>
          <FieldLabel htmlFor="agent-name">Your name</FieldLabel>
          <Input
            id="agent-name"
            name="name"
            autoFocus
            autoComplete="name"
            defaultValue={initialName}
            maxLength={60}
            aria-invalid={!!err || undefined}
          />
          <FieldError errors={err?.map((message) => ({ message }))} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Start dialing"}
        </Button>
      </form>
    </div>
  );
}
