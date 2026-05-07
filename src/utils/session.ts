export interface PmuUser {
  role: 'dean' | 'hr' | 'chair' | 'interviewer';
  email: string;
  fullName: string;
}

const KEY = 'pmu_user';

export function getSession(): PmuUser | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PmuUser) : null;
  } catch {
    return null;
  }
}

export function setSession(user: PmuUser): void {
  sessionStorage.setItem(KEY, JSON.stringify(user));
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY);
}

export function patchSession(patch: Partial<PmuUser>): void {
  const current = getSession();
  if (current) setSession({ ...current, ...patch });
}
