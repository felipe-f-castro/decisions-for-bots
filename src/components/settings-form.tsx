"use client";

import { useState } from "react";
import { useActionState } from "react";
import { updateSettings } from "@/app/actions";

export function SettingsForm({ areas, webhookUrl }: { areas: string[]; webhookUrl: string }) {
  const [state, action, pending] = useActionState(updateSettings, null);
  const [secret, setSecret] = useState("");
  const [applied, setApplied] = useState(state);
  if (state !== applied) {
    setApplied(state);
    if (state?.saved) setSecret("");
  }
  return (
    <form action={action} className="login-form">
      <label htmlFor="areas">Decision areas</label>
      <input id="areas" name="areas" defaultValue={areas.join(", ")} maxLength={500} />
      <p className="field-hint">Comma-separated. Up to 12 names, 40 characters each.</p>
      <label htmlFor="webhookUrl">Answer webhook URL</label>
      <input
        id="webhookUrl"
        name="webhookUrl"
        type="url"
        defaultValue={webhookUrl}
        maxLength={2048}
        placeholder="https://example.com/hooks/decisions"
        spellCheck={false}
      />
      <p className="field-hint">
        Leave blank to turn off delivery. Use HTTPS, with no username or password in the URL.
      </p>
      <label htmlFor="webhookSecret">Webhook secret</label>
      <input
        id="webhookSecret"
        name="webhookSecret"
        type="password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        maxLength={256}
        autoComplete="off"
        spellCheck={false}
        placeholder="Leave blank to keep the current secret"
      />
      <p className="field-hint">
        Write-only. 16 to 256 characters. Never shown again. Changing it marks notifications as not
        verified until the next test.
      </p>
      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.saved && (
        <p className="login-success" role="status">
          Settings saved.
        </p>
      )}
      <button className="button button-primary login-submit" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
