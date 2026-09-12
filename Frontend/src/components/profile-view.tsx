"use client";

import Link from "next/link";
import { useSession } from "./session-provider";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border flex flex-wrap justify-between gap-2 border-b py-3 last:border-b-0">
      <dt className="text-ink-muted text-sm">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export function ProfileView() {
  const { user, signOut } = useSession();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>

      <div className="rounded-card border-border bg-surface mt-6 border p-6">
        <dl>
          <Row label="Name" value={user.full_name} />
          <Row label="Email" value={user.email} />
          <Row
            label="Member since"
            value={new Date(user.created_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          />
        </dl>
      </div>

      <div className="rounded-card border-border bg-surface mt-6 border p-6">
        <h2 className="text-base font-semibold">Password</h2>
        <p className="text-ink-muted mt-1 text-sm">
          There is no self-service reset yet. Email{" "}
          <a href="mailto:support@pongai.example" className="underline">
            support@pongai.example
          </a>{" "}
          from this address and we will reset it for you.
        </p>
      </div>

      <div className="rounded-card border-border bg-surface mt-6 border p-6">
        <h2 className="text-base font-semibold">Your videos</h2>
        <p className="text-ink-muted mt-1 text-sm">
          Uploads and analyses are private to this account. Original uploads are
          deleted automatically after seven days; analyses stay until you remove
          them.
        </p>
        <Link
          href="/dashboard/"
          className="bg-brand text-on-brand hover:bg-brand-hover mt-4 inline-block rounded px-4 py-2 text-sm font-medium"
        >
          Go to your dashboard
        </Link>
      </div>

      <button
        type="button"
        onClick={signOut}
        className="border-border mt-8 cursor-pointer rounded border px-4 py-2 text-sm font-medium"
      >
        Sign out
      </button>
    </div>
  );
}
