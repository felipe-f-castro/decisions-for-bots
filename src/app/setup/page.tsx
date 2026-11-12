import { redirect, unstable_rethrow } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Brand } from "@/components/brand";
import { SetupForm } from "@/components/setup-form";
import { getAccess } from "@/lib/auth";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  let destination = "";
  try {
    const config = getConfig();
    if (config.mock) destination = "/";
    else {
      const access = await getAccess();
      if (access.kind === "allowed") destination = "/";
      else if (access.kind === "denied") destination = "/not-authorized";
      else if (access.kind === "signed-out") destination = "/login";
    }
  } catch (error) {
    // redirect() throws. Never treat that as a configuration failure.
    unstable_rethrow(error);
  }
  if (destination) redirect(destination);
  return (
    <main className="login-page">
      <div className="login-brand">
        <Brand />
      </div>
      <section className="login-shell">
        <div className="login-panel">
          <div className="login-eyebrow">FIRST-RUN SETUP</div>
          <h2>Create the workspace owner.</h2>
          <p className="login-description">
            This page is available only until an owner exists. Enter the installation token from the
            server configuration. Setup creates your account, stores your areas, and shows the agent
            API key and webhook secret once.
          </p>
          <SetupForm />
          <p className="login-privacy">
            <LockKeyhole size={13} /> No public sign-up. After this, only allowlisted emails can
            sign in.
          </p>
        </div>
      </section>
    </main>
  );
}
