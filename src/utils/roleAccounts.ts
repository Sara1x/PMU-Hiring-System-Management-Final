export type PmuRole = 'dean' | 'hr' | 'chair' | 'interviewer';

/** Canonical login email per role (Firebase Auth identity). */
export const ROLE_ACCOUNT_EMAIL: Record<PmuRole, string> = {
  dean: '201902002@pmu.edu.sa',
  hr: 'saralsh257@gmail.com',
  chair: 'sara25mi@hotmail.com',
  interviewer: 'sarah257mi@icloud.com',
};

export const ROLE_DEFAULT_FULL_NAME: Record<PmuRole, string> = {
  dean: 'Dr. Abdullah Al-Zahrani',
  hr: 'Sarah Williams',
  chair: 'Dr. Ahmed Al-Rashid',
  interviewer: 'Dr. Fahad Al-Otaibi',
};

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Resolve role from the email the user typed at login (Firebase Auth user). */
export function roleFromLoginEmail(email: string): PmuRole | null {
  const n = normalizeLoginEmail(email);
  for (const [role, em] of Object.entries(ROLE_ACCOUNT_EMAIL) as [PmuRole, string][]) {
    if (normalizeLoginEmail(em) === n) return role;
  }
  return null;
}

/** `/login/:role` param → role (handles Dean, HR Manager, Department Chair, Interviewer). */
export function roleFromPortalParam(portalRouteParam: string | undefined): PmuRole | null {
  const k = String(portalRouteParam ?? '')
    .trim()
    .toLowerCase();
  if (k === 'dean') return 'dean';
  if (k === 'hr' || k === 'hr manager') return 'hr';
  if (k === 'chair' || k === 'department chair') return 'chair';
  if (k === 'interviewer') return 'interviewer';
  return null;
}

/** Role slug used in URLs (`/verify/dean`). */
export function verifySlugForRole(r: PmuRole): string {
  return r;
}

/** Segment for `/login/:role` navigation (matches RoleSelection + DEMO keys). */
export function loginPathSegmentForRole(r: PmuRole): string {
  switch (r) {
    case 'dean':
      return 'Dean';
    case 'hr':
      return 'HR Manager';
    case 'chair':
      return 'Department Chair';
    case 'interviewer':
      return 'Interviewer';
  }
}

/** `/verify/:role` path segment → typed role */
export function roleFromVerifySlug(slug: string | undefined): PmuRole | null {
  const s = String(slug ?? '')
    .trim()
    .toLowerCase();
  if (s === 'dean') return 'dean';
  if (s === 'hr') return 'hr';
  if (s === 'chair') return 'chair';
  if (s === 'interviewer') return 'interviewer';
  return null;
}
