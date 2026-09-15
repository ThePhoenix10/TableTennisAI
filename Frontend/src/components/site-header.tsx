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
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm">
      <a href="#main" className="focus:bg-brand focus:text-on-brand sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>
      <div className="flex h-16 w-full items-center gap-4 pr-6">
        <Link href="/" className="flex items-center bg-white">
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
          <Link
            href="/how-it-works/"
            className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors sm:inline-block"
          >
            How it works
          </Link>

          <button
            type="button"
            onClick={uploadVideo}
            className="cursor-pointer rounded-lg gradient-brand px-4 py-2 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-opacity glow-brand"
          >
            Upload video
          </button>

          {ready &&
            (user ? (
              <AccountMenu user={user} onSignOut={signOut} />
            ) : (
              <Link
                href="/signin/"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              >
                Sign in
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}