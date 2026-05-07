import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter, Search } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { DeanLayout } from '../components/DeanLayout';
import { normalizeRequisitionStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';

interface Requisition {
  id: string;
  title: string;
  department: string;
  status: string;
  applicationsCount: number;
  shortlistedCount: number;
  submittedAt: string;
}

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

const ALL_STATUSES = [
  'All Statuses',
  'Pending HR',
  'Screening',
  'With Chair',
  'Pending Scheduling',
  'Interviewing',
  'Under Evaluation',
  'Decision Pending',
  'Completed',
] as const;

export default function MyRequisitions() {
  const navigate = useNavigate();
  const [countsByReq, setCountsByReq] = useState<Map<string, { applicationsCount: number; shortlistedCount: number }>>(new Map());
  const [reqBase, setReqBase] = useState<Array<Omit<Requisition, 'applicationsCount' | 'shortlistedCount'> & { _ts: number }>>([]);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof ALL_STATUSES)[number]>('All Statuses');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'requisitions'),
      (snapshot) => {
        const base = snapshot.docs
          .map(d => {
            const raw = d.data();
            const ts: Date | null = raw.submittedAt?.toDate?.() ?? null;
            return {
              id:                d.id,
              title:             getRequisitionPositionTitle(raw),
              department:        (raw.department         as string) ?? '-',
              status:            normalizeRequisitionStatus((raw.status as string) ?? 'Pending HR'),
              submittedAt:       ts ? ts.toLocaleDateString('en-GB') : '-',
              _ts:               ts?.getTime() ?? 0,
            };
          })
          .sort((a, b) => b._ts - a._ts);
        setReqBase(base);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setError('Failed to load requisitions.');
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    setRequisitions(
      reqBase.map(({ _ts, ...r }) => ({
        ...r,
        applicationsCount: countsByReq.get(r.id)?.applicationsCount ?? 0,
        shortlistedCount: countsByReq.get(r.id)?.shortlistedCount ?? 0,
      }))
    );
  }, [reqBase, countsByReq]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'candidates'),
      (snapshot) => {
        const next = new Map<string, { applicationsCount: number; shortlistedCount: number }>();
        snapshot.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          const rid = (data.requisitionId as string) ?? '';
          if (!rid) return;
          const status = (data.status as string) ?? '';

          const cur = next.get(rid) ?? { applicationsCount: 0, shortlistedCount: 0 };
          cur.applicationsCount += 1;
          if (status === 'Shortlisted') cur.shortlistedCount += 1;
          next.set(rid, cur);
        });
        setCountsByReq(next);
      },
      (e) => console.error(e)
    );
    return unsub;
  }, []);

  const statusFiltered = requisitions.filter(r => {
    if (statusFilter === 'Completed') return r.status === 'Completed';
    if (statusFilter === 'All Statuses') return r.status !== 'Completed';
    return r.status === statusFilter;
  });

  const filtered = statusFiltered.filter(r => {
    const matchSearch = r.title.toLowerCase().includes(search.toLowerCase())
      || r.department.toLowerCase().includes(search.toLowerCase())
      || r.id.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  const thStyle: React.CSSProperties = { padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.8rem', fontWeight: '600', color: '#6b7280', borderBottom: '1px solid #e5e7eb' };
  const tdStyle: React.CSSProperties = { padding: '1rem', fontSize: '0.875rem', color: '#374151', borderBottom: '1px solid #f3f4f6' };

  return (
    <DeanLayout>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>My Job Requisitions</h1>
          <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Manage and track all job requisitions for CCES</p>
        </div>
        <button
          onClick={() => navigate('/dean/create-requisition')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.7rem 1.25rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#003366'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#002147'; }}
        >
          + Create New Requisition
        </button>
      </div>

      <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        {/* Filter bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.25rem', borderBottom: '1px solid #f3f4f6' }}>
          <Filter size={16} color="#6b7280" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as (typeof ALL_STATUSES)[number])}
            style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.4rem', fontSize: '0.85rem', color: '#374151', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            {ALL_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            <input
              type="text"
              placeholder="Search requisitions..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.75rem 0.45rem 2rem', border: '1px solid #d1d5db', borderRadius: '0.4rem', fontSize: '0.85rem', color: '#374151', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', fontSize: '0.9rem' }}>Loading requisitions…</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626', fontSize: '0.9rem' }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', fontSize: '0.9rem' }}>No requisitions found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#fafafa' }}>
                <th style={thStyle}>Requisition ID</th>
                <th style={thStyle}>Position Title</th>
                <th style={thStyle}>Department</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const s = STATUS_STYLES[r.status] ?? { bg: '#f3f4f6', color: '#6b7280' };
                return (
                  <tr key={r.id}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#fafafa'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'white'; }}>
                    <td style={{ ...tdStyle, color: '#002147', fontWeight: '500', fontSize: '0.78rem' }}>{r.id}</td>
                    <td style={tdStyle}>{r.title}</td>
                    <td style={tdStyle}>{r.department}</td>
                    <td style={tdStyle}>
                      <span style={{ backgroundColor: s.bg, color: s.color, padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: '500' }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={tdStyle}>{r.submittedAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {!loading && !error && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderTop: '1px solid #f3f4f6' }}>
            <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>Showing {filtered.length} of {statusFiltered.length} requisitions</p>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {['Previous', '1', 'Next'].map(label => (
                <button key={label} style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.35rem', background: label === '1' ? '#002147' : 'white', color: label === '1' ? 'white' : '#374151', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </DeanLayout>
  );
}
