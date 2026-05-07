import { useEffect, useState } from 'react';
import { CheckCircle, Clock, UserCircle, XCircle } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { ChairLayout } from '../components/ChairLayout';
import { db } from '../firebase';
import { getSession } from '../utils/session';

interface CandidateStatusRow {
  id: string; // committeeId::candidateId
  committeeId: string;
  candidateId: string;
  candidateName: string;
  candidatePosition: string;
  requisitionId: string;
  committeeDepartment: string;
  chairRecommendation: string;
  deanDecision: 'Accepted' | 'Rejected' | 'Pending Decision';
  latestEvalTs: number;
}

interface CommitteeMeta {
  department: string;
  requisitionId: string;
  chairName: string;
  chairRecommendation: string;
  candidates: Array<{ id: string; name: string; position?: string }>;
}

const REC_BADGE: Record<string, { bg: string; color: string }> = {
  'Strongly Agree':    { bg: '#dcfce7', color: '#15803d' },
  'Agree':             { bg: '#dbeafe', color: '#1d4ed8' },
  'Neutral':           { bg: '#fef9c3', color: '#92400e' },
  'Disagree':          { bg: '#fee2e2', color: '#dc2626' },
  'Strongly Disagree': { bg: '#fecaca', color: '#991b1b' },
  'Pending':           { bg: '#f3f4f6', color: '#6b7280' },
};

const DEAN_STYLE: Record<'Accepted' | 'Rejected' | 'Pending Decision', { color: string; bg: string; Icon: typeof CheckCircle }> = {
  'Accepted':         { color: '#15803d', bg: '#dcfce7', Icon: CheckCircle },
  'Rejected':         { color: '#dc2626', bg: '#fee2e2', Icon: XCircle },
  'Pending Decision': { color: '#6b7280', bg: '#f3f4f6', Icon: Clock },
};

function normalizeDeanDecision(raw: unknown): 'Accepted' | 'Rejected' | 'Pending Decision' {
  const v = String(raw ?? '').trim();
  if (v === 'Hired' || v === 'Accepted' || v === 'Approved') return 'Accepted';
  if (v === 'Not Hired' || v === 'Rejected') return 'Rejected';
  return 'Pending Decision';
}

