import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../types';
import { ApiProvider, useApi } from './ApiContext';

const apiMocks = vi.hoisted(() => ({
  clearSession: vi.fn(),
  fetchProfile: vi.fn(),
  setSession: vi.fn(),
}));

vi.mock('../api/ApiClient', () => ({
  ApiClient: vi.fn(() => apiMocks),
}));

const SESSION_KEY = 'mobilebot-companion-session';

function makeUser(name: string): UserProfile {
  return {
    id: 2,
    email: 'admin@example.com',
    login: 'admin',
    name,
    createdAt: new Date('2026-04-13T00:00:00Z'),
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
  };
}

function adminName(): string {
  return ''.concat(
    ...[1040, 1076, 1084, 1080, 1085, 1080, 1089, 1090, 1088, 1072, 1090, 1086, 1088].map((code) =>
      String.fromCharCode(code),
    ),
  );
}

function SessionName() {
  const { session } = useApi();
  return <div data-testid="session-name">{session?.user.name}</div>;
}

describe('ApiProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('refreshes restored session profile from the backend', async () => {
    apiMocks.fetchProfile.mockResolvedValue(makeUser(adminName()));
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: 'saved-token',
        user: {
          ...makeUser('stale broken name'),
          createdAt: '2026-04-13T00:00:00Z',
        },
      }),
    );

    render(
      <ApiProvider>
        <SessionName />
      </ApiProvider>,
    );

    expect(screen.getByTestId('session-name')).toHaveTextContent('stale broken name');

    await waitFor(() => {
      expect(screen.getByTestId('session-name')).toHaveTextContent(adminName());
    });
    expect(apiMocks.fetchProfile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}').user.name).toBe(adminName());
  });

  it('restores the session from tab-scoped storage when shared storage has another user', async () => {
    apiMocks.fetchProfile.mockResolvedValue(makeUser('Operator refreshed'));
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: 'operator-token',
        user: {
          ...makeUser('Operator in this tab'),
          role: 'operator',
          isAdmin: false,
          createdAt: '2026-04-13T00:00:00Z',
        },
      }),
    );
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: 'admin-token',
        user: {
          ...makeUser('Admin in another tab'),
          createdAt: '2026-04-13T00:00:00Z',
        },
      }),
    );

    render(
      <ApiProvider>
        <SessionName />
      </ApiProvider>,
    );

    expect(screen.getByTestId('session-name')).toHaveTextContent('Operator in this tab');

    await waitFor(() => {
      expect(screen.getByTestId('session-name')).toHaveTextContent('Operator refreshed');
    });
    expect(apiMocks.fetchProfile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}').user.name).toBe('Operator refreshed');
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}').user.name).toBe('Admin in another tab');
  });
});
