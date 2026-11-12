"use client";

import { useState } from "react";
import { useActionState } from "react";
import { sendWebhookTest } from "@/app/actions";
import { webhookSetupInstructions } from "@/lib/webhook-instructions";
import { fullDate } from "@/lib/time";
import type { PublicWebhookHealth } from "@/lib/webhook-status";

const INSTRUCTIONS = webhookSetupInstructions();

function statusCopy(health: PublicWebhookHealth) {
  const where =
    health.state === "unconfigured"
      ? ""
      : health.source === "server"
        ? " (server configuration)"
        : "";
  if (health.state === "unconfigured") {
    return {
      label: "Not configured",
      detail: "No webhook URL is saved, so answered cards are not pushed to an assistant.",
    };
  }
  if (health.state === "unknown") {
    return { label: `Not verified${where}`, detail: health.detail };
  }
  if (health.state === "ok") {
    const when = fullDate(health.at);
    const detail =
      health.kind === "test"
        ? `The last connectivity test succeeded on ${when}.`
        : `The last answer notification was delivered on ${when}.`;
    return { label: `Working${where}`, detail };
  }
  const when = fullDate(health.at);
  const what = health.kind === "test" ? "connectivity test" : "answer notification";
  return {
    label: `Last delivery failed${where}`,
    detail: `${health.error} The last ${what} ran on ${when}.`,
  };
}

export function WebhookStatus({
  health,
  allowTest = false,
  compact = false,
}: {
  health: PublicWebhookHealth;
  allowTest?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [testState, testAction, testing] = useActionState(sendWebhookTest, null);
  const current = testState?.health ?? health;
  const copy = statusCopy(current);
  const needsHelp = current.state !== "ok";

  async function copyInstructions() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(INSTRUCTIONS);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <section
      className={`webhook-status webhook-${current.state} ${compact ? "webhook-compact" : ""}`}
      aria-label="Answer notifications"
    >
      <p>
        <strong>{copy.label}</strong>
        <span>{copy.detail}</span>
      </p>
      <div className="webhook-actions">
        {needsHelp && (
          <button
            type="button"
            className="button button-secondary"
            aria-expanded={open}
            onClick={() => {
              setOpen((value) => !value);
              setCopied(false);
              setCopyError(false);
            }}
          >
            {open ? "Hide bot setup instructions" : "How a bot can set this up"}
          </button>
        )}
        {!needsHelp && (
          <button
            type="button"
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide bot setup instructions" : "Bot setup instructions"}
          </button>
        )}
        {allowTest && current.state !== "unconfigured" && (
          <form action={testAction}>
            <button className="button button-primary" type="submit" disabled={testing}>
              {testing ? "Sending test…" : "Send test notification"}
            </button>
          </form>
        )}
        {!allowTest && needsHelp && (
          <a className="text-button" href="/settings">
            Open settings
          </a>
        )}
      </div>
      {testState?.error && (
        <p className="form-error" role="alert">
          {testState.error}
        </p>
      )}
      {testState?.ok && (
        <p className="login-success" role="status">
          Test notification accepted.
        </p>
      )}
      {open && (
        <div className="webhook-instructions">
          <p>Paste this to the assistant that should receive answered decisions.</p>
          <pre tabIndex={0}>{INSTRUCTIONS}</pre>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void copyInstructions()}
          >
            {copied ? "Copied" : "Copy instructions"}
          </button>
          {copyError && (
            <p className="field-hint" role="status">
              Clipboard isn’t available. Select the instructions above and copy them manually.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
