"use client";

import Link from "next/link";
import Image from "next/image";
import { useUploadAction } from "@/lib/use-upload-action";

export function SiteFooter() {
  const uploadVideo = useUploadAction();

  return (
    <footer className="mt-24 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center">
              <Image
                src="/PongAILogo.jpeg"
                alt="PongAI"
                width={150}
                height={50}
                className="h-12 w-auto object-contain"
              />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-slate-500">
              Table-tennis analysis from body pose alone. No ball tracking, no
              sensors. Just a video of your match.
            </p>
          </div>

          <nav aria-labelledby="footer-product">
            <h2 id="footer-product" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Product
            </h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <button
                  type="button"
                  onClick={uploadVideo}
                  className="text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  Upload a video
                </button>
              </li>
              <li>
                <Link href="/how-it-works/" className="text-slate-500 hover:text-slate-900 transition-colors">
                  How it works
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-company">
            <h2 id="footer-company" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Company
            </h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <Link href="/contact/" className="text-slate-500 hover:text-slate-900 transition-colors">
                  Contact us
                </Link>
              </li>
              <li>
                <Link href="/privacy/" className="text-slate-500 hover:text-slate-900 transition-colors">
                  Privacy policy
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Status</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-500">
              Shot detection, player attribution and stroke classification are
              measured and published —{" "}
              <Link href="/how-it-works/" className="text-orange-600 hover:text-orange-700 transition-colors">
                see how it works
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="mt-12 border-t border-slate-100 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} PongAI. A research project, not medical or professional coaching advice.
          </p>
          <div className="flex items-center gap-1.5">
            <span className="inline-block size-1.5 rounded-full bg-green-500" />
            <span className="text-xs text-slate-400">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}