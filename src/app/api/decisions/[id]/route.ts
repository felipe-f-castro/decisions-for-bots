import { NextRequest } from "next/server";
import { validateDecisionId } from "@/lib/domain";
import { apiError, authorize, json, readAnswerMutation } from "@/lib/http";
import { getStore } from "@/lib/store";
import { notifyDecisionAnswered } from "@/lib/answer-webhook";
import { requestOrigin } from "@/lib/origin";
import { readPublicWebhookHealth } from "@/lib/webhook-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

async function decisionId(context: Context) {
  const { id } = await context.params;
  return validateDecisionId(id);
}

export async function GET(request: NextRequest, context: Context) {
  try {
    await authorize(request);
    return json({ decision: await getStore().get(await decisionId(context)) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    await authorize(request);
    const id = await decisionId(context);
    const { mutation, uploads } = await readAnswerMutation(request);
    const decision = await getStore().mutate(id, mutation, uploads);
    if (mutation.action === "answer") {
      let origin = "";
      try {
        origin = requestOrigin(request.headers, request.url);
      } catch {
        origin = "";
      }
      await notifyDecisionAnswered(decision, origin);
    }
    return json({ decision, webhookHealth: await readPublicWebhookHealth() });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    await authorize(request);
    await getStore().remove(await decisionId(context));
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
