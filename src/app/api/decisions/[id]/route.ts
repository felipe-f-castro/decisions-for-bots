import { NextRequest } from "next/server";
import { parseMutation, validateDecisionId } from "@/lib/domain";
import { apiError, authorize, json, readJson } from "@/lib/http";
import { getStore } from "@/lib/store";
import { notifyDecisionAnswered } from "@/lib/answer-webhook";
import { readPublicWebhookHealth } from "@/lib/webhook-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
    const mutation = parseMutation(await readJson(request));
    const decision = await getStore().mutate(id, mutation);
    if (mutation.action === "answer") await notifyDecisionAnswered(decision);
    return json({ decision, webhookHealth: await readPublicWebhookHealth() });
  } catch (error) {
    return apiError(error);
  }
}
