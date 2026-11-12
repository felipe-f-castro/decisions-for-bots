import "server-only";
import { headers } from "next/headers";
import { Client } from "node-appwrite";
import { AppError } from "../domain";
import { getConfig } from "../config";

export async function createAdminClient() {
  const config = getConfig();
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId);
  let headerKey = "";
  try {
    headerKey = (await headers()).get("x-appwrite-key")?.trim() || "";
  } catch {
    headerKey = "";
  }
  const key = headerKey || config.apiKey;
  if (!key)
    throw new AppError(
      "This Appwrite workspace needs a server API key (or a Sites ephemeral key).",
      503,
    );
  client.setKey(key);
  return client;
}
