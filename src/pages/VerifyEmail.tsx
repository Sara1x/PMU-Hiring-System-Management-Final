import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { getSession, setSession } from '../utils/session';
import { parseOtpExpiresAtMs } from '../utils/otpExpiry';
import {
  clearAllVerifyOtpSessionKeys,
  expiresAtAfterRequestMs,
  normalizeVerifyPortalSlug,
  readVerifyOtpSession,
  writeVerifyOtpSession,
  peekVerifyOtpEmailForPortal,
} from '../utils/otpSession';
import {
  normalizeLoginEmail,
  loginPathSegmentForRole,
  ROLE_DEFAULT_FULL_NAME,
  ROLE_ACCOUNT_EMAIL,
  roleFromLoginEmail,
  roleFromVerifySlug,
  type PmuRole,
} from '../utils/roleAccounts';

const NO_ACTIVE_CODE_MSG = 'No active code. Please request a new verification code.';

const sendVerificationOTP = httpsCallable<
  { email: string; role: string },
  { success: boolean; expiresAt: number }
>(functions, 'sendVerificationOTP');

const verifyOTPCallable = httpsCallable<
  { email: string; code: string },
  { valid: boolean; reason?: 'expired' | 'invalid' }
>(functions, 'verifyOTP');

const ROLE_DASHBOARD: Record<PmuRole, string> = {
  dean: '/dean/dashboard',
  hr: '/hr/dashboard',
  chair: '/chair/dashboard',
  interviewer: '/interviewer/dashboard',
};

type NavVerifyState = {
  email?: string;
  expiresAt?: unknown;
  portalRole?: string;
  fullName?: string;
} | null;

