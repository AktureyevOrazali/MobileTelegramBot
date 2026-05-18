import { describe, expect, it } from 'vitest';
import {
  getDefaultRouteForRole,
  getRoleLabel,
  isAdminLikeRole,
  isHrRole,
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
});
