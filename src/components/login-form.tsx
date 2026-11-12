"use client";

import { useActionState } from "react";
import { ArrowRight, KeyRound, Mail } from "lucide-react";
import { signInWithPassword } from "@/app/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInWithPassword, null);
  return (
    <form action={action} className="login-form">
      <label htmlFor="email">Your email</label>
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
      <label htmlFor="password" className="password-label">
        Password
      </label>
      <div className="email-input">
        <KeyRound size={17} aria-hidden="true" />
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="Your password"
          maxLength={72}
        />
      </div>
      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button button-primary login-submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
        <ArrowRight size={18} />
      </button>
      <p className="field-hint login-hint">
        There is no public sign-up. The first owner is created on the setup page.
      </p>
    </form>
  );
}
