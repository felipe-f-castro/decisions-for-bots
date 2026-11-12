"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { setPassword } from "@/app/actions";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "@/lib/password";

export function PasswordForm() {
  const [state, action, pending] = useActionState(setPassword, null);
  return (
    <form action={action} className="login-form">
      <label htmlFor="current">Current password</label>
      <div className="email-input">
        <KeyRound size={17} aria-hidden="true" />
        <input
          id="current"
          name="current"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <label htmlFor="password">New password</label>
      <div className="email-input">
        <KeyRound size={17} aria-hidden="true" />
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_BYTES}
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
      </div>
      <p className="field-hint" id="password-hint">
        At least {PASSWORD_MIN_LENGTH} characters.
      </p>
      <label htmlFor="confirm">Repeat it</label>
      <div className="email-input">
        <KeyRound size={17} aria-hidden="true" />
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_BYTES}
          autoComplete="new-password"
        />
      </div>
      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.saved && (
        <p className="login-success" role="status">
          Password saved. Next time, sign in with your email and this password.
        </p>
      )}
      <button className="button button-primary login-submit" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
