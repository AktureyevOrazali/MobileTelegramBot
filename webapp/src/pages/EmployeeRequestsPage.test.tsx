import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EmployeeRequestsPage from './EmployeeRequestsPage';
import type { AuthSession, HrRequest, HrTemplate } from '../types';

const template: HrTemplate = {
  id: 7,
  title: 'Vacation request',
  type: 'vacation',
  description: '',
  body: 'Please approve {employee_name} from {start_date}.',
  variables: ['start_date', 'end_date'],
  status: 'active',
  createdBy: 10,
  createdAt: new Date('2026-05-19T10:00:00Z'),
  updatedAt: new Date('2026-05-19T10:00:00Z'),
};

const submittedRequest: HrRequest = {
  id: 31,
  templateId: 7,
  templateTitle: 'Vacation request',
  type: 'vacation',
  employeeId: 20,
  employeeName: 'Employee User',
  department: 'Operator',
  status: 'new',
  values: { start_date: '2026-06-01', end_date: '2026-06-10' },
  renderedText: 'Please approve Employee User from 2026-06-01.',
  summary: 'Annual leave',
  period: '2026-06-01 - 2026-06-10',
  submittedAt: new Date('2026-05-19T10:10:00Z'),
  updatedAt: new Date('2026-05-19T10:10:00Z'),
  decidedAt: null,
  decidedBy: null,
  decidedByName: null,
  decisionComment: '',
};

const session: AuthSession = {
  token: 'token',
  user: {
    id: 20,
    email: 'employee@example.kz',
    login: 'employee',
    name: 'Employee User',
    createdAt: new Date('2026-05-19T00:00:00Z'),
    jobTitle: 'Operator',
    phone: '',
    bio: '',
    role: 'operator',
    isApproved: true,
    sections: [],
    bins: [],
    favoriteDialogIds: [],
    isAdmin: false,
    canReply: true,
  },
};

describe('EmployeeRequestsPage', () => {
  it('submits an HR request from a backend template', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([template]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn().mockResolvedValue(submittedRequest),
    };

    render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    expect((await screen.findAllByText('Vacation request')).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('start_date'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('end_date'), { target: { value: '2026-06-10' } });
    fireEvent.change(screen.getByLabelText('Краткое описание'), { target: { value: 'Annual leave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявление' }));

    await waitFor(() => {
      expect(apiClient.createHrRequest).toHaveBeenCalledWith({
        templateId: 7,
        values: { start_date: '2026-06-01', end_date: '2026-06-10' },
        summary: 'Annual leave',
        period: '',
      });
    });
    expect(await screen.findByText('Please approve Employee User from 2026-06-01.')).toBeInTheDocument();
  });

  it('shows a clear empty state when HR has not created active templates yet', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn(),
    };

    render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    expect(await screen.findByText('Кадровик ещё не создал активные шаблоны заявлений.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отправить заявление' })).not.toBeInTheDocument();
    expect(apiClient.createHrRequest).not.toHaveBeenCalled();
  });

  it('shows a clear empty state before the employee submits any requests', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([template]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn(),
    };

    render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    expect(await screen.findByText('Вы ещё не отправляли заявления.')).toBeInTheDocument();
  });
});
