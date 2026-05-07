import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Users, ClipboardCheck, CircleCheck, PlusCircle } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { DeanLayout } from '../components/DeanLayout';
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

interface Req {
  id: string;
  title: string;
  department: string;
  status: string;
  submittedAt: string;
  _ts: number;
}

export default function DeanDashboard() {
  const navigate = useNavigate();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(collection(db, 'requisitions'), snap => {
      const docs: Req[] = snap.docs.map(d => {
        const raw = d.data();
        const ts: Date | null = raw.submittedAt?.toDate?.() ?? null;
        return {
          id:           d.id,
          title:        getRequisitionPositionTitle(raw),
          department:   (raw.department as string) ?? '-',
          status:       norm((raw.status as string) ?? 'Pending HR'),
          submittedAt:  ts ? ts.toLocaleDateString('en-GB') : '-',
          _ts:          ts?.getTime() ?? 0,
        };
      }).sort((a, b) => b._ts - a._ts);
      setReqs(docs);
      setLoading(false);
    }, e => { console.error(e); setLoading(false); });
  }, []);

  const total          = reqs.length;
  const pendingHR      = reqs.filter(r => r.status === 'Pending HR').length;
  const withChair      = reqs.filter(r => r.status === 'With Chair').length;
  const decisionPend   = reqs.filter(r => r.status === 'Decision Pending').length;
  const completed      = reqs.filter(r => r.status === 'Completed').length;
  const pendingReqs    = reqs.filter(r => r.status === 'Decision Pending');
  const activeReqs     = reqs.filter(r => r.status !== 'Completed');
  const recentReqs     = activeReqs.slice(0, 6);

  const th: React.CSSProperties = { padding: '0.7rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: '600', color: '#6b7280', borderBottom: '1px solid #e5e7eb' };
  const td: React.CSSProperties = { padding: '0.85rem 1rem', fontSize: '0.85rem', color: '#374151', borderBottom: '1px solid #f3f4f6' };

  return (
    <DeanLayout>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#002147', marginBottom: '0.2rem' }}>Welcome back, Dean</h1>
          <p style={{ color: '#6b7280', fontSize: '0.95rem' }}>College of Computer Engineering &amp; Science</p>
        </div>
        <button
          onClick={() => navigate('/dean/create-requisition')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 1.25rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#003366'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#002147'; }}
        >
          <PlusCircle size={15} /> Create New Requisition
        </button>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.75rem' }}>
        {[
          { label: 'Total Requisitions', value: total,       iconBg: '#eef2ff', iconColor: '#6366f1', Icon: FileText },
          { label: 'Pending HR',         value: pendingHR,   iconBg: '#f3f4f6', iconColor: '#6b7280', Icon: FileText },
          { label: 'With Chair',         value: withChair,   iconBg: '#ede9fe', iconColor: '#6d28d9', Icon: Users },
          { label: 'Decision Pending',   value: decisionPend,iconBg: '#ffedd5', iconColor: '#c2410c', Icon: ClipboardCheck },
          { label: 'Completed',          value: completed,   iconBg: '#f0fdf4', iconColor: '#16a34a', Icon: CircleCheck },
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

        {/* Requisitions table */}
        <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.1rem 1.5rem', borderBottom: '1px solid #f3f4f6' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827' }}>My Job Requisitions</h2>
            <button
              onClick={() => navigate('/dean/my-requisitions')}
              style={{ fontSize: '0.82rem', color: '#002147', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '500' }}
            >
              View All →
            </button>
          </div>
          {loading ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>Loading requisitions…</div>
          ) : recentReqs.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
              {reqs.length === 0
                ? 'No requisitions yet. Create your first one.'
                : 'No active requisitions. Completed jobs are hidden here.'}
            </div>
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
                {recentReqs.map(r => {
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

        {/* Decision Pending panel */}
        <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem 1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827' }}>Final Decisions Pending</h2>
            {!loading && decisionPend > 0 && (
              <span style={{ backgroundColor: '#ffedd5', color: '#c2410c', padding: '0.15rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '700' }}>
                {decisionPend}
              </span>
            )}
          </div>
          {loading ? (
            <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</div>
          ) : pendingReqs.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: '0.875rem', padding: '1.5rem 0', textAlign: 'center' }}>
              No final decisions pending. Chair recommendations will appear here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {pendingReqs.map(r => (
                <div key={r.id} style={{ padding: '0.875rem 1rem', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.625rem' }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111827', marginBottom: '0.15rem' }}>{r.title}</p>
                  <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.5rem' }}>{r.department} · {r.id}</p>
                  <button
                    onClick={() => navigate('/dean/chair-recommendations')}
                    style={{ fontSize: '0.78rem', fontWeight: '600', color: '#c2410c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                  >
                    Review Final Decision →
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Shortlisted shortcut */}
          <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid #f3f4f6' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: '600', color: '#374151', marginBottom: '0.75rem' }}>Quick Actions</h3>
            {[
              { label: 'Review Shortlisted Candidates', path: '/dean/shortlisted-candidates' },
              { label: 'View All Requisitions', path: '/dean/my-requisitions' },
            ].map(({ label, path }) => (
              <button key={label}
                onClick={() => navigate(path)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 0.75rem', marginBottom: '0.4rem', fontSize: '0.82rem', color: '#002147', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '0.4rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '500' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#eef2ff'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </DeanLayout>
  );
}
