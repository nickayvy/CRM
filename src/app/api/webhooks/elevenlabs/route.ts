import { after } from "next/server";
import { getDb } from "@/db/client";
import { type ElevenLabsWebhook, dispatchAiCalls, handleWebhook } from "@/features/calling/ai";
import { createElevenLabsCaller, verifyWebhookSignature } from "@/lib/elevenlabs/client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ElevenLabs post-call webhook (workspace setting). Verifies the
 * ElevenLabs-Signature header, records the call's outcome on its queue item,
 * then (after responding) places the campaign's next AI call so a running AI
 * campaign keeps working through its queue.
 */
export async function POST(req: Request) {
  const secret = env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("elevenlabs-signature"), secret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  let event: ElevenLabsWebhook;
  try {
    event = JSON.parse(raw) as ElevenLabsWebhook;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const db = getDb();
  try {
    const result = await handleWebhook(db, event);
    if (result.handled) {
      after(async () => {
        try {
          await dispatchAiCalls(db, result.campaignId, createElevenLabsCaller());
        } catch (err) {
          console.error("[webhooks/elevenlabs] next dispatch failed", err);
        }
      });
    }
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[webhooks/elevenlabs] failed", err);
    // 500 → ElevenLabs retries.
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
