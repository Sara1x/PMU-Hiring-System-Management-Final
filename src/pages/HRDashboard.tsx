import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Users, UserCheck, CalendarCheck, Clock, AlertCircle } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { HRLayout } from '../components/HRLayout';
import { normalizeRequisitionStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  'Pending HR':          { bg: '#f3f4f6', color: '#6b7280' },
  'Screening':           { bg: '#ede9fe', color: '#6d28d9' },
  'With Chair':          { bg: '#ddd6fe', color: '#5b21b6' },
  'Pending Scheduling':  { bg: '#e0e7ff', color: '#3730a3' },
  'Interviewing':        { bg: '#dbeafe', color: '#1d4ed8' },
  'Under Evaluation':   { bg: '#ede9fe', color: '#6d28d9' },
  'Decision Pending':   { bg: '#ffedd5', color: '#c2410c' },
  'Completed':          { bg: '#dcfce7', color: '#15803d' },
};

function norm(s: string): string {
  return normalizeRequisitionStatus(s);
}

interface Req { id: string; title: string; department: string; status: string; submittedAt: string; _ts: number; }

export default function HRDashboard() {
  const navigate = useNavigate();
  const [reqs, setReqs]             = useState<Req[]>([]);
  const [candCounts, setCandCounts] = useState({ shortlisted: 0 });
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    let reqLoaded = false, candLoaded = false;
    const tryDone = () => { if (reqLoaded && candLoaded) setLoading(false); };

    const u1 = onSnapshot(collection(db, 'requisitions'), snap => {
      const docs: Req[] = snap.docs.map(d => {
        const raw = d.data();
        const ts: Date | null = raw.submittedAt?.toDate?.() ?? null;
        return { id: d.id, title: getRequisitionPositionTitle(raw), department: (raw.department as string) ?? '-',
          status: norm((raw.status as string) ?? 'Pending HR'),
          submittedAt: ts ? ts.toLocaleDateString('en-GB') : '-', _ts: ts?.getTime() ?? 0 };
      }).sort((a, b) => b._ts - a._ts);
      setReqs(docs);
      reqLoaded = true; tryDone();
    }, e => { console.error(e); reqLoaded = true; tryDone(); });

    const u2 = onSnapshot(collection(db, 'candidates'), snap => {
      let shortlisted = 0;
      snap.docs.forEach(d => {
        const st = (d.data().status as string) ?? '';
        if (st === 'Shortlisted') shortlisted++;
      });
      setCandCounts({ shortlisted });
      candLoaded = true; tryDone();
    }, e => { console.error(e); candLoaded = true; tryDone(); });

    return () => { u1(); u2(); };
  }, []);

  const newReqs           = reqs.filter(r => r.status === 'Pending HR').length;
  const screening         = reqs.filter(r => r.status === 'Screening').length;
  const pendingScheduling = reqs.filter(r => r.status === 'Pending Scheduling').length;
  const interviewing      = reqs.filter(r => r.status === 'Interviewing').length;
  const scheduled         = interviewing;
  const completedCom      = reqs.filter(r =>
    r.status === 'Under Evaluation' ||
    r.status === 'Decision Pending' ||
    r.status === 'Completed'
  ).length;

  // Table shows every stage where HR has an active responsibility
  const activeReqs = reqs.filter(r =>
    r.status === 'Pending HR' ||
    r.status === 'Screening'  ||
    r.status === 'Pending Scheduling' ||
    r.status === 'Interviewing'
  );

  const th: React.CSSProperties = { padding: '0.7rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: '600', color: '#6b7280', borderBottom: '1px solid #e5e7eb' };
  const td: React.CSSProperties = { padding: '0.85rem 1rem', fontSize: '0.85rem', color: '#374151', borderBottom: '1px solid #f3f4f6' };

  return (
    <HRLayout>
      <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#002147', marginBottom: '0.2rem' }}>Welcome back, HR Manager</h1>
      <p style={{ color: '#6b7280', marginBottom: '1.75rem', fontSize: '0.95rem' }}>Academic Recruitment — HR Dashboard</p>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        {[
          { label: 'New Requisitions',    value: newReqs,              iconBg: '#eef2ff', iconColor: '#6366f1', Icon: FileText,      urgent: false },
          { label: 'Pending Scheduling',  value: pendingScheduling,    iconBg: '#fef3c7', iconColor: '#d97706', Icon: AlertCircle,   urgent: pendingScheduling > 0 },
          { label: 'Interviews Scheduled',value: scheduled,            iconBg: '#f0fdf4', iconColor: '#16a34a', Icon: CalendarCheck, urgent: false },
        ].map(({ label, value, iconBg, iconColor, Icon, urgent }) => (
          <div key={label} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem', boxShadow: urgent ? '0 0 0 2px #f59e0b' : '0 1px 3px rgba(0,0,0,0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '0.5rem', backgroundColor: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={20} color={iconColor} />
              </div>
              {urgent && <span style={{ fontSize: '0.7rem', fontWeight: '700', backgroundColor: '#fef3c7', color: '#b45309', padding: '0.2rem 0.5rem', borderRadius: '999px' }}>ACTION NEEDED</span>}
            </div>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.2rem' }}>{label}</p>
            <p style={{ fontSize: '1.9rem', fontWeight: '700', color: urgent ? '#d97706' : '#111827', lineHeight: 1 }}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.75rem' }}>
        {[
          { label: 'Pending Screening',      value: screening,             iconBg: '#fff7ed', iconColor: '#f97316', Icon: Clock },
          { label: 'Shortlisted Candidates', value: candCounts.shortlisted, iconBg: '#eff6ff', iconColor: '#3b82f6', Icon: UserCheck },
          { label: 'Completed Interviews',   value: completedCom,          iconBg: '#dcfce7', iconColor: '#15803d', Icon: Users },
        ].map(({ label, value, iconBg, iconColor, Icon }) => (
          <div key={label} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '0.5rem', backgroundColor: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.875rem' }}>
              <Icon size={20} color={iconColor} />
            </div>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.2rem' }}>{label}</p>
            <p style={{ fontSize: '1.9rem', fontWeight: '700', color: '#111827', lineHeight: 1 }}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '1.25rem' }}>

        {/* Active Requisitions table */}
        <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.1rem 1.5rem', borderBottom: '1px solid #f3f4f6' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827' }}>Active Requisitions</h2>
            <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>All stages requiring HR action</span>
          </div>
          {loading ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>Loading…</div>
          ) : activeReqs.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>No active requisitions.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#fafafa' }}>
                  <th style={th}>ID</th>
                  <th style={th}>Position Title</th>
                  <th style={th}>Department</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {activeReqs.map(r => {
                  const s = STATUS_STYLES[r.status] ?? { bg: '#f3f4f6', color: '#6b7280' };
                  return (
                    <tr key={r.id}
                      onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#fafafa'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'white'; }}>
                      <td style={{ ...td, fontSize: '0.75rem', color: '#002147', fontWeight: '600' }}>{r.id}</td>
                      <td style={td}>{r.title}</td>
                      <td style={td}>{r.department}</td>
                      <td style={td}>
                        <span style={{ backgroundColor: s.bg, color: s.color, padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.74rem', fontWeight: '600' }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ ...td, color: '#9ca3af', fontSize: '0.78rem' }}>{r.submittedAt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Quick actions */}
        <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem 1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '1rem' }}>HR Actions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {[
              { label: 'Manage Candidates', sub: 'Screen, shortlist, or reject CVs', path: '/hr/candidate-management', border: '#6366f1', bg: '#eef2ff' },
              { label: 'Shortlist Builder', sub: 'Build and send shortlist to Dean', path: '/hr/shortlist-builder', border: '#f97316', bg: '#fff7ed' },
              { label: 'Interview Scheduling', sub: 'Schedule and manage interviews', path: '/hr/interview-scheduling', border: '#16a34a', bg: '#f0fdf4' },
              { label: 'View Requisitions', sub: 'All requisitions from Dean', path: '/hr/requisitions', border: '#3b82f6', bg: '#eff6ff' },
            ].map(({ label, sub, path, border, bg }) => (
              <button key={label} onClick={() => navigate(path)}
                style={{ textAlign: 'left', padding: '0.875rem 1rem', borderRadius: '0.625rem', border: 'none', borderLeft: `4px solid ${border}`, backgroundColor: bg, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                <p style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111827', marginBottom: '0.15rem' }}>{label}</p>
                <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>{sub}</p>
              </button>
            ))}
          </div>

          {pendingScheduling > 0 && (
            <div
              onClick={() => navigate('/hr/interview-scheduling')}
              style={{ marginTop: '1.25rem', padding: '0.875rem 1rem', backgroundColor: '#fef3c7', border: '2px solid #f59e0b', borderRadius: '0.625rem', cursor: 'pointer' }}
            >
              <p style={{ fontSize: '0.82rem', fontWeight: '700', color: '#b45309', marginBottom: '0.2rem' }}>
                ⚠ {pendingScheduling} requisition{pendingScheduling !== 1 ? 's' : ''} awaiting scheduling
              </p>
              <p style={{ fontSize: '0.75rem', color: '#92400e' }}>
                The Chair has submitted committee{pendingScheduling !== 1 ? 's' : ''}. Go to Interview Scheduling to propose dates and meeting links—the Department Chair approves before interviews are confirmed for interviewers.
              </p>
            </div>
          )}
          {interviewing > 0 && (
            <div style={{ marginTop: pendingScheduling > 0 ? '0.6rem' : '1.25rem', padding: '0.875rem 1rem', backgroundColor: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: '0.625rem' }}>
              <p style={{ fontSize: '0.82rem', fontWeight: '600', color: '#1d4ed8', marginBottom: '0.15rem' }}>
                {interviewing} requisition{interviewing !== 1 ? 's' : ''} currently interviewing
              </p>
              <p style={{ fontSize: '0.75rem', color: '#2563eb' }}>Interviews in progress. Evaluations pending from interviewers.</p>
            </div>
          )}
          {screening > 0 && (
            <div style={{ marginTop: '0.6rem', padding: '0.875rem 1rem', backgroundColor: '#ede9fe', border: '1px solid #ddd6fe', borderRadius: '0.625rem' }}>
              <p style={{ fontSize: '0.82rem', fontWeight: '600', color: '#6d28d9', marginBottom: '0.15rem' }}>
                {screening} requisition{screening !== 1 ? 's' : ''} in Screening
              </p>
              <p style={{ fontSize: '0.75rem', color: '#7c3aed' }}>Candidates awaiting shortlist submission to Dean.</p>
            </div>
          )}
        </div>
      </div>
    </HRLayout>
  );
}
