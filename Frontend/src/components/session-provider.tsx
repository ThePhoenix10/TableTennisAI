"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { User } from "@/lib/api-types";
import {
  clearSession,
  getServerSnapshot,
  getSnapshot,
  subscribe,
} from "@/lib/auth";

export interface Session {
  user: User | null;
  /** False until the browser has read storage. The page is prerendered with
   *  no session, so rendering signed-in chrome before this is a hydration
   *  mismatch. */
  ready: boolean;
  signOut: () => void;
}

/**
 * The session, read straight from its store.
 *
 * `useSyncExternalStore` rather than an effect: localStorage genuinely is an
 * external store, and this is the hook built for one. It also gets hydration
 * right by construction — the server snapshot has no session, and the client
 * swaps in the real one after hydrating.
 *
 * No context: every consumer subscribes to the same store, so a provider
 * would only add a layer that can go stale.
 */
export function useSession(): Session {
  const { user, ready } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const signOut = useCallback(() => clearSession(), []);
  return { user, ready, signOut };
}
