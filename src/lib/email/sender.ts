import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import type { Env } from "@/lib/env";

export { renderTemplate, TEMPLATE_TOKENS } from "./template";
export type { TemplateBusiness, TemplateToken } from "./template";

export type OutgoingEmail = { to: string; from: string; subject: string; text: string };

export interface EmailSender {
  send(msg: OutgoingEmail): Promise<{ id: string }>;
  readonly kind: "resend" | "dry_run";
}

/** Calls no network; returns a synthetic id. The runner stores these messages with `status: 'dry_run'`. */
export class DryRunSender implements EmailSender {
  readonly kind = "dry_run" as const;
  async send(msg: OutgoingEmail): Promise<{ id: string }> {
    void msg;
    return { id: `dry_${randomUUID()}` };
  }
}

/** Sends through Resend. Only constructed when RESEND_API_KEY is set. Throws on provider errors. */
export class ResendSender implements EmailSender {
  readonly kind = "resend" as const;
  private readonly client: Resend;
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }
  async send(msg: OutgoingEmail): Promise<{ id: string }> {
    const { data, error } = await this.client.emails.send({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });
    if (error || !data) throw new Error(error?.message ?? "Resend returned no data");
    return { id: data.id };
  }
}

/** ResendSender when RESEND_API_KEY is set, else DryRunSender. */
export function createEmailSender(e: Pick<Env, "RESEND_API_KEY">): EmailSender {
  return e.RESEND_API_KEY ? new ResendSender(e.RESEND_API_KEY) : new DryRunSender();
}

/** Which sender `createEmailSender` would build, without constructing one (for badges). */
export function senderKind(e: Pick<Env, "RESEND_API_KEY">): EmailSender["kind"] {
  return e.RESEND_API_KEY ? "resend" : "dry_run";
}
