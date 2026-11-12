import { NextRequest } from "next/server";
import { validateDecisionId } from "@/lib/domain";
import { apiError, authorizeAgent, json } from "@/lib/http";
import { withAgentMediaUrls } from "@/lib/media";
import { requestOrigin } from "@/lib/origin";
import { getAgentStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await authorizeAgent(request);
    const id = validateDecisionId((await context.params).id);
    const decision = withAgentMediaUrls(
      await getAgentStore().get(id),
      requestOrigin(request.headers, request.url),
    );
    return json({ decision });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await authorizeAgent(request);
    const id = validateDecisionId((await context.params).id);
    await getAgentStore().remove(id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
