import { useMemo, useState, useEffect } from 'react';
import { Search, Filter, Clock, CheckCircle, XCircle, PlusCircle, ArrowUpCircle, Sparkles, RefreshCw } from 'lucide-react';
import { UserCircle } from 'lucide-react';
import { HRLayout } from '../components/HRLayout';
import { AIAnalysisCard } from '../components/AIAnalysisCard';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeRequisitionStatus, type RequisitionStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';
import { generateMatchingCandidates, extractCandidateSourcingError } from '../services/aiService';

interface Candidate {
  id: string;
  name: string;
  email: string;
  education: string;
  experience: string;
  position: string;
  status: string;
  /** Dean Hire / Not Hire when stored separately from legacy HR status. */
  finalDecision?: string;
  requisitionId: string;
  skills?: string;
  publications?: string;
  sourceUrl?: string;
  cvUrl?: string;
  sourceType?: string;
  matchScore?: number;
  /** Set when Cloud Functions confirmed both URLs returned HTTP success for the server probe. */
  linksVerified?: boolean;
}

/** Requisitions HR can open to view/manage applicants (not deleted when workflow advances past Screening). */
const HR_CANDIDATE_REQ_STATUSES: RequisitionStatus[] = [
  'Screening',
  'With Dean',
  'With Chair',
  'Pending Scheduling',
  'Interviewing',
  'Under Evaluation',
  'Decision Pending',
  'Completed',
];

interface HRCandidateReq {
  id: string;
  title: string;
  department: string;
  status: RequisitionStatus;
}

const STATUS_STYLE: Record<string, { color: string; Icon: typeof Clock }> = {
  'Pending':    { color: '#2563eb', Icon: PlusCircle },
  'Shortlisted':{ color: '#16a34a', Icon: CheckCircle },
  'Interviewed':{ color: '#7c3aed', Icon: ArrowUpCircle },
  'Hired':      { color: '#15803d', Icon: CheckCircle },
  'Not Hired':  { color: '#dc2626', Icon: XCircle },
  'Rejected':   { color: '#dc2626', Icon: XCircle },
};

const STATUS_LABEL: Record<string, string> = {
  'Pending':    'Pending',
  'Shortlisted':'Shortlisted',
  'Interviewed':'Interviewed',
  'Hired':      'Hired',
  'Not Hired':  'Not Hired',
  'Rejected':   'Rejected',
};

const STATUSES = ['All Status', 'Pending', 'Shortlisted', 'Interviewed', 'Hired', 'Not Hired', 'Rejected'];

function hasDeanFinalOutcome(status: string, finalDecision?: string): boolean {
  const fd = (finalDecision ?? '').trim();
  if (fd === 'Hired' || fd === 'Not Hired') return true;
  const st = (status ?? '').trim();
  return st === 'Hired' || st === 'Not Hired';
}

function mapDoc(id: string, data: Record<string, unknown>): Candidate {
  const pub = data.publications;
  return {
    id,
    name:          (data.full_name        as string) || (data.name as string) || '-',
    email:         (data.email            as string) || '-',
    education:     (data.degree           as string) || (data.education as string) || '-',
    experience:    typeof data.experience === 'string' && data.experience.trim()
      ? data.experience
      : data.years_experience != null
        ? String(data.years_experience) + ' years'
        : '-',
    position:      (data.position_applied as string) || (data.requisitionTitle as string) || '-',
    status:        (data.status           as string) || 'Pending',
    finalDecision:
      typeof data.finalDecision === 'string' && data.finalDecision.trim()
        ? data.finalDecision.trim()
        : undefined,
    requisitionId: (data.requisitionId    as string) || '',
    skills:        typeof data.skills === 'string' ? data.skills : '',
    sourceUrl:     typeof data.sourceUrl === 'string' ? data.sourceUrl : '',
    cvUrl:         typeof data.cvUrl === 'string' ? data.cvUrl : '',
    sourceType:    typeof data.sourceType === 'string' ? data.sourceType : '',
    matchScore:    typeof data.matchScore === 'number' ? data.matchScore : undefined,
    linksVerified: data.linksVerified === true,
    publications:
      typeof pub === 'string' && pub.trim()
        ? pub
        : data.publications_count != null
          ? String(data.publications_count) + ' publications'
          : '',
  };
}

