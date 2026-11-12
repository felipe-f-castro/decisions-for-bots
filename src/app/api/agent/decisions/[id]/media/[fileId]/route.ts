import { NextRequest } from "next/server";
import { AppError, validateDecisionId } from "@/lib/domain";
import { apiError, authorizeAgent } from "@/lib/http";
import { mediaResponse } from "@/lib/media";
import { getAgentStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fileId(value: string) {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new AppError("This file could not be found.", 404);
  return value;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    await authorizeAgent(request);
    const params = await context.params;
    const media = await getAgentStore().readAnswerMedia(
      validateDecisionId(params.id),
      fileId(params.fileId),
    );
    if (!media) throw new AppError("This file could not be found.", 404);
    return mediaResponse(media, request);
  } catch (error) {
    return apiError(error);
  }
}
