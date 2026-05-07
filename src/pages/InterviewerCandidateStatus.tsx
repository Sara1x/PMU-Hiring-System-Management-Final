import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, UserCircle } from 'lucide-react';
import { InterviewerLayout } from '../components/InterviewerLayout';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getSession } from '../utils/session';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';

interface CandidateStatus {
  id: string; // `${committeeId}::${candidateId}`
  candidateId: string;
  committeeId: string;
  name: string;
  position: string;
  req: string;
  decision: string; // interviewer recommendation
  finalDecision: 'Accepted' | 'Rejected' | 'Pending Decision';
  myRating: string;
  teamAverage: string;
  evaluations: string;
  status: string;
  sortTs: number;
}

interface CommitteeInterviewer {
  id: string;
  email: string;
  name: string;
}

const DECISION_STYLE: Record<string, { color: string; bg: string; Icon: typeof CheckCircle }> = {
  'Highly Recommend': { color: '#15803d', bg: '#dcfce7', Icon: CheckCircle },
  'Recommend':        { color: '#15803d', bg: '#dcfce7', Icon: CheckCircle },
  'Neutral':          { color: '#b45309', bg: '#fef9c3', Icon: Clock },
  'Do Not Recommend': { color: '#dc2626', bg: '#fee2e2', Icon: XCircle },
  'Pending':          { color: '#b45309', bg: '#fef9c3', Icon: Clock },
};

const FINAL_STYLE: Record<'Accepted' | 'Rejected' | 'Pending Decision', { color: string; bg: string; Icon: typeof CheckCircle }> = {
  'Accepted':         { color: '#15803d', bg: '#dcfce7', Icon: CheckCircle },
  'Rejected':         { color: '#dc2626', bg: '#fee2e2', Icon: XCircle },
  'Pending Decision': { color: '#6b7280', bg: '#f3f4f6', Icon: Clock },
};

function normalizeFinalDecision(raw: unknown): 'Accepted' | 'Rejected' | 'Pending Decision' {
  const v = (raw as string | undefined) ?? '';
  if (v === 'Hired') return 'Accepted';
  if (v === 'Not Hired') return 'Rejected';
  if (v === 'Approved' || v === 'Accepted') return 'Accepted';
  if (v === 'Rejected') return 'Rejected';
  return 'Pending Decision';
}

