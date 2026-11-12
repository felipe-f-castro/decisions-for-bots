import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getAccess, type Access } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { AREAS, type Decision } from "@/lib/domain";
import { getDecisionAreas } from "@/lib/appwrite/settings";
import { readPublicWebhookHealth } from "@/lib/webhook-health";

export const dynamic = "force-dynamic";

export default async function Home() {
  let access: Access;
  try {
    access = await getAccess();
  } catch {
    redirect("/login");
  }
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "needs-setup") redirect("/setup");
  if (access.kind === "denied") redirect("/not-authorized");
  let initialDecisions: Decision[] | undefined;
  let initialError = "";
  try {
    initialDecisions = await getStore().list();
  } catch {
    initialError = "We couldn’t load your inbox. Please try refreshing in a moment.";
  }
  const areas =
    access.kind === "demo" ? [...AREAS] : await getDecisionAreas().catch(() => [...AREAS]);
  const webhookHealth = access.kind === "demo" ? null : await readPublicWebhookHealth();
  // This dynamic Server Component samples the request time once for hydration.
  // eslint-disable-next-line react-hooks/purity
  const initialNow = Date.now();
  return (
    <Dashboard
      mode={access.kind === "demo" ? "demo" : "appwrite"}
      areas={areas}
      initialNow={initialNow}
      initialDecisions={initialDecisions}
      initialError={initialError}
      webhookHealth={webhookHealth}
    />
  );
}
