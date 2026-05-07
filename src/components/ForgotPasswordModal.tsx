import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase';
import { X } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export default function ForgotPasswordModal({ onClose }: Props) {
  const [email, setEmail]     = useState('');
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmed = email.trim();

    if (!trimmed) {
      setError('Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await sendPasswordResetEmail(auth, trimmed);
      setSuccess(true);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';

      if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (code === 'auth/user-not-found') {
        setSuccess(true);
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else if (code === 'auth/network-request-failed') {
        setError('Cannot reach the server. Please check your internet connection and try again.');
      } else if (code === 'auth/operation-not-allowed') {
        setError('Password reset is not enabled. Please contact support.');
      } else {
        setError('Unable to send reset email. Please check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'white',
          borderRadius: '1.25rem',
          padding: '2.5rem',
          width: '100%',
          maxWidth: '440px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          position: 'relative',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1.25rem',
            right: '1.25rem',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#6b7280',
            display: 'flex',
            alignItems: 'center',
            padding: '0.25rem',
          }}
        >
          <X style={{ width: '1.25rem', height: '1.25rem' }} />
        </button>

        <h2 style={{
          fontSize: '1.6rem',
          fontWeight: '700',
          color: '#002147',
          marginBottom: '0.5rem',
        }}>
          Reset Password
        </h2>

        <p style={{
          color: '#6b7280',
          fontSize: '0.975rem',
          marginBottom: '1.75rem',
          lineHeight: 1.5,
        }}>
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {success ? (
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '0.75rem',
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
          }}>
            <p style={{ color: '#15803d', fontSize: '0.975rem', margin: 0, lineHeight: 1.5 }}>
              Check your email for a password reset link.
            </p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '1.25rem' }}>
              <label
                htmlFor="forgot-password-email"
                style={{
                  display: 'block',
                  color: '#002147',
                  fontSize: '1rem',
                  fontWeight: '600',
                  marginBottom: '0.6rem',
                }}
              >
                Email Address
              </label>
              <input
                id="forgot-password-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
                placeholder="Enter your email"
                style={{
                  width: '100%',
                  padding: '1rem 1.125rem',
                  fontSize: '1rem',
                  border: `2px solid ${error ? '#fca5a5' : '#e5e7eb'}`,
                  borderRadius: '0.75rem',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  color: '#374151',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => { if (!error) e.target.style.borderColor = '#002147'; }}
                onBlur={(e) => { if (!error) e.target.style.borderColor = '#e5e7eb'; }}
              />
            </div>

            {error && (
              <div style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '0.75rem',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
              }}>
                <p style={{ color: '#dc2626', fontSize: '0.9rem', margin: 0 }}>{error}</p>
              </div>
            )}

            <button
              onClick={() => void handleSubmit()}
              disabled={loading}
              style={{
                width: '100%',
                padding: '1rem',
                backgroundColor: loading ? '#6b7280' : '#002147',
                color: 'white',
                fontSize: '1.05rem',
                fontWeight: '600',
                border: 'none',
                borderRadius: '0.75rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#003366'; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#002147'; }}
            >
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
          </>
        )}

        {success && (
          <button
            onClick={onClose}
            style={{
              width: '100%',
              padding: '1rem',
              backgroundColor: '#002147',
              color: 'white',
              fontSize: '1.05rem',
              fontWeight: '600',
              border: 'none',
              borderRadius: '0.75rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#003366'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#002147'; }}
          >
            Back to Login
          </button>
        )}
      </div>
    </div>
  );
}
