import { NextRequest } from "next/server";
import { validateDecisionId } from "@/lib/domain";
import { apiError, authorizeAgent, json } from "@/lib/http";
import { getAgentStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await authorizeAgent(request);
    const id = validateDecisionId((await context.params).id);
    return json({ decision: await getAgentStore().get(id) });
  } catch (error) {
    return apiError(error);
  }
}
