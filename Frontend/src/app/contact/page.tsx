import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact us" };

const REASONS = [
  {
    icon: "🔑",
    h: "A password you cannot remember",
    p: "There is no self-service reset yet. Email us from the address on the account and we will reset it.",
    to: "info@sportsforequity.live",
  },
  {
    icon: "⚠️",
    h: "Something went wrong with an analysis",
    p: "Send the name of the video and roughly when you uploaded it. The job record keeps the reason it failed, which usually explains it straight away.",
    to: "info@sportsforequity.live",
  },
  {
    icon: "🗑",
    h: "Deleting your account",
    p: "Ask and we will remove the account, every video on it and every analysis. It cannot be undone.",
    to: "info@sportsforequity.live",
  },
  {
    icon: "🔬",
    h: "Research, data or anything else",
    p: "The model, the measurements and where it falls short — happy to talk about any of it.",
    to: "info@sportsforequity.live",
  },
];

export default function Page() {
  return (
    <div className="bg-slate-50 min-h-screen">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-600">
            <span className="size-1.5 rounded-full bg-orange-500 inline-block" />
            We reply to every email
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Contact us</h1>
          <p className="mt-3 text-slate-500 text-lg">
            A small project — email reaches a person directly.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="space-y-4">
          {REASONS.map((r) => (
            <div
              key={r.h}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md hover:border-orange-200 transition-all duration-200"
            >
              <div className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl gradient-brand text-lg shadow-sm">
                  {r.icon}
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">{r.h}</h2>
                  <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{r.p}</p>
                  <a
                    href={`mailto:${r.to}`}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors"
                  >
                    {r.to}
                    <span aria-hidden>→</span>
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}