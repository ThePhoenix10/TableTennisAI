import type { Limits } from "./api-types";

/**
 * The sign-up password rules, as a checklist.
 *
 * Every threshold comes from `GET /api/limits`, which serves what
 * `core/auth.py` enforces. This file owns only the wording — a second copy of
 * the rules themselves is how the form starts accepting what the API rejects.
 */
export interface PasswordRule {
  id: string;
  /** Phrased as a thing achieved, so a ticked list reads as progress. */
  label: string;
  met: (password: string) => boolean;
}

/** Used until `/api/limits` answers, and if it never does. Deliberately the
 *  strictest reading, so the form cannot be more permissive than the API. */
export const FALLBACK_MIN_LENGTH = 12;
const FALLBACK_SPECIALS = "!@#$%^&*()_+-=[]{}|;:',.<>?/`~\"\\";

export function passwordRules(limits: Limits | null): PasswordRule[] {
  const min = limits?.password?.min_length ?? FALLBACK_MIN_LENGTH;
  const specials = limits?.password?.special_characters ?? FALLBACK_SPECIALS;

  const rules: PasswordRule[] = [
    {
      id: "length",
      label: `At least ${min} characters`,
      met: (p) => p.length >= min,
    },
  ];
  if (limits?.password?.requires_uppercase ?? true) {
    rules.push({
      id: "uppercase",
      label: "An uppercase letter",
      met: (p) => /[A-Z]/.test(p),
    });
  }
  if (limits?.password?.requires_special ?? true) {
    rules.push({
      id: "special",
      label: "A special character, like ! or ?",
      met: (p) => [...p].some((c) => specials.includes(c)),
    });
  }
  return rules;
}

export const allRulesMet = (rules: PasswordRule[], password: string): boolean =>
  rules.every((r) => r.met(password));