export default function ChairCandidateStatus() {
  const [rows, setRows] = useState<CandidateStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const chairName = (getSession()?.fullName ?? '').trim().toLowerCase();

  useEffect(() => {
    let committeesById: Record<string, CommitteeMeta> = {};
    let candidateDecisionById: Record<string, unknown> = {};
    let evalGroups = new Map<string, { count: number; latestTs: number }>();

    const emit = () => {
      const allCommitteeEntries = Object.entries(committeesById);
      const myCommittees = allCommitteeEntries.filter(([, cm]) =>
        chairName ? cm.chairName.trim().toLowerCase() === chairName : true
      );
      const committeesToUse = myCommittees.length > 0 ? myCommittees : allCommitteeEntries;

      const built: CandidateStatusRow[] = [];

      committeesToUse.forEach(([committeeId, cm]) => {
        cm.candidates.forEach(c => {
          if (!c.id) return;
          const key = `${committeeId}::${c.id}`;
          const evalInfo = evalGroups.get(key) ?? { count: 0, latestTs: 0 };

          built.push({
            id: key,
            committeeId,
            candidateId: c.id,
            candidateName: c.name || '-',
            candidatePosition: c.position || '-',
            requisitionId: cm.requisitionId || '-',
            committeeDepartment: cm.department || '-',
            chairRecommendation: cm.chairRecommendation || 'Pending',
            deanDecision: normalizeDeanDecision(candidateDecisionById[c.id]),
            latestEvalTs: evalInfo.latestTs,
          });
        });
      });

      built.sort((a, b) => {
        const deanOrder = (d: CandidateStatusRow['deanDecision']) =>
          d === 'Pending Decision' ? 0 : d === 'Accepted' ? 1 : 2;
        const ao = deanOrder(a.deanDecision);
        const bo = deanOrder(b.deanDecision);
        if (ao !== bo) return ao - bo;
        if (b.latestEvalTs !== a.latestEvalTs) return b.latestEvalTs - a.latestEvalTs;
        return a.candidateName.localeCompare(b.candidateName, undefined, { sensitivity: 'base' });
      });
      setRows(built);
      setLoading(false);
    };

    const u1 = onSnapshot(
      collection(db, 'committees'),
      (snap) => {
        const next: Record<string, CommitteeMeta> = {};
        snap.docs.forEach(d => {
          const raw = d.data() as Record<string, unknown>;
          const candidates = (raw.candidates as Array<{ id?: string; name?: string; position?: string }> | undefined) ?? [];
          next[d.id] = {
            department: (raw.department as string) ?? '-',
            requisitionId: (raw.requisitionId as string) ?? '-',
            chairName: (raw.chairName as string) ?? '',
            chairRecommendation: (raw.chairRecommendation as string) ?? 'Pending',
            candidates: candidates.map(c => ({ id: c.id ?? '', name: c.name ?? '-', position: c.position ?? '-' })),
          };
        });
        committeesById = next;
        emit();
      },
      (e) => { console.error(e); setLoading(false); }
    );

    const u2 = onSnapshot(
      collection(db, 'evaluations'),
      (snap) => {
        const groups = new Map<string, { count: number; latestTs: number }>();
        snap.docs.forEach(d => {
          const raw = d.data() as Record<string, unknown>;
          const committeeId = (raw.committeeId as string) ?? '';
          const candidateId = (raw.candidateId as string) ?? '';
          const ratings = raw.ratings as Record<string, number> | undefined;
          const scoreVals = ratings ? Object.values(ratings).filter(v => typeof v === 'number' && Number.isFinite(v)) : [];
          if (!committeeId || !candidateId || scoreVals.length === 0) return;

          const key = `${committeeId}::${candidateId}`;
          const submittedTs = (raw.submittedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
          const current = groups.get(key) ?? { count: 0, latestTs: 0 };
          current.count += 1;
          if (submittedTs > current.latestTs) current.latestTs = submittedTs;
          groups.set(key, current);
        });
        evalGroups = groups;
        emit();
      },
      (e) => { console.error(e); setLoading(false); }
    );

    const u3 = onSnapshot(
      collection(db, 'candidates'),
      (snap) => {
        const next: Record<string, unknown> = {};
        snap.docs.forEach(d => {
          const raw = d.data() as Record<string, unknown>;
          next[d.id] = raw.finalDecision ?? raw.status;
        });
        candidateDecisionById = next;
        emit();
      },
      (e) => { console.error(e); setLoading(false); }
    );

    return () => { u1(); u2(); u3(); };
  }, [chairName]);

  return (
    <ChairLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>
        Candidate Decision Tracking
      </h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
        Track evaluation progress, Chair recommendation, and Dean final decision in real time.
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          No committee candidates found yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {rows.map(r => {
            const recStyle = REC_BADGE[r.chairRecommendation] ?? REC_BADGE['Pending'];
            const deanStyle = DEAN_STYLE[r.deanDecision];
            const DeanIcon = deanStyle.Icon;
            return (
              <div key={r.id} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem 1.4rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.8rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div style={{ width: '44px', height: '44px', borderRadius: '50%', border: '1.5px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <UserCircle size={27} color="#9ca3af" />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.92rem', fontWeight: '700', color: '#111827', marginBottom: '0.12rem' }}>{r.candidateName}</p>
                      <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.1rem' }}>{r.candidatePosition}</p>
                      <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{r.requisitionId} · {r.committeeDepartment}</p>
                    </div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.28rem', backgroundColor: deanStyle.bg, color: deanStyle.color, padding: '0.24rem 0.7rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: '700' }}>
                    <DeanIcon size={12} />
                    {r.deanDecision}
                  </span>
                </div>

                <div style={{ paddingTop: '0.85rem', borderTop: '1px solid #f3f4f6' }}>
                  <div>
                    <p style={{ fontSize: '0.74rem', color: '#9ca3af', marginBottom: '0.2rem' }}>Chair Recommendation</p>
                    <span style={{ display: 'inline-block', backgroundColor: recStyle.bg, color: recStyle.color, padding: '0.22rem 0.66rem', borderRadius: '999px', fontSize: '0.76rem', fontWeight: '700' }}>
                      {r.chairRecommendation}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChairLayout>
  );
}

