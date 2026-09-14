"use client";

import Link from "next/link";
import { useUploadAction } from "@/lib/use-upload-action";

export function SiteFooter() {
  const uploadVideo = useUploadAction();

  return (
    <footer className="border-border bg-surface mt-20 border-t">
      <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span
                aria-hidden
                className="bg-brand inline-block size-2.5 rounded-full"
              />
              PongAI
            </span>
            <p className="text-ink-muted mt-3 text-sm">
              Table-tennis analysis from body pose alone. No ball tracking, no
              sensors. Just a video of your match.
            </p>
          </div>

          <nav aria-labelledby="footer-product">
            <h2 id="footer-product" className="text-sm font-semibold">
              Product
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <button
                  type="button"
                  onClick={uploadVideo}
                  className="text-ink-muted hover:text-ink cursor-pointer underline"
                >
                  Upload a video
                </button>
              </li>
              <li>
                <Link
                  href="/how-it-works/"
                  className="text-ink-muted hover:text-ink underline"
                >
                  How it works
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-company">
            <h2 id="footer-company" className="text-sm font-semibold">
              Company
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  href="/contact/"
                  className="text-ink-muted hover:text-ink underline"
                >
                  Contact us
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy/"
                  className="text-ink-muted hover:text-ink underline"
                >
                  Privacy policy
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className="text-sm font-semibold">Status</h2>
            <p className="text-ink-muted mt-3 text-sm">
              Shot detection, player attribution and stroke classification are
              measured and published — see{" "}
              <Link href="/how-it-works/" className="underline">
                how it works
              </Link>
              .
            </p>
          </div>
        </div>

        <p className="border-border text-ink-subtle mt-8 border-t pt-6 text-xs">
          © {new Date().getFullYear()} PongAI. A research project, not medical
          or professional coaching advice.
        </p>
      </div>
    </footer>
  );
}
