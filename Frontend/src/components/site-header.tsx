import Link from "next/link";

/**
 * Global chrome. Deliberately thin — this is a data-dense product and the
 * density should come from the data, not the frame around it (spec §2).
 */
export function SiteHeader() {
  return (
    <header className="border-border bg-surface border-b">
      <a
        href="#main"
        className="focus:bg-brand focus:text-on-brand sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded text-base font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="bg-brand inline-block size-3 rounded-full"
          />
          PongAI
        </Link>
      </div>
    </header>
  );
}
