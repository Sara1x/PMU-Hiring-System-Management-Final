import { type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getSession, clearSession } from '../utils/session';
import {
  LayoutDashboard, FilePlus, ClipboardList, Users,
  CheckCircle, Settings, LogOut, UserCircle,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dean/dashboard', Icon: LayoutDashboard },
  { label: 'Create Job Requisition', path: '/dean/create-requisition', Icon: FilePlus },
  { label: 'My Requisitions', path: '/dean/my-requisitions', Icon: ClipboardList },
  { label: 'Shortlisted Candidates', path: '/dean/shortlisted-candidates', Icon: Users },
  { label: 'Final Decisions', path: '/dean/chair-recommendations', Icon: CheckCircle },
  { label: 'Settings', path: '/dean/settings', Icon: Settings },
];

export function DeanLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = getSession();
  const displayName = user?.fullName ?? 'Dr. Abdullah Al-Zahrani';

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Sidebar */}
      <aside style={{
        width: '260px', backgroundColor: '#002147',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{ padding: '1.25rem 1.5rem 0.4rem', fontSize: '0.68rem', fontWeight: '600', color: 'rgba(255,255,255,0.38)', letterSpacing: '0.12em', marginTop: '0.5rem' }}>
          MENU
        </div>

        <nav style={{ flex: 1, paddingBottom: '0.5rem' }}>
          {NAV_ITEMS.map(({ label, path, Icon }) => {
            const active = pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.7rem',
                  padding: '0.7rem 1.5rem',
                  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  border: 'none',
                  borderLeft: active ? '3px solid #FF6C37' : '3px solid transparent',
                  color: active ? 'white' : 'rgba(255,255,255,0.65)',
                  fontSize: '0.875rem', fontWeight: active ? '600' : '400',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'white'; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; } }}
              >
                <Icon size={17} style={{ flexShrink: 0 }} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <button
          onClick={() => { clearSession(); navigate('/'); }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.7rem',
            padding: '1rem 1.5rem', background: 'none', border: 'none',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            color: '#FF6C37', fontSize: '0.875rem', fontWeight: '500',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <LogOut size={17} />
          Logout
        </button>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <header style={{
          height: '64px', backgroundColor: 'white',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center',
          padding: '0 1.5rem', gap: '1.25rem', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: '260px' }}>
            <img src="/pmu-logo.png" alt="PMU" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: '700', color: '#002147', lineHeight: 1.2 }}>
                Academic Hiring Management System
              </div>
              <div style={{ fontSize: '0.67rem', color: '#6b7280' }}>Prince Mohammad Bin Fahad University</div>
            </div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '50%', border: '2px solid #002147', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserCircle size={20} color="#002147" />
            </div>
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: '600', color: '#002147', lineHeight: 1.2 }}>{displayName}</div>
              <div style={{ fontSize: '0.72rem', color: '#FF6C37', fontWeight: '500' }}>Dean - CCES</div>
            </div>
          </div>
        </header>

        <main style={{ flex: 1, overflow: 'auto', backgroundColor: '#f3f4f6', padding: '2rem' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
