export type KnownAppRole = 'admin' | 'moderator' | 'operator' | 'hr';

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  moderator: 'Модератор',
  operator: 'Оператор',
  hr: 'Кадровик',
};

export function normalizeRole(role: unknown): string {
  return typeof role === 'string' && role.trim() ? role.trim() : 'operator';
}

export function getRoleLabel(role: unknown): string {
  const normalized = normalizeRole(role);
  return ROLE_LABELS[normalized] ?? normalized;
}

export function isAdminLikeRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'moderator';
}

export function isHrRole(role: unknown): boolean {
  return normalizeRole(role) === 'hr';
}

export function roleCanReply(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'moderator' || normalized === 'operator';
}

export function canAccessHr(role: unknown): boolean {
  return isAdminLikeRole(role) || isHrRole(role);
}

export function getDefaultRouteForRole(role: unknown): string {
  return isHrRole(role) ? '/hr' : '/dialogs';
}
