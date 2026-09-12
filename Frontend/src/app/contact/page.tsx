import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact us" };

const REASONS = [
  {
    h: "A password you cannot remember",
    p: "There is no self-service reset yet. Email us from the address on the account and we will reset it.",
    to: "support@pongai.example",
  },
  {
    h: "Something went wrong with an analysis",
    p: "Send the name of the video and roughly when you uploaded it. The job record keeps the reason it failed, which usually explains it straight away.",
    to: "support@pongai.example",
  },
  {
    h: "Deleting your account",
    p: "Ask and we will remove the account, every video on it and every analysis. It cannot be undone.",
    to: "support@pongai.example",
  },
  {
    h: "Research, data or anything else",
    p: "The model, the measurements and where it falls short — happy to talk about any of it.",
    to: "hello@pongai.example",
  },
];

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Contact us</h1>
      <p className="text-ink-muted mt-4 text-lg">
        A small project, so there is no ticketing system — email reaches a
        person.
      </p>
      <p className="text-ink-subtle mt-2 text-sm">
        Placeholder addresses while the project is in development.
      </p>

      <div className="mt-10 space-y-4">
        {REASONS.map((r) => (
          <section
            key={r.h}
            className="rounded-card border-border bg-surface border p-5"
          >
            <h2 className="font-semibold">{r.h}</h2>
            <p className="text-ink-muted mt-1 text-sm">{r.p}</p>
            <a
              href={`mailto:${r.to}`}
              className="text-brand-text mt-3 inline-block text-sm underline"
            >
              {r.to}
            </a>
          </section>
        ))}
      </div>
    </div>
  );
}
