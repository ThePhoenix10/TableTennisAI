"use client";

import Link from "next/link";
import Image from "next/image";
import { AccountMenu } from "./account-menu";
import { useSession } from "./session-provider";
import { useUploadAction } from "@/lib/use-upload-action";

export function SiteHeader() {
  const { user, ready, signOut } = useSession();
  const uploadVideo = useUploadAction();

  return (
    <header className="border-border bg-surface border-b">
      <a href="#main" className="focus:bg-brand focus:text-on-brand sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>
      <div className="flex h-16 w-full items-center gap-3 pr-6">
        <Link href="/" className="flex items-center rounded">
          <Image
            src="/PongAILogo.jpeg"
            alt="PongAI"
            width={180}
            height={60}
            className="h-16 w-auto object-contain"
            priority
          />
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <Link href="/how-it-works/" className="border-border hidden rounded border px-3 py-1.5 text-sm sm:inline-block">
            How it works
          </Link>

          <button
            type="button"
            onClick={uploadVideo}
            className="bg-brand text-on-brand hover:bg-brand-hover cursor-pointer rounded px-3 py-1.5 text-sm font-medium"
          >
            Upload video
          </button>

          {ready &&
            (user ? (
              <AccountMenu user={user} onSignOut={signOut} />
            ) : (
              <Link href="/signin/" className="border-border rounded border px-3 py-1.5 text-sm">
                Sign in
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}