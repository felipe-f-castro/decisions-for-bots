import { redirect } from "next/navigation";
import { ArrowUpRight, Check, LockKeyhole, Sparkles } from "lucide-react";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { getAccess } from "@/lib/auth";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  let destination = "";
  let configured = true;
  try {
    getConfig();
    const access = await getAccess();
    if (access.kind === "demo" || access.kind === "allowed") destination = "/";
    if (access.kind === "denied") destination = "/not-authorized";
    if (access.kind === "needs-setup") destination = "/setup";
  } catch {
    configured = false;
  }
  if (destination) redirect(destination);
  const { error } = await searchParams;
  return (
    <main className="login-page">
      <div className="login-brand">
        <Brand />
      </div>
      <section className="login-shell">
        <div className="login-story">
          <span className="eyebrow">
            <span className="tiny-star">✳</span> LESS BACK-AND-FORTH. MORE FORWARD.
          </span>
          <h1>
            Small choices.
            <br />
            <span>Big momentum.</span>
          </h1>
          <p>
            Your assistants have a few questions.
            <br />
            Give them a little direction, and get back to your day.
          </p>
          <div className="login-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="floating-choice">
              <span className="floating-dot" />
              <span>A clear next step</span>
              <span className="floating-check">
                <Check size={17} />
              </span>
            </div>
            <div className="art-star">
              <Sparkles size={29} strokeWidth={1.4} />
            </div>
            <div className="art-arrow">
              <ArrowUpRight size={46} strokeWidth={1.5} />
            </div>
          </div>
          <span className="story-caption">A little clarity goes a long way.</span>
        </div>
        <div className="login-panel">
          <span className="welcome-avatar">
            YOU
            <span />
          </span>
          <div className="login-eyebrow">YOUR PERSONAL WORKSPACE</div>
          <h2>Welcome to Decisions.</h2>
          <p className="login-description">Let’s get a few things moving.</p>
          {configured ? (
            <>
              {error && (
                <p className="form-error" role="alert">
                  Sign-in could not be completed. Please try again.
                </p>
              )}
              <LoginForm />
            </>
          ) : (
            <p className="form-error" role="alert">
              Your workspace needs setup. Ask its owner to finish configuring Appwrite, or open
              the first-run setup page.
            </p>
          )}
          <p className="login-privacy">
            <LockKeyhole size={13} /> Just you and your next good decision.
          </p>
        </div>
      </section>
      <footer className="login-footer">
        Made for a clearer headspace.<span>One person. One inbox. Your call.</span>
      </footer>
    </main>
  );
}
