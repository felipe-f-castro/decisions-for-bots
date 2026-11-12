import { NextRequest } from "next/server";
import { parseStatus, sortOpen } from "@/lib/domain";
import { apiError, authorizeAgent, json, readCreation } from "@/lib/http";
import { getConfig } from "@/lib/config";
import { withAgentMediaUrls } from "@/lib/media";
import { requestOrigin } from "@/lib/origin";
import { getAgentStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    await authorizeAgent(request);
    const status = parseStatus(request.nextUrl.searchParams.get("status"));
    const origin = requestOrigin(request.headers, request.url);
    return json({
      decisions: sortOpen(await getAgentStore().list(status)).map((decision) =>
        withAgentMediaUrls(decision, origin),
      ),
      mode: getConfig().mock ? "demo" : "appwrite",
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorizeAgent(request);
    const { input, uploads } = await readCreation(request);
    const decision = withAgentMediaUrls(
      await getAgentStore().create(input, uploads),
      requestOrigin(request.headers, request.url),
    );
    return json({ decision }, 201);
  } catch (error) {
    return apiError(error);
  }
}
