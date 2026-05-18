import { describe, expect, it } from 'vitest';
import {
  canAccessHr,
  getDefaultRouteForRole,
  getRoleLabel,
  isAdminLikeRole,
  isHrRole,
  normalizeRole,
  roleCanReply,
} from './roles';

describe('role helpers', () => {
  it('labels the HR role in Russian', () => {
    expect(getRoleLabel('hr')).toBe('Кадровик');
  });

  it('keeps HR outside admin-like and reply-capable roles', () => {
    expect(isHrRole('hr')).toBe(true);
    expect(isAdminLikeRole('hr')).toBe(false);
    expect(roleCanReply('hr')).toBe(false);
  });

  it('routes HR users to the HR workspace by default', () => {
    expect(getDefaultRouteForRole('hr')).toBe('/hr');
    expect(getDefaultRouteForRole('admin')).toBe('/dialogs');
    expect(getDefaultRouteForRole('operator')).toBe('/dialogs');
  });

  it('normalizes missing and blank roles to operator', () => {
    expect(normalizeRole(undefined)).toBe('operator');
    expect(normalizeRole(null)).toBe('operator');
    expect(normalizeRole('   ')).toBe('operator');
    expect(normalizeRole(' hr ')).toBe('hr');
  });

  it('falls back to the normalized role for unknown labels', () => {
    expect(getRoleLabel('auditor')).toBe('auditor');
    expect(getRoleLabel(' auditor ')).toBe('auditor');
  });

  it('allows HR workspace access for admin-like and HR roles only', () => {
    expect(canAccessHr('admin')).toBe(true);
    expect(canAccessHr('moderator')).toBe(true);
    expect(canAccessHr('hr')).toBe(true);
    expect(canAccessHr('operator')).toBe(false);
    expect(canAccessHr('auditor')).toBe(false);
  });
});
