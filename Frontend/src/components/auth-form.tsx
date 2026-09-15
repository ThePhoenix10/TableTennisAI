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

function PasswordChecklist({
  rules,
  password,
}: {
  rules: PasswordRule[];
  password: string;
}) {
  return (
    <ul id="password-rules" aria-live="polite" className="mt-3 space-y-2">
      {rules.map((rule) => {
        const met = rule.met(password);
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-2.5 text-xs ${
              met ? "text-slate-800" : "text-slate-400"
            }`}
          >
            <span
              aria-hidden
              className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none transition-colors ${
                met
                  ? "border-green-500 bg-green-500 text-white"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              {met ? "✓" : ""}
            </span>
            {rule.label}
            <span className="sr-only">{met ? " — done" : " — not yet"}</span>
          </li>
        );
      })}
    </ul>
  );
}

const field =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all shadow-sm";
const label = "block text-sm font-medium text-slate-700";

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

  useEffect(() => {
    if (!isSignUp) return;
    let cancelled = false;
    getLimits().then(
      (l) => { if (!cancelled) setLimits(l); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [isSignUp]);

  const rules = passwordRules(limits);
  const passwordOk = allRulesMet(rules, password);
  const filled = email.trim() !== "" && password !== "";
  const canSubmit = !busy && filled && (!isSignUp || passwordOk);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      const session = isSignUp
        ? await signUp({ email, first_name: firstName, last_name: lastName, password })
        : await signIn({ email, password });
      setSession(session.access_token, session.user);
      router.replace(next && next.startsWith("/") ? next : "/");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {isSignUp && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="first">First name</label>
            <input id="first" required autoComplete="given-name" className={`${field} mt-1.5`} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="last">Last name</label>
            <input id="last" required autoComplete="family-name" className={`${field} mt-1.5`} value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
      )}

      <div>
        <label className={label} htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" className={`${field} mt-1.5`} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div>
        <label className={label} htmlFor="password">Password</label>
        <input id="password" type="password" required autoComplete={isSignUp ? "new-password" : "current-password"} aria-describedby={isSignUp ? "password-rules" : undefined} className={`${field} mt-1.5`} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        {isSignUp && <PasswordChecklist rules={rules} password={password} />}
      </div>

      {error && (
        <p aria-live="polite" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        aria-disabled={!canSubmit}
        aria-describedby={isSignUp ? "password-rules" : undefined}
        className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
          canSubmit
            ? "gradient-brand text-white shadow-md hover:opacity-90 cursor-pointer glow-brand"
            : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
        }`}
      >
        {busy ? "Working…" : isSignUp ? "Create account" : "Sign in"}
      </button>

      <p className="text-center text-sm text-slate-500">
        {isSignUp ? (
          <>Already have an account?{" "}<Link href="/signin/" className="text-orange-600 hover:text-orange-700 font-medium transition-colors">Sign in</Link></>
        ) : (
          <>No account?{" "}<Link href="/signup/" className="text-orange-600 hover:text-orange-700 font-medium transition-colors">Create one</Link></>
        )}
      </p>

      {!isSignUp && (
        <p className="text-center text-xs text-slate-400">
          Forgotten your password? Email{" "}
          <a href="mailto:info@sportsforequity.live" className="text-slate-500 hover:text-slate-700 underline transition-colors">
            info@sportsforequity.live
          </a>
        </p>
      )}
    </form>
  );
}