"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, getLimits, signIn, signUp } from "@/lib/api";
import type { Limits } from "@/lib/api-types";
import { setSession } from "@/lib/auth";
import {
  allRulesMet,
  passwordRules,
  type PasswordRule,
} from "@/lib/password-rules";

/**
 * The rules, ticking as you type.
 *
 * Each row states its own state in words as well as a glyph, so the list is
 * readable without relying on the tick's colour. `aria-live="polite"` on the
 * group announces a rule being satisfied without interrupting typing; the
 * individual rows are not live, or every keystroke would be narrated.
 */
function PasswordChecklist({
  rules,
  password,
}: {
  rules: PasswordRule[];
  password: string;
}) {
  return (
    <ul id="password-rules" aria-live="polite" className="mt-2 space-y-1">
      {rules.map((rule) => {
        const met = rule.met(password);
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-2 text-xs ${
              met ? "text-ink" : "text-ink-muted"
            }`}
          >
            <span
              aria-hidden
              className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${
                met ? "text-white" : "border-border"
              }`}
              style={
                met
                  ? {
                      backgroundColor: "var(--color-control)",
                      borderColor: "var(--color-control)",
                    }
                  : undefined
              }
            >
              {met ? "✓" : ""}
            </span>
            {rule.label}
            {/* The state in words, for anyone not seeing the tick. */}
            <span className="sr-only">{met ? " — done" : " — not yet"}</span>
          </li>
        );
      })}
    </ul>
  );
}

const field =
  "border-border bg-surface w-full rounded border px-3 py-2 text-sm";
const label = "block text-sm font-medium";

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const isSignUp = mode === "signup";

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);

  // The rules come from the API. Until they arrive the fallback is the
  // strictest reading, so the form is never more permissive than the server.
  useEffect(() => {
    if (!isSignUp) return;
    let cancelled = false;
    getLimits().then(
      (l) => {
        if (!cancelled) setLimits(l);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [isSignUp]);

  const rules = passwordRules(limits);
  const passwordOk = allRulesMet(rules, password);
  const canSubmit = !busy && (!isSignUp || passwordOk);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSignUp && !passwordOk) return;

    setBusy(true);
    try {
      const session = isSignUp
        ? await signUp({
            email,
            first_name: firstName,
            last_name: lastName,
            password,
          })
        : await signIn({ email, password });
      setSession(session.access_token, session.user);
      // replace, not push: the back button should not return to a form the
      // user has already completed.
      router.replace(next && next.startsWith("/") ? next : "/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {isSignUp && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="first">
              First name
            </label>
            <input
              id="first"
              required
              autoComplete="given-name"
              className={`${field} mt-1`}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div>
            <label className={label} htmlFor="last">
              Last name
            </label>
            <input
              id="last"
              required
              autoComplete="family-name"
              className={`${field} mt-1`}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>
      )}

      <div>
        <label className={label} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className={`${field} mt-1`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className={label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete={isSignUp ? "new-password" : "current-password"}
          aria-describedby={isSignUp ? "password-rules" : undefined}
          className={`${field} mt-1`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {isSignUp && <PasswordChecklist rules={rules} password={password} />}
      </div>

      {error && (
        <p
          aria-live="polite"
          className="rounded border p-3 text-sm"
          style={{
            color: "var(--color-attack)",
            borderColor: "var(--color-attack)",
          }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        // aria-disabled rather than disabled: a disabled button cannot be
        // focused and screen readers skip past it, so someone tabbing through
        // would never learn the form exists to be completed. This stays
        // reachable and announces itself as unavailable; submit() returns
        // early, and the checklist above says what is missing.
        aria-disabled={!canSubmit}
        aria-describedby={isSignUp ? "password-rules" : undefined}
        className={`bg-brand text-on-brand w-full rounded px-4 py-2 text-sm font-medium ${
          canSubmit
            ? "hover:bg-brand-hover cursor-pointer"
            : "cursor-not-allowed opacity-50"
        }`}
      >
        {busy ? "Working…" : isSignUp ? "Create account" : "Sign in"}
      </button>

      <p className="text-ink-muted text-sm">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/signin/" className="text-brand-text underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account?{" "}
            <Link href="/signup/" className="text-brand-text underline">
              Create one
            </Link>
          </>
        )}
      </p>

      {!isSignUp && (
        // No reset flow yet, so this says what to do rather than linking to
        // something that does not exist.
        <p className="text-ink-subtle text-xs">
          Forgotten your password? Email{" "}
          <a href="mailto:support@pongai.example" className="underline">
            support@pongai.example
          </a>{" "}
          and we will reset it for you.
        </p>
      )}
    </form>
  );
}
