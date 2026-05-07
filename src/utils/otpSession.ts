import { OTP_ISSUED_TTL_SECONDS, parseOtpExpiresAtMs } from './otpExpiry';
import { normalizeLoginEmail } from './roleAccounts';

/** All roles share one structured payload; keyed away from unrelated app data */
const LEGACY_VERIFY_KEY = 'pmu.verifyOtp.v1';
export const VERIFY_OTP_SESSION_KEY = 'pmu.verifyOtp.v2';

export type VerifyOtpStored = {
  email: string;
  expiresAt: number;
  /** Lowercase slug matching `/verify/:role`, e.g. dean, hr, chair, interviewer */
  portalRole: string;
};

/** Remove OTP timer drafts so an old expiry can never bleed into the next Login or retries */
export function clearAllVerifyOtpSessionKeys(): void {
  try {
    sessionStorage.removeItem(LEGACY_VERIFY_KEY);
    sessionStorage.removeItem(VERIFY_OTP_SESSION_KEY);
  } catch {
    /* ignore quota / privacy mode */
  }
}

/** Lowercase slug for `/verify/:role` comparisons */
export function normalizeVerifyPortalSlug(roleSlug: string | undefined): string {
  return String(roleSlug ?? '')
    .trim()
    .toLowerCase();
}

/** Browser-local deadline right after OTP request completes (~aligns callable return instant). */
export function expiresAtAfterRequestMs(): number {
  return Date.now() + OTP_ISSUED_TTL_SECONDS * 1000;
}

export function writeVerifyOtpSession(payload: VerifyOtpStored): void {
  sessionStorage.setItem(VERIFY_OTP_SESSION_KEY, JSON.stringify(payload));
}

/**
 * Hydrate OTP window for same portal + same recipient email only.
 */
export function readVerifyOtpSession(
  portalSlugLower: string,
  recipientEmail: string,
): VerifyOtpStored | null {
  try {
    const raw = sessionStorage.getItem(VERIFY_OTP_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VerifyOtpStored>;
    const wantEmail = normalizeLoginEmail(recipientEmail);
    if (normalizeLoginEmail(String(parsed.email ?? '')) !== wantEmail) return null;
    const slug = normalizeVerifyPortalSlug(parsed.portalRole);
    if (slug !== portalSlugLower) return null;
    const expiresAt = parseOtpExpiresAtMs(parsed.expiresAt);
    if (expiresAt === null) return null;
    return { email: normalizeLoginEmail(String(parsed.email)), expiresAt, portalRole: slug };
  } catch {
    return null;
  }
}

/** Recover recipient email after refresh when sessionStorage still holds this portal's OTP. */
export function peekVerifyOtpEmailForPortal(portalSlugLower: string): string | null {
  try {
    const raw = sessionStorage.getItem(VERIFY_OTP_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VerifyOtpStored>;
    const slug = normalizeVerifyPortalSlug(parsed.portalRole);
    if (slug !== portalSlugLower) return null;
    const e = String(parsed.email ?? '').trim();
    return e ? normalizeLoginEmail(e) : null;
  } catch {
    return null;
  }
}
