"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApiError, signIn, signUp } from "@/lib/api";
import { setSession } from "@/lib/auth";

/** Mirrors `password_problems` in core/auth.py. The rule lives in the backend;
 *  this exists so the message arrives before a round trip, not instead of one. */
const MIN_LENGTH = 8;
const SPECIALS = "!@#$%^&*()_+-=[]{}|;:',.<>?/`~\"\\";

export function passwordProblems(password: string): string[] {
  const out: string[] = [];
  if (password.length < MIN_LENGTH)
    out.push(`be at least ${MIN_LENGTH} characters`);
  if (!/[A-Z]/.test(password)) out.push("contain an uppercase letter");
  if (![...password].some((c) => SPECIALS.includes(c)))
    out.push("contain a special character");
  return out;
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
  const [touched, setTouched] = useState(false);

  const problems = isSignUp && touched ? passwordProblems(password) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSignUp) {
      const p = passwordProblems(password);
      if (p.length) {
        setTouched(true);
        return;
      }
    }

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
          aria-describedby={isSignUp ? "password-rule" : undefined}
          className={`${field} mt-1`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        {isSignUp && (
          <p id="password-rule" className="text-ink-muted mt-1 text-xs">
            At least {MIN_LENGTH} characters, with an uppercase letter and a
            special character.
          </p>
        )}
        {problems.length > 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--color-attack)" }}>
            The password must {problems.join(", ")}.
          </p>
        )}
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
        disabled={busy}
        className="bg-brand text-on-brand hover:bg-brand-hover w-full cursor-pointer rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
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
