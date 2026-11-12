import { getConfig } from "@/lib/config";
import { getStore } from "@/lib/store";
import type { MockStore } from "@/lib/stores/mock";
import { validateDecisionId } from "@/lib/domain";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!getConfig().mock) return new Response(null, { status: 404 });
    const id = validateDecisionId((await context.params).id);
    const image = (getStore() as MockStore).getImage(id);
    if (!image) return new Response(null, { status: 404 });
    // Keep binary demo bytes out of decision JSON (and Vercel response limits).
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
