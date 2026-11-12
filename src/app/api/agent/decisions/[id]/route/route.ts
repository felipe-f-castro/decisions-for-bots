import { NextRequest } from "next/server";
import { AppError, parseMutation, validateDecisionId } from "@/lib/domain";
import { apiError, authorizeAgent, json, readJson } from "@/lib/http";
import { getAgentStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await authorizeAgent(request);
    const id = validateDecisionId((await context.params).id);
    const input = await readJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new AppError("Send a JSON object with expectedRevision.");
    const mutation = parseMutation({ ...input, action: "route" });
    return json({ decision: await getAgentStore().mutate(id, mutation) });
  } catch (error) {
    return apiError(error);
  }
}
