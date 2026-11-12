"use client";

import { useActionState } from "react";
import { ArrowRight, KeyRound, Link2, Mail, Tags } from "lucide-react";
import { runSetup } from "@/app/actions";
import { DEFAULT_AREAS } from "@/lib/domain";

const PASSWORD_MIN = 10;

export function SetupForm() {
  const [state, action, pending] = useActionState(runSetup, null);
  if (state && "complete" in state && state.complete) {
    return (
      <div className="login-form">
        <p className="login-success" role="status">
          Setup is complete. Copy these secrets now; they will not be shown again.
        </p>
        <label htmlFor="agent-key">Agent API key</label>
        <textarea id="agent-key" readOnly rows={2} value={state.agentApiKey} />
        <p className="field-hint">
          Send this as <code>Authorization: Bearer</code> to <code>/api/agent/decisions</code>.
        </p>
        <label htmlFor="webhook-secret">Webhook secret</label>
        <textarea id="webhook-secret" readOnly rows={2} value={state.webhookSecret} />
        <p className="field-hint">
          Used for <code>X-Decisions-Signature</code> and the webhook <code>Authorization</code> header.
        </p>
        <a className="button button-primary login-submit" href="/login">
          I have saved these. Continue to sign in
          <ArrowRight size={18} />
        </a>
      </div>
    );
  }
  return (
    <form action={action} className="login-form">
      <label htmlFor="email">Owner email</label>
      <div className="email-input">
        <Mail size={17} aria-hidden="true" />
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          maxLength={254}
        />
      </div>
      <label htmlFor="password">Password</label>
      <div className="email-input">
        <KeyRound size={17} aria-hidden="true" />
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN}
          maxLength={72}
          autoComplete="new-password"
        />
      </div>
      <label htmlFor="confirm">Repeat password</label>
      <div className="email-input">
        <KeyRound size={17} aria-hidden="true" />
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={PASSWORD_MIN}
          maxLength={72}
          autoComplete="new-password"
        />
      </div>
      <p className="field-hint">At least {PASSWORD_MIN} characters.</p>
      <label htmlFor="areas">Decision areas</label>
      <div className="email-input">
        <Tags size={17} aria-hidden="true" />
        <input
          id="areas"
          name="areas"
          defaultValue={DEFAULT_AREAS.join(", ")}
          maxLength={500}
          autoComplete="off"
        />
      </div>
      <p className="field-hint">Comma-separated. Up to 12 names, 40 characters each.</p>
      <label htmlFor="webhookUrl">
        Answer webhook URL <span className="optional">optional</span>
      </label>
      <div className="email-input">
        <Link2 size={17} aria-hidden="true" />
        <input
          id="webhookUrl"
          name="webhookUrl"
          type="url"
          maxLength={2048}
          placeholder="https://example.com/hooks/decisions"
        />
      </div>
      {state && "error" in state && state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button button-primary login-submit" disabled={pending}>
        {pending ? "Creating owner…" : "Create owner and finish setup"}
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
