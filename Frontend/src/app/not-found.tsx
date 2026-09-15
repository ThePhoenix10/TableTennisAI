import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-2xl gradient-brand shadow-lg glow-brand text-4xl">
          🏓
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-3 text-slate-500 leading-relaxed">
          That page does not exist. In v1 only the precomputed demo matches are available.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-xl gradient-brand px-6 py-3 text-sm font-bold text-white shadow-md glow-brand hover:opacity-90 transition-opacity"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}