export default function VerifyEmailPage() {
  const { role } = useParams<{ role: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as NavVerifyState;

  const portalSlug = useMemo(() => normalizeVerifyPortalSlug(role), [role]);
  const navExpiresRaw = navState?.expiresAt;
  const navPortalRaw = navState?.portalRole;
  const routeRole = useMemo(() => roleFromVerifySlug(role), [role]);

  const verifyEmail = useMemo(() => {
    const fromNav = normalizeLoginEmail(String(navState?.email ?? '').trim());
    if (fromNav) return fromNav;
    const peek = peekVerifyOtpEmailForPortal(portalSlug);
    return peek ?? '';
  }, [navState?.email, portalSlug]);

  const roleMismatch =
    !!verifyEmail &&
    !!routeRole &&
    roleFromLoginEmail(verifyEmail) !== routeRole;

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!verifyEmail || roleMismatch) {
      setExpiresAt(null);
      return;
    }

    const navPortal = normalizeVerifyPortalSlug(navPortalRaw);
    const navExp =
      navExpiresRaw !== undefined && navPortal === portalSlug
        ? parseOtpExpiresAtMs(navExpiresRaw)
        : null;

    if (navExp !== null) {
      setExpiresAt(navExp);
      writeVerifyOtpSession({
        email: verifyEmail,
        expiresAt: navExp,
        portalRole: portalSlug,
      });
      return;
    }

    const sess = readVerifyOtpSession(portalSlug, verifyEmail);
    if (sess !== null) {
      setExpiresAt(sess.expiresAt);
      return;
    }

    setExpiresAt(null);
  }, [location.key, portalSlug, navExpiresRaw, navPortalRaw, verifyEmail, roleMismatch]);

  useEffect(() => {
    if (expiresAt === null) {
      setTimeLeft(0);
      setExpired(false);
      return;
    }

    const tick = () => {
      const deltaMs = expiresAt - Date.now();
      const remaining = Math.max(0, Math.ceil(deltaMs / 1000));
      setTimeLeft(remaining);
      setExpired(remaining === 0);
    };

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [expiresAt]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const updated = [...digits];
    updated[index] = value;
    setDigits(updated);
    setError('');
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const updated = [...digits];
    for (let i = 0; i < 6; i++) updated[i] = pasted[i] ?? '';
    setDigits(updated);
    const nextEmpty = updated.findIndex(d => !d);
    inputRefs.current[nextEmpty === -1 ? 5 : nextEmpty]?.focus();
  };

  const handleVerify = useCallback(async () => {
    const code = digits.join('');
    if (!verifyEmail || roleMismatch || !routeRole) {
      setError('Verification session invalid. Return to login.');
      return;
    }
    if (code.length < 6) {
      setError('Please enter all 6 digits.');
      return;
    }
    if (expiresAt === null || expired) {
      setError(NO_ACTIVE_CODE_MSG);
      return;
    }

    setVerifying(true);
    setError('');
    try {
      const result = await verifyOTPCallable({ email: verifyEmail, code });
      const { valid, reason } = result.data;

      if (valid) {
        const fullName =
          navState?.fullName?.trim() ||
          getSession()?.fullName ||
          ROLE_DEFAULT_FULL_NAME[routeRole];

        setSession({
          role: routeRole,
          email: ROLE_ACCOUNT_EMAIL[routeRole],
          fullName,
        });

        navigate(ROLE_DASHBOARD[routeRole], { replace: true });
      } else if (reason === 'expired') {
        setExpired(true);
        setError(NO_ACTIVE_CODE_MSG);
      } else {
        setError('Invalid verification code. Please try again.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed. Please try again.';
      setError(msg);
    } finally {
      setVerifying(false);
    }
  }, [
    digits,
    expired,
    expiresAt,
    verifyEmail,
    roleMismatch,
    routeRole,
    navigate,
    navState?.fullName,
  ]);

  const handleResend = async () => {
    if (!verifyEmail || roleMismatch || !routeRole) {
      setError('Cannot resend. Return to login.');
      return;
    }
    setResending(true);
    setError('');
    setDigits(['', '', '', '', '', '']);
    setResent(false);
    try {
      await sendVerificationOTP({ email: verifyEmail, role: portalSlug });
      clearAllVerifyOtpSessionKeys();
      const next = expiresAtAfterRequestMs();
      writeVerifyOtpSession({
        email: verifyEmail,
        expiresAt: next,
        portalRole: portalSlug,
      });
      setExpiresAt(next);
      setExpired(false);
      setResent(true);
      setTimeout(() => setResent(false), 4000);
      inputRefs.current[0]?.focus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resend code.';
      setError(msg);
    } finally {
      setResending(false);
    }
  };

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const ss = String(timeLeft % 60).padStart(2, '0');

  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1).toLowerCase() : '';

  const backLogin = () => {
    if (routeRole) {
      navigate(`/login/${encodeURIComponent(loginPathSegmentForRole(routeRole))}`);
    } else {
      navigate('/');
    }
  };

  const showEmail = verifyEmail || `your ${roleLabel} login email`;

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      background: 'linear-gradient(135deg, #001a3d 0%, #002952 50%, #001a3d 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '1.5rem',
        boxShadow: '0 25px 80px rgba(0,0,0,0.4)',
        padding: '3.5rem 4rem',
        width: '100%',
        maxWidth: '560px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <img src="/pmu-logo.png" alt="PMU Logo"
          style={{ width: '90px', height: '90px', objectFit: 'contain', marginBottom: '1.75rem' }} />

        <h2 style={{
          fontSize: '1.875rem',
          fontWeight: '700',
          color: '#002147',
          marginBottom: '0.75rem',
          textAlign: 'center',
        }}>
          Verify Your Email
        </h2>

        <p style={{
          fontSize: '1rem',
          color: '#6b7280',
          textAlign: 'center',
          marginBottom: '0.5rem',
          lineHeight: 1.6,
        }}>
          Enter the 6-digit verification code sent to
        </p>
        <p style={{
          fontSize: '1rem',
          color: '#002147',
          fontWeight: '600',
          marginBottom: '0.5rem',
          textAlign: 'center',
        }}>
          {showEmail}
        </p>

        {(roleMismatch || !verifyEmail) && (
          <p style={{
            color: '#dc2626',
            fontSize: '0.88rem',
            textAlign: 'center',
            marginBottom: '1rem',
            maxWidth: '400px',
          }}>
            {!verifyEmail
              ? 'Missing login context — go back and sign in again.'
              : 'This verification page does not match the account email.'}
          </p>
        )}

        <p style={{
          fontSize: '0.8125rem',
          color: '#6b7280',
          textAlign: 'center',
          marginBottom: '1.75rem',
          lineHeight: 1.5,
          maxWidth: '420px',
        }}>
          The code is valid for 3 minutes after you request it.
        </p>

        <div style={{
          marginBottom: '1.5rem',
          textAlign: 'center',
          minHeight: '44px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          {expiresAt !== null && !expired ? (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: timeLeft <= 10 ? '#fef2f2' : '#f0f9ff',
              border: `1px solid ${timeLeft <= 10 ? '#fca5a5' : '#bae6fd'}`,
              borderRadius: '999px',
              padding: '0.4rem 1rem',
            }}>
              <span style={{ fontSize: '0.8rem', color: timeLeft <= 10 ? '#dc2626' : '#0369a1', fontWeight: '600' }}>
                Code expires in
              </span>
              <span style={{
                fontSize: '1.1rem',
                fontWeight: '800',
                letterSpacing: '0.05em',
                color: timeLeft <= 10 ? '#dc2626' : '#002147',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {mm}:{ss}
              </span>
            </div>
          ) : expiresAt !== null && expired ? (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '999px',
              padding: '0.4rem 1rem',
            }}>
              <span style={{ fontSize: '0.85rem', color: '#dc2626', fontWeight: '600' }}>
                Code expired
              </span>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}
          onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              disabled={
                expired ||
                verifying ||
                expiresAt === null ||
                !!roleMismatch ||
                !verifyEmail
              }
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onFocus={e => { if (!error) e.target.style.borderColor = '#002147'; }}
              onBlur={e => { if (!digit && !error) e.target.style.borderColor = '#d1d5db'; }}
              style={{
                width: '56px',
                height: '60px',
                textAlign: 'center',
                fontSize: '1.5rem',
                fontWeight: '600',
                color: '#002147',
                border: `2px solid ${error ? '#ef4444' : digit ? '#002147' : '#d1d5db'}`,
                borderRadius: '0.75rem',
                outline: 'none',
                transition: 'border-color 0.2s',
                fontFamily: 'inherit',
                opacity:
                  expired ||
                  verifying ||
                  expiresAt === null ||
                  !!roleMismatch ||
                  !verifyEmail
                    ? 0.5
                    : 1,
                cursor:
                  expired ||
                  verifying ||
                  expiresAt === null ||
                  !!roleMismatch ||
                  !verifyEmail
                    ? 'not-allowed'
                    : 'text',
              }}
            />
          ))}
        </div>

        {error && (
          <p style={{
            color: '#ef4444',
            fontSize: '0.9rem',
            marginBottom: '1rem',
            textAlign: 'center',
            maxWidth: '380px',
          }}>
            {error}
          </p>
        )}
        {resent && !error && (
          <p style={{
            color: '#16a34a',
            fontSize: '0.9rem',
            marginBottom: '1rem',
            textAlign: 'center',
          }}>
            New verification code sent successfully.
          </p>
        )}
        {(expiresAt === null || expired) && !error && verifyEmail && !roleMismatch && (
          <p style={{
            color: '#6b7280',
            fontSize: '0.9rem',
            marginBottom: '1rem',
            textAlign: 'center',
            maxWidth: '380px',
          }}>
            {NO_ACTIVE_CODE_MSG}
          </p>
        )}

        <button
          onClick={() => void handleVerify()}
          disabled={
            expired ||
            verifying ||
            digits.join('').length < 6 ||
            expiresAt === null ||
            !!roleMismatch ||
            !verifyEmail ||
            !routeRole
          }
          style={{
            width: '100%',
            padding: '1.125rem',
            backgroundColor:
              expired ||
              verifying ||
              digits.join('').length < 6 ||
              expiresAt === null ||
              !!roleMismatch ||
              !verifyEmail
                ? '#9ca3af'
                : '#002147',
            color: 'white',
            fontSize: '1.125rem',
            fontWeight: '600',
            border: 'none',
            borderRadius: '0.875rem',
            cursor:
              expired ||
              verifying ||
              expiresAt === null ||
              !!roleMismatch ||
              !verifyEmail
                ? 'not-allowed'
                : 'pointer',
            fontFamily: 'inherit',
            marginBottom: '1.25rem',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={e => {
            if (!expired && !verifying && expiresAt !== null && verifyEmail && !roleMismatch) {
              e.currentTarget.style.backgroundColor = '#003366';
            }
          }}
          onMouseLeave={e => {
            if (!expired && !verifying && expiresAt !== null && verifyEmail && !roleMismatch) {
              e.currentTarget.style.backgroundColor = '#002147';
            }
          }}
        >
          {verifying ? 'Verifying…' : 'Verify'}
        </button>

        <button
          onClick={() => void handleResend()}
          disabled={resending || !!roleMismatch || !verifyEmail || !routeRole}
          style={{
            background: 'none',
            border: 'none',
            color: '#002147',
            fontSize: '1rem',
            fontWeight: '500',
            cursor: resending || !verifyEmail ? 'not-allowed' : 'pointer',
            textDecoration: 'underline',
            fontFamily: 'inherit',
            marginBottom: '1.75rem',
            opacity: resending ? 0.6 : 1,
          }}
        >
          {resending ? 'Sending…' : 'Resend Code'}
        </button>

        <div style={{
          width: '100%',
          height: '1px',
          backgroundColor: '#e5e7eb',
          marginBottom: '1.5rem',
        }} />

        <button
          onClick={backLogin}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            fontSize: '1rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Back to Login
        </button>
      </div>
    </div>
  );
}
