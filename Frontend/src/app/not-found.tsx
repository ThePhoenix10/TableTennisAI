import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="text-ink-muted mt-2 max-w-prose text-base">
        That page does not exist. In v1 only the three precomputed demo matches
        are available.
      </p>
      <Link
        href="/"
        className="bg-brand text-on-brand hover:bg-brand-hover mt-6 inline-block rounded px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out"
      >
        Back to demos
      </Link>
    </div>
  );
}
