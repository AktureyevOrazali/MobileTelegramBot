import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleInfo, UserBinAssignment, UserProfile } from '../types';
import AdminUserCard from './AdminUserCard';

const roles: RoleInfo[] = [
  { id: 'admin', title: 'Администратор' },
  { id: 'operator', title: 'Оператор' },
];

const makeUser = (
  name: string,
  overrides: Partial<Pick<UserProfile, 'sections' | 'bins'>> = {},
): UserProfile => ({
  id: 1,
  email: 'admin@example.com',
  login: 'admin@example.com',
  name,
  createdAt: new Date('2026-05-06T00:00:00Z'),
  jobTitle: '',
  organization: 'ТОО Азия-Сервис',
  phone: '',
  bio: '',
  role: 'admin',
  isApproved: true,
  sections: overrides.sections ?? [],
  bins: overrides.bins ?? [],
  favoriteDialogIds: [],
  isAdmin: true,
  canReply: true,
});

describe('AdminUserCard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('repairs mojibake in the displayed administrator name', () => {
    render(
      <AdminUserCard
        user={makeUser('PђPґPјPёPЅPёCЃC‚CЂP°C‚PѕCЂ')}
        currentUserRole="admin"
        roles={roles}
        sections={[]}
        availableBins={[]}
        binDetails={[]}
        onRoleSave={vi.fn().mockResolvedValue(undefined)}
        onSectionsSave={vi.fn().mockResolvedValue(undefined)}
        onBinsSave={vi.fn().mockResolvedValue(undefined)}
        onPasswordReset={vi.fn().mockResolvedValue(undefined)}
        canDeleteUser={false}
        onDeleteRequest={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Администратор' })).toBeInTheDocument();
    expect(screen.queryByText('PђPґPјPёPЅPёCЃC‚CЂP°C‚PѕCЂ')).not.toBeInTheDocument();
  });

  it('does not auto-save server-provided sections or BINs after user props refresh', () => {
    vi.useFakeTimers();
    const onSectionsSave = vi.fn().mockResolvedValue(undefined);
    const onBinsSave = vi.fn().mockResolvedValue(undefined);
    const bins: UserBinAssignment[] = [{
      bin: '181818181818',
      assignedAt: new Date('2026-05-06T00:00:00Z'),
      expiresAt: null,
    }];
    const props = {
      currentUserRole: 'admin',
      roles,
      sections: [{ id: 'support', title: 'Support' }],
      availableBins: ['181818181818'],
      binDetails: [],
      onRoleSave: vi.fn().mockResolvedValue(undefined),
      onSectionsSave,
      onBinsSave,
      onPasswordReset: vi.fn().mockResolvedValue(undefined),
      canDeleteUser: false,
      onDeleteRequest: vi.fn(),
    };

    const { rerender } = render(
      <AdminUserCard
        {...props}
        user={makeUser('Admin User')}
      />,
    );

    rerender(
      <AdminUserCard
        {...props}
        user={makeUser('Admin User', { sections: ['support'], bins })}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onSectionsSave).not.toHaveBeenCalled();
    expect(onBinsSave).not.toHaveBeenCalled();
  });
});
