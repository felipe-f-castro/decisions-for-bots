import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { SettingsForm } from "@/components/settings-form";
import { getAccess } from "@/lib/auth";
import { getSettings } from "@/lib/appwrite/settings";
import { DEFAULT_AREAS } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await getAccess().catch(() => ({ kind: "signed-out" as const }));
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "needs-setup") redirect("/setup");
  if (access.kind === "denied") redirect("/not-authorized");
  if (access.kind === "demo") {
    return (
      <main className="error-page password-page">
        <Brand />
        <h1>Workspace settings.</h1>
        <p>Settings are not used in demo mode.</p>
        <Link className="text-button" href="/">
          Back to your inbox
        </Link>
      </main>
    );
  }
  const settings = await getSettings();
  return (
    <main className="error-page password-page">
      <Brand />
      <h1>Workspace settings.</h1>
      <p>Update the areas shown in the inbox and the URL that receives answered-decision webhooks.</p>
      <SettingsForm
        areas={settings?.areas ?? [...DEFAULT_AREAS]}
        webhookUrl={settings?.webhookUrl ?? ""}
      />
      <Link className="text-button" href="/">
        Back to your inbox
      </Link>
    </main>
  );
}
