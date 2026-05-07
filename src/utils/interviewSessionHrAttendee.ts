/** HR participant on a confirmed interview session only (not a committee interviewer). */
export interface InterviewSessionHrAttendee {
  email: string;
  fullName: string;
}

export function normalizeInterviewSessionHrAttendee(raw: unknown): InterviewSessionHrAttendee | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const email = String(o.email ?? '').trim();
  const fullName = String(o.fullName ?? '').trim();
  if (!email && !fullName) return undefined;
  return { email, fullName };
}
