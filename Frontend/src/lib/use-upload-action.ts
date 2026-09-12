"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useSession } from "@/components/session-provider";
import { signInUrl } from "./auth";

export const DASHBOARD = "/dashboard/";

/**
 * "Upload a video", wherever it is pressed.
 *
 * Signed in it goes to the dashboard; signed out it goes to sign in and comes
 * back there. It used to scroll to a panel wedged into the marketing page,
 * which is the kind of hack that disappears once each page does one job.
 */
export function useUploadAction(): () => void {
  const { user } = useSession();
  const router = useRouter();

  return useCallback(() => {
    router.push(user ? DASHBOARD : signInUrl(DASHBOARD));
  }, [user, router]);
}
