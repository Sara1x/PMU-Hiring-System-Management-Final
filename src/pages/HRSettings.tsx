import { HRLayout } from '../components/HRLayout';
import { useRoleUserProfileSettings } from '../hooks/useUserProfileSettings';

export default function HRSettings() {
  const { form, loading, saving, toast, loadError, handleSave, handleCancel, field } =
    useRoleUserProfileSettings('hr');

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.75rem 1rem', border: '1px solid #d1d5db',
    borderRadius: '0.5rem', fontSize: '0.9rem', color: '#374151', outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box', backgroundColor: 'white',
  };
  const readOnlyStyle: React.CSSProperties = { ...inputStyle, backgroundColor: '#f9fafb', color: '#9ca3af', cursor: 'default' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.4rem' };

  return (
    <HRLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '1.75rem', textAlign: 'center' }}>Settings</h1>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', width: '100%', maxWidth: '600px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280', fontSize: '0.9rem' }}>Loading profile…</div>
          ) : !form ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626', fontSize: '0.9rem' }}>{loadError ?? 'Unable to load profile.'}</div>
          ) : (
            <>
              {loadError && (
                <div style={{ padding: '0.65rem 1rem', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                  <p style={{ color: '#b45309', fontSize: '0.82rem', margin: 0 }}>{loadError}</p>
                </div>
              )}
              <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#111827', marginBottom: '1.25rem' }}>Profile Information</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', marginBottom: '2rem' }}>
                <div>
                  <label style={labelStyle}>Full Name</label>
                  <input style={inputStyle} value={form.fullName} onChange={e => field('fullName', e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Email Address <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>(read-only)</span></label>
                  <input style={readOnlyStyle} type="email" value={form.email} readOnly />
                </div>
              </div>

              {toast === 'success' && (
                <div style={{ padding: '0.65rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                  <p style={{ color: '#15803d', fontSize: '0.875rem', fontWeight: '500' }}>✓ Changes saved successfully.</p>
                </div>
              )}
              {toast === 'error' && (
                <div style={{ padding: '0.65rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                  <p style={{ color: '#dc2626', fontSize: '0.875rem', fontWeight: '500' }}>Failed to save. Please try again.</p>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.875rem' }}>
                <button onClick={handleSave} disabled={saving}
                  style={{ padding: '0.7rem 1.75rem', backgroundColor: saving ? '#9ca3af' : '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { if (!saving) e.currentTarget.style.backgroundColor = '#003366'; }}
                  onMouseLeave={e => { if (!saving) e.currentTarget.style.backgroundColor = saving ? '#9ca3af' : '#002147'; }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button onClick={handleCancel} disabled={saving}
                  style={{ padding: '0.7rem 1.5rem', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '500', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </HRLayout>
  );
}
