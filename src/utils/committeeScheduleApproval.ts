import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { workflowStageFromStatus } from './requisitionWorkflow';
import { normalizeInterviewSessionHrAttendee } from './interviewSessionHrAttendee';

/** HR has proposed a slot; the Department Chair must approve before status becomes Scheduled. */
export const COMMITTEE_STATUS_PENDING_CHAIR_APPROVAL = 'Pending Chair Schedule Approval';

/** Older committees may still carry this label; treated the same as pending chair approval. */
export const COMMITTEE_STATUS_LEGACY_COMMITTEE_APPROVAL = 'Pending Committee Approval';

export function isAwaitingChairScheduleApproval(status: string): boolean {
  return (
    status === COMMITTEE_STATUS_PENDING_CHAIR_APPROVAL ||
    status === COMMITTEE_STATUS_LEGACY_COMMITTEE_APPROVAL
  );
}

export function committeeFirestoreStatusesAwaitingChair(): string[] {
  return [COMMITTEE_STATUS_PENDING_CHAIR_APPROVAL, COMMITTEE_STATUS_LEGACY_COMMITTEE_APPROVAL];
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

function actorMayApproveAsChair(
  d: Record<string, unknown>,
  actor: { chairEmail: string; chairFullName: string },
): boolean {
  const docEmail = norm((d.chairEmail as string) ?? '');
  const docName = norm((d.chairName as string) ?? '');
  const sessEmail = norm(actor.chairEmail);
  const sessName = norm(actor.chairFullName);

  if (docEmail && sessEmail && docEmail === sessEmail) return true;
  if (docName && sessName && docName === sessName) return true;
  // Committees created before chair identity was stored: allow any Chair login (demo / migration).
  if (!docEmail && !docName) return true;
  return false;
}

/**
 * Chair approves HR's proposed interview time on behalf of the committee.
 * Promotes committee to Scheduled, writes interviews/{committeeId}, moves requisition to Interviewing.
 */
export async function recordChairScheduleApproval(
  db: Firestore,
  committeeId: string,
  actor: { chairEmail: string; chairFullName: string },
): Promise<void> {
  await runTransaction(db, async transaction => {
    const cref = doc(db, 'committees', committeeId);
    const cs = await transaction.get(cref);
    if (!cs.exists()) throw new Error('Committee not found');
    const d = cs.data()!;
    const status = (d.status as string) ?? '';
    if (!isAwaitingChairScheduleApproval(status)) {
      throw new Error('This committee is not awaiting chair schedule approval.');
    }

    if (!actorMayApproveAsChair(d, actor)) {
      throw new Error('Only the Department Chair who formed this committee may approve this schedule.');
    }

    const members = ((d.confirmedInterviewers ?? d.interviewers) as { id: string }[]) ?? [];
    const neededIds = members.map(m => m.id).filter(Boolean);

    const auditTag =
      norm(actor.chairEmail) ? `chair:${norm(actor.chairEmail)}` : norm(actor.chairFullName) ? `chair:${norm(actor.chairFullName)}` : 'chair';

    const reqId = (d.requisitionId as string) ?? '';
    const candidates = (d.candidates as { id: string }[]) ?? [];
    const sessionHrAttendee = normalizeInterviewSessionHrAttendee(d.sessionHrAttendee);

    transaction.update(cref, {
      status: 'Scheduled',
      scheduleApprovedByIds: [auditTag],
    });

    const iref = doc(db, 'interviews', committeeId);
    transaction.set(
      iref,
      {
        requisitionId: reqId,
        committeeId,
        candidateIds: candidates.map(c => c.id).filter(Boolean),
        interviewerIds: neededIds,
        date: d.scheduledDate,
        time: d.scheduledTime,
        duration: d.duration,
        meetingLink: d.meetingLink,
        ...(sessionHrAttendee ? { sessionHrAttendee } : {}),
        status: 'Scheduled',
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    if (reqId) {
      transaction.update(doc(db, 'requisitions', reqId), {
        status: 'Interviewing',
        workflowStage: workflowStageFromStatus('Interviewing'),
      });
    }
  });
}
