import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

const SECTIONS = [
  {
    h: "What we store",
    p: [
      "Your account: first name, last name, email address, and a password that is hashed with argon2id. The password itself is never stored and cannot be recovered from the hash.",
      "Your uploads: the video file you submit, and everything the analysis produces from it — the rendered video, the shot records and the measurements.",
    ],
  },
  {
    h: "Who can see your videos",
    p: [
      "Only you. Every upload is tied to the account that created it, and the API will not return another account's video, analysis or even confirm that it exists.",
      "Videos are served over short-lived signed links rather than public URLs, so a link shared by accident stops working.",
    ],
  },
  {
    h: "How long we keep it",
    p: [
      "The original upload is deleted automatically seven days after it is submitted. Analysis results are kept until you delete them.",
      "Deleting a video removes the file and its analysis permanently. There is no recycle bin and no backup to restore from.",
    ],
  },
  {
    h: "What we do not do",
    p: [
      "We do not sell your data, show advertising, or share your videos with anyone.",
      "We do not use your footage to train models without asking you first.",
    ],
  },
  {
    h: "Cookies and tracking",
    p: [
      "No advertising or analytics cookies. Your sign-in token is held in your browser's local storage so you stay signed in between visits, and it is removed when you sign out.",
    ],
  },
  {
    h: "Your choices",
    p: [
      "You can delete any video from the app at any time. To close your account and remove everything at once, email support@pongai.example.",
    ],
  },
];

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="text-ink-muted mt-2 text-sm">
        Placeholder text for a project still in development. It describes what
        the system actually does today, but it has not been reviewed by a lawyer
        and is not a contract.
      </p>

      <div className="mt-10 space-y-10">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="text-lg font-semibold">{s.h}</h2>
            {s.p.map((para) => (
              <p key={para} className="text-ink-muted mt-2 text-sm">
                {para}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
