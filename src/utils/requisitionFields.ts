export const STANDARD_DEPARTMENTS = [
  'Computer Engineering',
  'Computer Science',
  'Information Technology',
  'Software Engineering',
  'Artificial Intelligence',
  'Cybersecurity',
] as const;

export function getRequisitionPositionTitle(data: Record<string, unknown>): string {
  return (
    (data.positionTitle as string | undefined) ??
    (data.title as string | undefined) ??
    (data.position as string | undefined) ??
    '-'
  );
}

export function getRequisitionNumberOfPositions(data: Record<string, unknown>): number {
  const raw =
    (data.numberOfPositions as number | string | undefined) ??
    (data.vacancies as number | string | undefined) ??
    (data.positions as number | string | undefined) ??
    1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
