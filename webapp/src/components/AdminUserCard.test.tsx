import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RoleInfo, UserProfile } from '../types';
import AdminUserCard from './AdminUserCard';

const roles: RoleInfo[] = [
  { id: 'admin', title: 'Администратор' },
  { id: 'operator', title: 'Оператор' },
];

const makeUser = (name: string): UserProfile => ({
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
  sections: [],
  bins: [],
  favoriteDialogIds: [],
  isAdmin: true,
  canReply: true,
});

describe('AdminUserCard', () => {
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
});
