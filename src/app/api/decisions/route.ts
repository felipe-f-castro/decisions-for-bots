import { NextRequest } from "next/server";
import { sortOpen } from "@/lib/domain";
import { getConfig } from "@/lib/config";
import { apiError, authorize, json, readCreation } from "@/lib/http";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    await authorize(request);
    return json({
      decisions: sortOpen(await getStore().list()),
      mode: getConfig().mock ? "demo" : "appwrite",
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await authorize(request);
    const { input, uploads } = await readCreation(request);
    const decision = await getStore().create(input, uploads);
    return json({ decision }, 201);
  } catch (error) {
    return apiError(error);
  }
}
