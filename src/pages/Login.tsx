import { useMemo, useState, useEffect } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import ForgotPasswordModal from '../components/ForgotPasswordModal';
import { useParams, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase';
import { setSession } from '../utils/session';
import {
  clearAllVerifyOtpSessionKeys,
  expiresAtAfterRequestMs,
  writeVerifyOtpSession,
} from '../utils/otpSession';
import {
  ROLE_ACCOUNT_EMAIL,
  ROLE_DEFAULT_FULL_NAME,
  roleFromLoginEmail,
  roleFromPortalParam,
  verifySlugForRole,
  normalizeLoginEmail,
} from '../utils/roleAccounts';

const DEMO_LOGIN_PASSWORD = '123456';
function formatCallableOrGenericError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & { code?: string; details?: unknown };
  if (typeof e.details === 'string' && e.details.trim()) return e.details.trim();

  const code = e.code ?? '';
  const raw = err.message.trim();
  const vague = /^internal$/i.test(raw);

  if (code === 'functions/failed-precondition')
    return 'Email verification is not configured (SMTP secrets missing). Set SMTP_USER and SMTP_PASS on the sendVerificationOTP function in Firebase.';
  if (code === 'functions/not-found')
    return 'sendVerificationOTP is not deployed or the wrong region/project is configured. Deploy functions to us-central1 for this Firebase project.';
  if (code.startsWith('functions/') && !vague) return raw;
  if (vague || raw === '')
    return 'Could not send the verification email. Deploy the latest Cloud Functions, verify Firestore/API access, and check SMTP secrets. Open the browser devtools Network tab for the callable response.';
  return raw;
}

const sendVerificationOTP = httpsCallable<
  { email: string; role: string },
  { success: boolean; expiresAt: number }
>(functions, 'sendVerificationOTP');



