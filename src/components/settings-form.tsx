"use client";

import { useActionState } from "react";
import { updateSettings } from "@/app/actions";

export function SettingsForm({ areas, webhookUrl }: { areas: string[]; webhookUrl: string }) {
  const [state, action, pending] = useActionState(updateSettings, null);
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
      />
      <p className="field-hint">
        Leave blank to turn delivery off. Public HTTPS only, with no credentials. The signing secret
        is not shown again.
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