export default function CandidateManagement() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hrCandidateReqs, setHrCandidateReqs] = useState<HRCandidateReq[]>([]);
  const [selectedReqId, setSelectedReqId]   = useState('');
  const [generatingGemini, setGeneratingGemini] = useState(false);
  const [geminiMsg, setGeminiMsg]           = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!selectedReqId) {
      setCandidates([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, 'candidates'),
      where('requisitionId', '==', selectedReqId)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const mapped = snapshot.docs.map(d => mapDoc(d.id, d.data() as Record<string, unknown>));
        setCandidates(mapped);
        setError(null);
        setLoading(false);
      },
      (e) => {
        setError('Failed to load candidates. Check your Firestore connection.');
        console.error(e);
        setLoading(false);
      }
    );
    return unsub;
  }, [selectedReqId]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'requisitions'),
      (snap) => {
        const reqs: HRCandidateReq[] = [];
        snap.docs.forEach(d => {
          const raw    = d.data() as Record<string, unknown>;
          const status = normalizeRequisitionStatus((raw.status as string) ?? '');
          if (!HR_CANDIDATE_REQ_STATUSES.includes(status)) return;
          reqs.push({
            id:         d.id,
            title:      getRequisitionPositionTitle(raw),
            department: (raw.department as string) ?? '-',
            status,
          });
        });
        reqs.sort((a, b) => a.id.localeCompare(b.id));
        setHrCandidateReqs(reqs);
      },
      (e) => console.error(e)
    );
    return unsub;
  }, []);

  const selectedReq = useMemo(
    () => hrCandidateReqs.find(r => r.id === selectedReqId) ?? null,
    [hrCandidateReqs, selectedReqId]
  );

  const downloadCV = (cvUrl: string) => {
    window.open(cvUrl, '_blank', 'noopener,noreferrer');
  };

  const updateStatus = async (id: string, status: string) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    try {
      await updateDoc(doc(db, 'candidates', id), { status });
    } catch (e) {
      console.error('Failed to update status in Firestore:', e);
    }
  };

  const handleGenerateGemini = async () => {
    if (!selectedReqId) return;
    setGeneratingGemini(true);
    setGeminiMsg(null);
    try {
      const res = await generateMatchingCandidates(selectedReqId);
      let type: 'success' | 'warning' | 'error' = 'success';
      let detail: string;
      if (res.created === 0) {
        type = 'warning';
        detail = `No new candidates were added this run — all generated profiles were duplicates of existing ones. Click Regenerate to get a fresh batch.`;
      } else if (res.suggestRegenerate) {
        type = 'warning';
        detail = res.message ?? `Added ${res.created} candidate${res.created === 1 ? '' : 's'}. Click Regenerate to add more until you have enough.`;
      } else {
        detail = res.message ?? `Successfully added ${res.created} candidate${res.created === 1 ? '' : 's'} for this requisition.`;
      }
      setGeminiMsg({ type, text: detail });
    } catch (e) {
      setGeminiMsg({ type: 'error', text: extractCandidateSourcingError(e) });
    } finally {
      setGeneratingGemini(false);
    }
  };

  const filtered = useMemo(() => candidates.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'All Status' || c.status === statusFilter;
    return matchSearch && matchStatus;
  }), [candidates, search, statusFilter]);

  const counts = {
    total:      candidates.length,
    pending:    candidates.filter(c => c.status === 'Pending').length,
    shortlisted:candidates.filter(c => c.status === 'Shortlisted').length,
    interviewed:candidates.filter(c => c.status === 'Interviewed').length,
    rejected:   candidates.filter(c => c.status === 'Rejected').length,
  };

  const selectStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '0.82rem', color: '#374151', outline: 'none', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: 'white' };

  const geminiAllowedForSelection = selectedReq?.status === 'Screening';
  const geminiDisabled = !selectedReqId || generatingGemini || !geminiAllowedForSelection;

  return (
    <HRLayout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827' }}>Candidate Management</h1>
      </div>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        Choose a requisition to view every applicant tied to it. Statuses filter with the dropdown below.
        Gemini sourcing is available only while the job is in <strong style={{ color: '#374151' }}>Screening</strong> (typically up to 10 profiles per click—use Regenerate until you have enough).
      </p>

      {/* Requisition + Gemini */}
      <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem 1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', marginBottom: '1.25rem', border: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '1rem' }}>
          <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: '#374151', marginBottom: '0.35rem' }}>
              Requisition
            </label>
            <select
              value={selectedReqId}
              onChange={e => {
                setSelectedReqId(e.target.value);
                setGeminiMsg(null);
              }}
              style={{ width: '100%', padding: '0.55rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.85rem', fontFamily: 'inherit', backgroundColor: 'white', cursor: 'pointer' }}
            >
              <option value="">— Select a requisition —</option>
              {hrCandidateReqs.map(r => (
                <option key={r.id} value={r.id}>
                  {r.id} — {r.title} ({r.department})
                </option>
              ))}
            </select>
            {hrCandidateReqs.length === 0 && (
              <p style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.4rem' }}>
                No active requisitions yet. Publish a requisition past Pending HR to manage candidates here.
              </p>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleGenerateGemini}
              disabled={geminiDisabled}
              title={!geminiAllowedForSelection && selectedReqId ? 'Move this requisition back to Screening (or pick a Screening job) to run Gemini sourcing.' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.6rem 1.15rem',
                backgroundColor: geminiDisabled ? '#9ca3af' : '#002147',
                border: 'none',
                borderRadius: '0.5rem',
                color: 'white',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: geminiDisabled ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              <Sparkles size={18} />
              {generatingGemini ? 'Searching…' : 'Find Real Matching CVs with Gemini'}
            </button>
            <button
              type="button"
              onClick={handleGenerateGemini}
              disabled={geminiDisabled}
              title="Runs sourcing again and adds more unique candidates until you are satisfied"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.6rem 1rem',
                backgroundColor: geminiDisabled ? '#f3f4f6' : 'white',
                border: `1px solid ${geminiDisabled ? '#e5e7eb' : '#002147'}`,
                borderRadius: '0.5rem',
                color: geminiDisabled ? '#9ca3af' : '#002147',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: geminiDisabled ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              <RefreshCw size={17} />
              {generatingGemini ? 'Working…' : 'Regenerate / add more'}
            </button>
          </div>
        </div>
        {geminiMsg && (
          <p style={{
            marginTop: '0.85rem',
            fontSize: '0.82rem',
            fontWeight: '600',
            color:
              geminiMsg.type === 'success'
                ? '#15803d'
                : geminiMsg.type === 'warning'
                  ? '#b45309'
                  : '#dc2626',
          }}>
            {geminiMsg.text}
          </p>
        )}
        {selectedReq && (
          <p style={{ marginTop: '0.65rem', fontSize: '0.78rem', color: '#6b7280' }}>
            Viewing candidates for <strong style={{ color: '#374151' }}>{selectedReq.id}</strong> — {selectedReq.title}
          </p>
        )}
      </div>

      {/* Stats — scoped to selected requisition */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
        {[['Total Candidates', counts.total], ['Pending', counts.pending], ['Shortlisted', counts.shortlisted], ['Interviewed', counts.interviewed], ['Rejected', counts.rejected]].map(([label, val]) => (
          <div key={label} style={{ backgroundColor: 'white', borderRadius: '0.75rem', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
            <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '0.4rem' }}>{label}</p>
            <p style={{ fontSize: '1.75rem', fontWeight: '700', color: '#111827' }}>{val}</p>
          </div>
        ))}
      </div>

      <div style={{ backgroundColor: 'white', borderRadius: '0.75rem', padding: '1rem 1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input type="text" placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '0.5rem 0.75rem 0.5rem 2.1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '0.82rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', ...selectStyle }}>
          <Filter size={14} color="#6b7280" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '0.82rem', color: '#374151', cursor: 'pointer', fontFamily: 'inherit', backgroundColor: 'transparent' }}>
            {STATUSES.map(s => <option key={s} value={s}>{s === 'All Status' ? 'All Status' : (STATUS_LABEL[s] ?? s)}</option>)}
          </select>
        </div>
        <p style={{ fontSize: '0.82rem', color: '#6b7280', marginLeft: '0.25rem' }}>
          {selectedReqId ? `Showing ${filtered.length} of ${candidates.length} for this requisition` : 'Select a requisition'}
        </p>
      </div>

      {!selectedReqId ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', fontSize: '0.9rem', backgroundColor: 'white', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          Select a requisition above.
        </div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', fontSize: '0.9rem' }}>Loading candidates…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626', fontSize: '0.9rem', backgroundColor: 'white', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>{error}</div>
      ) : candidates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', fontSize: '0.9rem', backgroundColor: 'white', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          No real candidates found
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', fontSize: '0.9rem', backgroundColor: 'white', borderRadius: '0.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>No candidates match the current filters.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filtered.map(c => {
            const s = STATUS_STYLE[c.status] ?? { color: '#6b7280', Icon: Clock };
            const SIcon = s.Icon;
            const isShortlisted = c.status === 'Shortlisted';
            const isRejected = c.status === 'Rejected';
            const deanResolved = hasDeanFinalOutcome(c.status, c.finalDecision);
            const linksVerified = c.linksVerified === true;
            const detailCols: [string, string][] = [
              ['Education', c.education],
              ['Experience', c.experience],
              ['Position Title', c.position],
            ];
            if (c.skills) detailCols.push(['Skills', c.skills]);
            if (c.publications) detailCols.push(['Publications', c.publications]);
            if (typeof c.matchScore === 'number') detailCols.push(['Match Score', `${c.matchScore}/100`]);

            return (
              <div key={c.id} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1.5px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <UserCircle size={30} color="#9ca3af" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div>
                        <p style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '0.15rem' }}>{c.name}</p>
                        <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '0.1rem' }}>{c.email}</p>
                        <p style={{ fontSize: '0.82rem', color: '#374151' }}>{c.position}</p>
                      </div>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: s.color, fontSize: '0.85rem', fontWeight: '600' }}>
                          <SIcon size={14} />{STATUS_LABEL[c.status] ?? c.status}
                        </span>
                    </div>
                  </div>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: detailCols.length <= 3 ? 'repeat(3, 1fr)' : 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid #f3f4f6',
                }}>
                  {detailCols.map(([label, val]) => (
                    <div key={label}>
                      <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.2rem' }}>{label}</p>
                      <p style={{ fontSize: '0.875rem', color: '#111827', fontWeight: '500' }}>{val}</p>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {linksVerified && c.cvUrl && (
                    <button type="button" onClick={() => downloadCV(c.cvUrl!)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '0.5rem', color: '#374151', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Download CV
                    </button>
                  )}
                  {linksVerified && c.sourceUrl && (
                    <button type="button" onClick={() => window.open(c.sourceUrl, '_blank', 'noopener,noreferrer')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '0.5rem', color: '#374151', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                      View Source
                    </button>
                  )}
                  {!linksVerified && (c.cvUrl || c.sourceUrl) && (
                    <div style={{ fontSize: '0.78rem', color: '#92400e', lineHeight: 1.45, flex: '1 1 220px' }}>
                      <span style={{ fontWeight: '600', color: '#78350f' }}>Links not server-verified.</span>
                      {' '}They may be outdated or guessed—often they 404. Use <strong>Regenerate</strong> for new batches with checked URLs, or try manually:
                      {c.cvUrl ? (
                        <>
                          {' '}
                          <a href={c.cvUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', fontWeight: '600' }}>CV</a>
                        </>
                      ) : null}
                      {c.cvUrl && c.sourceUrl ? ' · ' : null}
                      {c.sourceUrl ? (
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', fontWeight: '600' }}>Source</a>
                      ) : null}
                    </div>
                  )}
                  {!deanResolved && !isRejected && (
                    <button
                      disabled={isShortlisted}
                      onClick={() => updateStatus(c.id, 'Shortlisted')}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: isShortlisted ? '#f0fdf4' : '#002147', border: `1px solid ${isShortlisted ? '#bbf7d0' : '#002147'}`, borderRadius: '0.5rem', color: isShortlisted ? '#16a34a' : 'white', fontSize: '0.82rem', fontWeight: '600', cursor: isShortlisted ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                      {isShortlisted ? 'Shortlisted' : 'Add to Shortlist'}
                    </button>
                  )}
                  {!deanResolved && !isShortlisted && (
                    <button
                      disabled={isRejected}
                      onClick={() => updateStatus(c.id, 'Rejected')}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: isRejected ? '#fef2f2' : 'white', border: `1px solid ${isRejected ? '#fecaca' : '#dc2626'}`, borderRadius: '0.5rem', color: '#dc2626', fontSize: '0.82rem', fontWeight: '600', cursor: isRejected ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                      {isRejected ? 'Rejected' : 'Reject'}
                    </button>
                  )}
                </div>
                {c.status === 'Pending' && (
                  <AIAnalysisCard candidateId={c.id} stage="hr" candidateName={c.name} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </HRLayout>
  );
}
