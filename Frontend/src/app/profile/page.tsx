import type { Metadata } from "next";
import { ProfileView } from "@/components/profile-view";
import { RequireSession } from "@/components/require-session";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <RequireSession returnTo="/profile/">
      <ProfileView />
    </RequireSession>
  );
}
