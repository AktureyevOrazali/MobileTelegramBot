import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { UserProfile } from './types';

const apiClient = {};
const setSession = vi.fn();
const logout = vi.fn();
let currentRole = 'hr';

function makeUser(role: string): UserProfile {
  return {
    id: 1,
    email: `${role}@example.test`,
    login: role,
    name: role === 'hr' ? 'HR User' : 'Оператор',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    jobTitle: '',
    organization: 'ТОО Азия-Сервис',
    phone: '',
    bio: '',
    role,
    isApproved: true,
    sections: [],
    bins: [],
    favoriteDialogIds: [],
    isAdmin: false,
    canReply: role === 'operator',
  };
}

vi.mock('./context/ApiContext', () => ({
  useApi: () => ({
    session: {
      token: 'token',
      user: makeUser(currentRole),
    },
    apiClient,
    setSession,
    logout,
  }),
}));

vi.mock('./pages/AuthPage', () => ({ default: () => <div data-testid="auth-page">Login</div> }));
vi.mock('./pages/DialogsPage', () => ({ default: () => <div data-testid="dialogs-page">Диалоги</div> }));
vi.mock('./pages/DashboardPage', () => ({ default: () => <div data-testid="dashboard-page">Dashboard</div> }));
vi.mock('./pages/AdminPage', () => ({ default: () => <div data-testid="admin-page">Admin</div> }));
vi.mock('./pages/SurveysPage', () => ({ default: () => <div data-testid="surveys-page">Surveys</div> }));
vi.mock('./pages/ProfilePage', () => ({ default: () => <div data-testid="profile-page">Profile</div> }));
vi.mock('./pages/EmployeeRequestsPage', () => ({ default: () => <div data-testid="employee-requests-page">Employee requests</div> }));

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <App />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
}

describe('App HR routing', () => {
  beforeEach(() => {
    currentRole = 'hr';
    setSession.mockClear();
    logout.mockClear();
    window.localStorage.clear();
  });

  it('shows only HR navigation for HR users', async () => {
    renderAppAt('/hr');

    expect(await screen.findByRole('heading', { name: 'Кадры' })).toBeInTheDocument();
    expect(screen.getByText('Кадровик')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Кадры/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /Дашборд/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Сотрудники/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Опросы/ })).not.toBeInTheDocument();
  });

  it('redirects HR users away from dialogs', async () => {
    renderAppAt('/dialogs');

    expect(await screen.findByRole('heading', { name: 'Кадры' })).toBeInTheDocument();
    expect(screen.queryByTestId('dialogs-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/hr');
  });

  it('redirects HR users away from employee request submission', async () => {
    renderAppAt('/employee-requests');

    expect(await screen.findByRole('heading', { name: 'Кадры' })).toBeInTheDocument();
    expect(screen.queryByTestId('employee-requests-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/hr');
  });

  it('keeps HR users on the HR page for nested HR routes', async () => {
    renderAppAt('/hr/requests');

    expect(await screen.findByRole('heading', { name: 'Кадры' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Кадры/ })).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/hr/requests');
  });

  it('redirects operators away from HR route', async () => {
    currentRole = 'operator';

    renderAppAt('/hr');

    expect(await screen.findByTestId('dialogs-page')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Кадры' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Кадры/ })).not.toBeInTheDocument();
  });
});
