import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

const SECTIONS = [
  {
    icon: "📦",
    h: "What we store",
    p: [
      "Your account: first name, last name, email address, and a password that is hashed with argon2id. The password itself is never stored and cannot be recovered from the hash.",
      "Your uploads: the video file you submit, and everything the analysis produces from it — the rendered video, the shot records and the measurements.",
    ],
  },
  {
    icon: "🔒",
    h: "Who can see your videos",
    p: [
      "Only you. Every upload is tied to the account that created it, and the API will not return another account's video, analysis or even confirm that it exists.",
      "Videos are served over short-lived signed links rather than public URLs, so a link shared by accident stops working.",
    ],
  },
  {
    icon: "🗓",
    h: "How long we keep it",
    p: [
      "The original upload is deleted automatically seven days after it is submitted. Analysis results are kept until you delete them.",
      "Deleting a video removes the file and its analysis permanently. There is no recycle bin and no backup to restore from.",
    ],
  },
  {
    icon: "🚫",
    h: "What we do not do",
    p: [
      "We do not sell your data, show advertising, or share your videos with anyone.",
      "We do not use your footage to train models without asking you first.",
    ],
  },
  {
    icon: "🍪",
    h: "Cookies and tracking",
    p: [
      "No advertising or analytics cookies. Your sign-in token is held in your browser's local storage so you stay signed in between visits, and it is removed when you sign out.",
    ],
  },
  {
    icon: "✋",
    h: "Your choices",
    p: [
      "You can delete any video from the app at any time. To close your account and remove everything at once, email info@sportsforequity.live.",
    ],
  },
];

export default function Page() {
  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Privacy policy</h1>
          <p className="mt-3 text-sm text-slate-400">
            Describes what the system actually does today. Not reviewed by a lawyer and not a contract.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <div key={s.h} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl gradient-brand text-lg shadow-sm">
                  {s.icon}
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900">{s.h}</h2>
                  {s.p.map((para) => (
                    <p key={para} className="mt-2 text-sm text-slate-500 leading-relaxed">{para}</p>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}