export default function LoginPage() {
  const { role } = useParams();
  const navigate  = useNavigate();

  const portalRole = roleFromPortalParam(role);

  const initialEmail = useMemo(
    () => (portalRole ? ROLE_ACCOUNT_EMAIL[portalRole] : ''),
    [portalRole],
  );

  const [email, setEmail] = useState(initialEmail);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  const [password,     setPassword]     = useState(DEMO_LOGIN_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError,   setLoginError]   = useState('');
  const [loggingIn,    setLoggingIn]    = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoggingIn(true);
    setLoginError('');
    try {
      const resolvedRole = roleFromLoginEmail(email);
      if (!resolvedRole) {
        setLoginError('This email is not registered for PMU Hiring access.');
        setLoggingIn(false);
        return;
      }

      // 1. Authenticate with Firebase Auth — each role uses its own email
      const normEmail = normalizeLoginEmail(email);
      try {
        await signInWithEmailAndPassword(auth, normEmail, password);
      } catch (signInErr: unknown) {
        const code = (signInErr as { code?: string }).code ?? '';
        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
          await createUserWithEmailAndPassword(auth, normEmail, password);
        } else {
          throw signInErr;
        }
      }

      // 2. Session from resolved role + this account's email only
      setSession({
        role: resolvedRole,
        email: ROLE_ACCOUNT_EMAIL[resolvedRole],
        fullName: ROLE_DEFAULT_FULL_NAME[resolvedRole],
      });

      const verifySlug = verifySlugForRole(resolvedRole);

      // 3. OTP to this user's inbox
      await sendVerificationOTP({
        email: ROLE_ACCOUNT_EMAIL[resolvedRole],
        role: verifySlug,
      });

      clearAllVerifyOtpSessionKeys();
      const expiresAt = expiresAtAfterRequestMs();
      writeVerifyOtpSession({
        email: ROLE_ACCOUNT_EMAIL[resolvedRole],
        expiresAt,
        portalRole: verifySlug,
      });

      navigate(`/verify/${verifySlug}`, {
        state: {
          email: ROLE_ACCOUNT_EMAIL[resolvedRole],
          expiresAt,
          portalRole: verifySlug,
          fullName: ROLE_DEFAULT_FULL_NAME[resolvedRole],
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setLoginError('Incorrect password. Please try again.');
      } else if (code === 'auth/too-many-requests') {
        setLoginError('Too many attempts. Please wait a moment and try again.');
      } else {
        setLoginError(formatCallableOrGenericError(err));
      }
    } finally {
      setLoggingIn(false);
    }
  };

  const getRoleFeatures = () => {
    switch(role) {
      case 'Dean':
        return [
          'Review & Approve Requisitions',
          'Track Faculty Recruitment',
          'Manage College Hiring Pipeline'
        ];
      case 'HR Manager':
        return [
          'Post Job Requisitions to LinkedIn',
          'Manage Candidate Applications',
          'Schedule Interviews & Track Progress'
        ];
      case 'Department Chair':
        return [
          'Create Evaluation Committees',
          'Assign Candidates to Interviewers',
          'Monitor Committee Progress'
        ];
      case 'Interviewer':
        return [
          'Evaluate Assigned Candidates',
          'Submit Scoring & Feedback',
          'Track Evaluation Status'
        ];
      default:
        return [
          'Access Your Dashboard',
          'Manage Your Tasks',
          'View System Updates'
        ];
    }
  };

  const features = getRoleFeatures();

  const getDisplayTitle = () => {
    if (role === 'HR Manager') return 'HR';
    if (role === 'Department Chair') return 'Chair';
    return role;
  };

  const getPortalName = () => {
    if (role === 'HR Manager') return 'HR';
    if (role === 'Department Chair') return 'Committee Chair';
    return role;
  };

  const hintEmail =
    portalRole !== null ? ROLE_ACCOUNT_EMAIL[portalRole] : 'registered PMU email';

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      background: 'linear-gradient(135deg, #001a3d 0%, #002952 50%, #001a3d 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1.2fr',
        width: '100%',
        maxWidth: '1400px',
        minHeight: '700px',
        backgroundColor: 'white',
        borderRadius: '1.5rem',
        overflow: 'hidden',
        boxShadow: '0 25px 80px rgba(0, 0, 0, 0.4)'
      }}>

        <div style={{
          background: 'linear-gradient(180deg, #002147 0%, #003366 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4rem 3rem',
          color: 'white'
        }}>
          <div style={{ marginBottom: '3rem' }}>
            <img
              src="/pmu-logo.png"
              alt="PMU Logo"
              style={{
                width: '140px',
                height: '140px',
                objectFit: 'contain'
              }}
            />
          </div>

          <h2 style={{
            fontSize: '2rem',
            fontWeight: '700',
            textAlign: 'center',
            color: 'white',
            marginBottom: '1.5rem',
            lineHeight: 1.3
          }}>
            Academic Hiring<br/>Management System
          </h2>

          <h3 style={{
            fontSize: '1.75rem',
            fontWeight: '400',
            textAlign: 'center',
            color: '#93c5fd',
            marginBottom: '3rem',
            lineHeight: 1.2
          }}>
            {getPortalName()} Portal
          </h3>

          <div style={{
            width: '70%',
            height: '1px',
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
            marginBottom: '3rem'
          }}></div>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            alignItems: 'center',
            width: '100%',
            maxWidth: '400px'
          }}>
            {features.map((feature, index) => (
              <p key={index} style={{
                fontSize: '1.05rem',
                color: '#bfdbfe',
                textAlign: 'center',
                lineHeight: 1.5,
                margin: 0
              }}>
                {feature}
              </p>
            ))}
          </div>
        </div>

        <div style={{
          backgroundColor: 'white',
          padding: '4rem 4.5rem',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <button
            onClick={() => navigate('/')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'none',
              border: 'none',
              color: '#6b7280',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: '0.5rem 0',
              marginBottom: '2.5rem',
              fontFamily: 'inherit',
              alignSelf: 'flex-start'
            }}
          >
            <ArrowLeft style={{ width: '1.25rem', height: '1.25rem' }} />
            Previous
          </button>

          <h2 style={{
            fontSize: '3rem',
            fontWeight: 'bold',
            color: '#002147',
            marginBottom: '0.75rem',
            lineHeight: 1.1
          }}>
            {getDisplayTitle()} Login
          </h2>

          <p style={{
            color: '#6b7280',
            fontSize: '1.125rem',
            marginBottom: '3rem'
          }}>
            Please login to your account
          </p>

          <div style={{ marginBottom: '2rem' }}>
            <label style={{
              display: 'block',
              color: '#002147',
              fontSize: '1.05rem',
              fontWeight: '600',
              marginBottom: '0.75rem'
            }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={hintEmail}
              style={{
                width: '100%',
                padding: '1.125rem 1.25rem',
                fontSize: '1.05rem',
                border: '2px solid #e5e7eb',
                borderRadius: '0.75rem',
                outline: 'none',
                fontFamily: 'inherit',
                transition: 'border-color 0.2s',
                boxSizing: 'border-box',
                color: '#374151'
              }}
              onFocus={(e) => e.target.style.borderColor = '#002147'}
              onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
            />
          </div>

          <div style={{ marginBottom: '3rem' }}>
            <label style={{
              display: 'block',
              color: '#002147',
              fontSize: '1.05rem',
              fontWeight: '600',
              marginBottom: '0.75rem'
            }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '1.125rem 1.25rem',
                  paddingRight: '3.5rem',
                  fontSize: '1.05rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '0.75rem',
                  outline: 'none',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.2s',
                  boxSizing: 'border-box',
                  color: '#374151'
                }}
                onFocus={(e) => e.target.style.borderColor = '#002147'}
                onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '1.25rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#6b7280'
                }}
              >
                {showPassword ?
                  <EyeOff style={{ width: '1.25rem', height: '1.25rem' }} /> :
                  <Eye style={{ width: '1.25rem', height: '1.25rem' }} />
                }
              </button>
            </div>
          </div>

          {loginError && (
            <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.75rem', padding: '0.875rem 1rem', marginBottom: '1.25rem' }}>
              <p style={{ color: '#dc2626', fontSize: '0.95rem', margin: 0 }}>{loginError}</p>
            </div>
          )}

          <button
            onClick={() => void handleLogin()}
            disabled={loggingIn}
            style={{
              width: '100%',
              padding: '1.25rem',
              backgroundColor: loggingIn ? '#6b7280' : '#002147',
              color: 'white',
              fontSize: '1.25rem',
              fontWeight: '600',
              border: 'none',
              borderRadius: '0.875rem',
              cursor: loggingIn ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s',
              fontFamily: 'inherit',
              marginBottom: '2rem'
            }}
            onMouseEnter={(e) => { if (!loggingIn) e.currentTarget.style.backgroundColor = '#003366'; }}
            onMouseLeave={(e) => { if (!loggingIn) e.currentTarget.style.backgroundColor = '#002147'; }}
          >
            {loggingIn ? 'Signing in…' : 'Login'}
          </button>

          <div style={{ textAlign: 'center' }}>
            <button
              onClick={() => setShowForgotPassword(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#002147',
                fontSize: '1.05rem',
                fontWeight: '500',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'inherit',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#FF6C37';
                e.currentTarget.style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#002147';
                e.currentTarget.style.textDecoration = 'none';
              }}
            >
              Forgot your password?
            </button>
          </div>
        </div>
      </div>

      {showForgotPassword && (
        <ForgotPasswordModal onClose={() => setShowForgotPassword(false)} />
      )}
    </div>
  );
}