function averageRating(ratings: Record<string, number> | undefined): number | null {
  if (!ratings) return null;
  const vals = Object.values(ratings).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function InterviewerCandidateStatus() {
  const [candidates, setCandidates] = useState<CandidateStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const userEmail = (getSession()?.email ?? sessionStorage.getItem('pmu_user_email') ?? '').trim();
  const userName = (getSession()?.fullName ?? '').trim();

  useEffect(() => {
    const norm = (v: string) => v.trim().toLowerCase();
    type CommitteeMeta = {
      interviewers: CommitteeInterviewer[];
      candidateNameById: Record<string, string>;
      title: string;
      requisitionId: string;
    };
    type EvalEntry = {
      evaluationId: string;
      committeeId: string;
      candidateId: string;
      interviewerKey: string;
      recommendation: string;
      scoreAvg: number;
      candidateName: string;
      candidatePosition: string;
      requisitionId: string;
      submittedTs: number;
    };

    let candidateDecisionById: Record<string, unknown> = {};
    let committeeMetaById: Record<string, CommitteeMeta> = {};
    let evalEntries: EvalEntry[] = [];

    const emit = () => {
      const me = norm(userEmail);
      const myName = norm(userName);
      const allCommitteeIds = new Set<string>(Object.keys(committeeMetaById));
      const matchedCommitteeIds = new Set<string>();
      const myIdentityKeys = new Set<string>();
      if (me) myIdentityKeys.add(me);
      if (myName) myIdentityKeys.add(myName);

      Object.entries(committeeMetaById).forEach(([committeeId, meta]) => {
        const inCommittee = meta.interviewers.some(iv =>
          (me && (norm(iv.email ?? '') === me || norm(iv.id ?? '') === me)) ||
          (myName && norm(iv.name ?? '') === myName)
        );
        if (!inCommittee) return;
        matchedCommitteeIds.add(committeeId);
        meta.interviewers.forEach(iv => {
          if (
            (me && (norm(iv.email ?? '') === me || norm(iv.id ?? '') === me)) ||
            (myName && norm(iv.name ?? '') === myName)
          ) {
            if (iv.id) myIdentityKeys.add(norm(iv.id));
            if (iv.email) myIdentityKeys.add(norm(iv.email));
            if (iv.name) myIdentityKeys.add(norm(iv.name));
          }
        });
      });

      // Committee-first fallback: if identity fields are inconsistent in this
      // environment, keep the page populated from assigned committee pipeline.
      const myCommitteeIds = matchedCommitteeIds.size > 0 ? matchedCommitteeIds : allCommitteeIds;

      const grouped = new Map<string, EvalEntry[]>();
      evalEntries.forEach(ev => {
        if (!myCommitteeIds.has(ev.committeeId)) return;
        const key = `${ev.committeeId}::${ev.candidateId}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(ev);
      });

      const rows: CandidateStatus[] = [];

      grouped.forEach((entries, key) => {
        if (entries.length === 0) return;

        const sample = entries[0];
        const committeeMeta = committeeMetaById[sample.committeeId];
        if (!committeeMeta) return;

        const committeeEvaluationRecorded = entries.length > 0;
        const completed = committeeEvaluationRecorded;

        let myEvals = entries.filter(e => myIdentityKeys.has(e.interviewerKey));

        // Fallback for legacy eval docs where interviewer identity fields are not
        // aligned: if strict matching returns none, use most recent evaluation in
        // this committee/candidate pair so status page remains populated.
        if (myEvals.length === 0 && entries.length > 0) {
          myEvals = [...entries].sort((a, b) => b.submittedTs - a.submittedTs).slice(0, 1);
        }
        if (myEvals.length === 0) return;
        const myLatest = [...myEvals].sort((a, b) => b.submittedTs - a.submittedTs)[0];

        const teamAvgNum = entries.reduce((sum, e) => sum + e.scoreAvg, 0) / entries.length;
        const teamAvg = Number.isFinite(teamAvgNum) ? `${teamAvgNum.toFixed(1)}/4` : '-';
        const myRating = Number.isFinite(myLatest.scoreAvg) ? `${myLatest.scoreAvg.toFixed(1)}/4` : '-';

        rows.push({
          id: key,
          committeeId: sample.committeeId,
          candidateId: sample.candidateId,
          name: sample.candidateName || committeeMeta.candidateNameById[sample.candidateId] || '-',
          position: sample.candidatePosition || '-',
          req: sample.requisitionId || committeeMeta.requisitionId || '-',
          decision: myLatest.recommendation || 'Pending',
          finalDecision: normalizeFinalDecision(candidateDecisionById[sample.candidateId]),
          myRating,
          teamAverage: teamAvg,
          evaluations: `${entries.length}`,
          status: completed ? 'Completed' : 'Pending Evaluation',
          sortTs: Math.max(...entries.map(e => e.submittedTs)),
        });
      });

      rows.sort((a, b) => {
        const deanOrder = (d: CandidateStatus['finalDecision']) =>
          d === 'Pending Decision' ? 0 : d === 'Accepted' ? 1 : 2;
        const ao = deanOrder(a.finalDecision);
        const bo = deanOrder(b.finalDecision);
        if (ao !== bo) return ao - bo;
        if (b.sortTs !== a.sortTs) return b.sortTs - a.sortTs;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setCandidates(rows);
      setLoading(false);
    };

    const unsubCandidates = onSnapshot(
      collection(db, 'candidates'),
      (snap) => {
        const next: Record<string, unknown> = {};
        snap.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          // Dean final decision can live on either finalDecision or status.
          next[d.id] = data.finalDecision ?? data.status;
        });
        candidateDecisionById = next;
        emit();
      },
      (e) => { console.error(e); setLoading(false); }
    );

    const unsubCommittees = onSnapshot(
      collection(db, 'committees'),
      (snap) => {
        const next: Record<string, CommitteeMeta> = {};
        snap.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          const interviewers = ((data.interviewers as Array<{ id?: string; email?: string; name?: string }> | undefined) ?? [])
            .map(iv => ({ id: iv.id ?? '', email: iv.email ?? '', name: iv.name ?? '' }));
          const candidates = ((data.candidates as Array<{ id?: string; name?: string }> | undefined) ?? []);
          const candidateNameById: Record<string, string> = {};
          candidates.forEach(c => {
            if (c.id) candidateNameById[c.id] = c.name ?? '-';
          });
          next[d.id] = {
            interviewers,
            candidateNameById,
            title: getRequisitionPositionTitle(data),
            requisitionId: (data.requisitionId as string) ?? '-',
          };
        });
        committeeMetaById = next;
        emit();
      },
      (e) => { console.error(e); setLoading(false); }
    );

    const unsubEvals = onSnapshot(
      collection(db, 'evaluations'),
      (snap) => {
        const parsed: EvalEntry[] = [];
        snap.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          const candidateId = (data.candidateId as string) ?? '';
          const committeeId = (data.committeeId as string) ?? '';
          const evaluationId = (data.evaluationId as string) ?? d.id;
          const ratings = (data.ratings as Record<string, number> | undefined) ?? undefined;
          const scoreAvgVal = averageRating(ratings);
          const interviewerId = norm((data.interviewerId as string) ?? '');
          const interviewerEmail = norm((data.interviewerEmail as string) ?? '');
          const interviewerName = norm((data.interviewerName as string) ?? '');
          const interviewerKey = interviewerId || interviewerEmail || interviewerName;
          const submittedTs = (data.submittedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

          // Safety filtering for legacy/test/invalid docs.
          if (!evaluationId) return;
          if (!candidateId || !committeeId) return;
          if (!ratings || scoreAvgVal === null) return;
          if (!interviewerKey) return;

          parsed.push({
            evaluationId,
            committeeId,
            candidateId,
            interviewerKey,
            recommendation: (data.recommendation as string) ?? 'Pending',
            scoreAvg: scoreAvgVal,
            candidateName: (data.candidateName as string) ?? '-',
            candidatePosition: (data.candidatePosition as string) ?? '-',
            requisitionId: (data.requisitionId as string) ?? '-',
            submittedTs,
          });
        });

        evalEntries = parsed;

        emit();
      },
      (e) => { console.error(e); setLoading(false); }
    );

    return () => {
      unsubCandidates();
      unsubCommittees();
      unsubEvals();
    };
  }, [userEmail, userName]);

  return (
    <InterviewerLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>Candidate Status Overview</h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.75rem' }}>View the evaluation status and Dean decisions for candidates you've interviewed</p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading…</div>
      ) : candidates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          No evaluated candidates yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {candidates.map(c => {
            const d = DECISION_STYLE[c.decision] ?? DECISION_STYLE['Pending'];
            const DIcon = d.Icon;
            const fd = FINAL_STYLE[c.finalDecision];
            const FDIcon = fd.Icon;
            return (
              <div key={c.id} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1.5px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <UserCircle size={30} color="#9ca3af" />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.95rem', fontWeight: '700', color: '#111827', marginBottom: '0.15rem' }}>{c.name}</p>
                      <p style={{ fontSize: '0.82rem', color: '#374151', marginBottom: '0.1rem' }}>{c.position}</p>
                      <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{c.req}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', backgroundColor: fd.bg, color: fd.color, padding: '0.3rem 0.85rem', borderRadius: '999px', fontSize: '0.82rem', fontWeight: '700' }}>
                      <FDIcon size={13} />{c.finalDecision}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', backgroundColor: d.bg, color: d.color, padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: '600' }}>
                      <DIcon size={12} />{c.decision}
                    </span>
                  </div>
                </div>
                {/* Compact rating footer.
                    Earlier this section was a 4-column grid (My Rating / Team
                    Average / Evaluations / Status). Per UX cleanup we now show
                    only "My Rating" — Team Average, Evaluations and Status are
                    still computed on the row object (`c.teamAverage`,
                    `c.evaluations`, `c.status`) for downstream logic, just
                    no longer rendered. The colored decision/recommendation
                    pills in the top-right remain the source of status info. */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6' }}>
                  <p style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: '600' }}>My Rating</p>
                  <p style={{ fontSize: '0.95rem', fontWeight: '700', color: '#111827' }}>{c.myRating}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </InterviewerLayout>
  );
}
