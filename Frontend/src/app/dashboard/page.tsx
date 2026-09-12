import type { Metadata } from "next";
import { RequireSession } from "@/components/require-session";
import { UploadSection } from "@/components/upload-section";

export const metadata: Metadata = { title: "Your videos" };

export default function DashboardPage() {
  return (
    <RequireSession returnTo="/dashboard/">
      <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6">
        <UploadSection heading />
      </div>
    </RequireSession>
  );
}
