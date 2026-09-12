"use client";

/**
 * Session handling, browser side.
 *
 * The token lives in localStorage and travels as `Authorization: Bearer`.
 * That is the usual shape for a static site talking to an API on another
 * origin, and it carries the usual trade-off: readable by JavaScript, so an
 * XSS bug would leak the session. The alternative — an httpOnly cookie —
 * needs SameSite=None, credentialed CORS and exact-origin allow lists.
 *
 * Sliding expiry: the API returns `X-Refresh-Token` once a token is past
 * halfway through its hour, and `api.ts` hands it here. An analysis runs for
 * ~25 minutes with the page polling throughout, so a hard cut would sign
 * people out while they watch their own upload.
 */
import type { User } from "./api-types";

const TOKEN_KEY = "pongai.token";
const USER_KEY = "pongai.user";

type Listener = () => void;
const listeners = new Set<Listener>();

/** localStorage throws in some privacy modes; a signed-out app is better
 *  than a blank one. */
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore — the session simply will not survive a reload */
  }
}

export const getToken = (): string | null => safeGet(TOKEN_KEY);

export interface SessionSnapshot {
  user: User | null;
  /** False only before the browser has read storage — during prerender and
   *  hydration. Consumers render a neutral state until it is true, so the
   *  signed-in header never appears on a pass the server did not produce. */
  ready: boolean;
}

const SERVER_SNAPSHOT: SessionSnapshot = { user: null, ready: false };
export const getServerSnapshot = (): SessionSnapshot => SERVER_SNAPSHOT;

// useSyncExternalStore compares snapshots by identity, so parsing the JSON on
// every call would loop forever. The parsed value is cached against the raw
// string it came from and only rebuilt when that changes.
let cachedRaw: string | null | undefined;
let cached: SessionSnapshot = SERVER_SNAPSHOT;

export function getSnapshot(): SessionSnapshot {
  const raw = safeGet(USER_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    let user: User | null = null;
    try {
      user = raw ? (JSON.parse(raw) as User) : null;
    } catch {
      user = null;
    }
    cached = { user, ready: true };
  }
  return cached;
}

export const getUser = (): User | null => getSnapshot().user;

export function setSession(token: string, user: User): void {
  safeSet(TOKEN_KEY, token);
  safeSet(USER_KEY, JSON.stringify(user));
  notify();
}

/** Swap in a refreshed token without disturbing the rest of the session. */
export function setToken(token: string): void {
  safeSet(TOKEN_KEY, token);
  notify();
}

export function clearSession(): void {
  safeSet(TOKEN_KEY, null);
  safeSet(USER_KEY, null);
  notify();
}

export const isSignedIn = (): boolean => getToken() !== null;

// --- change notification -----------------------------------------------------

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to session changes, including from another tab. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY || e.key === USER_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Where to send someone after they sign in. */
export const signInUrl = (returnTo?: string): string =>
  returnTo ? `/signin/?next=${encodeURIComponent(returnTo)}` : "/signin/";
