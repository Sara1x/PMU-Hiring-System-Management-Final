/**
 * Coerce Firebase callable / Router state / sessionStorage values to epoch millis.
 * Callables occasionally surface numbers as strings or Timestamp-like objects.
 */

/** Matches Cloud Functions `OTP_TTL_SECONDS`; update both when changing policy */
export const OTP_ISSUED_TTL_SECONDS = 180;

const MIN_EXPIRY_MS = 1_000_000_000_000; /* rejects seconds-as-number mistakes */

/** Parse stored/cross-layer values (may be expired — hydrate UI accordingly). */
export function parseOtpExpiresAtMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw < MIN_EXPIRY_MS) return null;
    return raw;
  }

  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n >= MIN_EXPIRY_MS) return n;
    return null;
  }

  if (raw !== null && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const s =
      typeof o._seconds === 'number'
        ? o._seconds
        : typeof o.seconds === 'number'
          ? o.seconds
          : null;
    if (s !== null) {
      const ns =
        typeof o._nanoseconds === 'number'
          ? o._nanoseconds
          : typeof o.nanoseconds === 'number'
            ? o.nanoseconds
            : 0;
      const ms = Math.floor(s * 1000 + ns / 1e6);
      if (ms < MIN_EXPIRY_MS) return null;
      return ms;
    }
  }

  return null;
}
