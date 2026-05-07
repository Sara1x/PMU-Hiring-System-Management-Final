/**
 * Single source of truth for requisition workflow state.
 *
 * A requisition lives in exactly ONE stage at a time.
 * All filtering logic across every page must use these values
 * and call normalizeRequisitionStatus() when reading from Firestore.
 */

// ── Official status strings (stored as requisition.status in Firestore) ──────
export const REQUISITION_STATUSES = [
  'Pending HR',
  'Screening',
  'With Dean',
  'With Chair',
  'Pending Scheduling',
  'Interviewing',
  'Under Evaluation',
  'Decision Pending',
  'Completed',
] as const;

export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

// ── Stage keys (stored as requisition.workflowStage in Firestore) ─────────────
export const WORKFLOW_STAGE: Record<RequisitionStatus, string> = {
  'Pending HR':        'HR_PENDING',
  'Screening':         'SCREENING',
  'With Dean':         'DEAN_REVIEW',
  'With Chair':        'COMMITTEE',
  'Pending Scheduling':'SCHEDULING',
  'Interviewing':      'INTERVIEWING',
  'Under Evaluation':  'EVALUATION',
  'Decision Pending':  'DECISION_PENDING',
  'Completed':         'COMPLETED',
};

// ── Internal helpers ──────────────────────────────────────────────────────────
const VALID = new Set<string>(REQUISITION_STATUSES as unknown as string[]);

/** Legacy / stale Firestore values → canonical official status. */
const LEGACY: Record<string, RequisitionStatus> = {
  // HR-era aliases
  SentToDean:       'With Dean',
  'In Review':      'With Dean',
  // Old defaults
  Pending:          'Pending HR',
  // End-of-life aliases
  'Final Review':   'Decision Pending',
  Finalized:        'Completed',
  Closed:           'Completed',
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Converts any raw Firestore status string into one of the 8 official values.
 * Always call this when reading `status` from Firestore.
 */
export function normalizeRequisitionStatus(raw: string | undefined | null): RequisitionStatus {
  const s = (raw ?? '').trim();
  if (VALID.has(s)) return s as RequisitionStatus;
  return LEGACY[s] ?? 'Pending HR';
}

/**
 * Returns the stage key for a given (normalized) status.
 * Use this when writing `workflowStage` to Firestore.
 */
export function getWorkflowStage(status: string): string {
  const normalized = normalizeRequisitionStatus(status);
  return WORKFLOW_STAGE[normalized] ?? 'HR_PENDING';
}

/**
 * Alias of getWorkflowStage — kept for backwards compatibility with
 * any existing call sites (CreateCommittee, EvaluationsOverview, etc.).
 */
export function workflowStageFromStatus(status: string): string {
  return getWorkflowStage(status);
}

/** Returns true only for one of the 8 canonical status strings. */
export function isValidRequisitionStatus(status: string): boolean {
  return VALID.has(status);
}
