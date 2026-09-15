import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-16 sm:px-6 bg-slate-50">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl gradient-brand shadow-md glow-brand text-xl">
              🏓
            </div>
            <h1 className="text-xl font-bold text-slate-900">Create your account</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Upload and analyse your table tennis matches
            </p>
          </div>

          <Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
            <AuthForm mode="signup" />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          The demos are open to everyone — no account needed.
        </p>
      </div>
    </div>
  );
}