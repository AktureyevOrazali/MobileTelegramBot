import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HrPage from './HrPage';
import { hrRequests, hrTemplates } from './hr/hrMockData';
import type { HrRequest, HrTemplate } from '../types';

const apiTemplates: HrTemplate[] = [
  {
    id: 7,
    title: 'Vacation request',
    type: 'vacation',
    description: '',
    body: 'Please approve {employee_name}.',
    variables: ['employee_name'],
    status: 'active',
    createdBy: 10,
    createdAt: new Date('2026-05-19T10:00:00Z'),
    updatedAt: new Date('2026-05-19T10:00:00Z'),
  },
];

const apiRequests: HrRequest[] = [
  {
    id: 31,
    templateId: 7,
    templateTitle: 'Vacation request',
    type: 'vacation',
    employeeId: 20,
    employeeName: 'Employee User',
    department: 'Operator',
    status: 'new',
    values: {},
    renderedText: 'Please approve Employee User.',
    summary: 'Annual leave',
    period: '2026-06-01 - 2026-06-10',
    submittedAt: new Date('2026-05-19T10:10:00Z'),
    updatedAt: new Date('2026-05-19T10:10:00Z'),
    decidedAt: null,
    decidedBy: null,
    decidedByName: null,
    decisionComment: '',
  },
];

describe('HrPage', () => {
  it('renders compact header stats and HR tabs', () => {
    render(<HrPage />);

    expect(screen.getByRole('heading', { name: 'Кадры' })).toBeInTheDocument();
    expect(screen.getByText('Новые заявления')).toBeInTheDocument();
    expect(screen.getByText('Отпуска на неделе')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Заявления' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Сотрудники' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Календарь' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Шаблоны' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Архив' })).toBeInTheDocument();
  });

  it('switches tabs without leaving the HR page shell', () => {
    const { container } = render(<HrPage />);

    expect(container.querySelector('.hr-panel--requests')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));

    expect(screen.getByRole('tab', { name: 'Сотрудники' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hr-page-shell')).toBeInTheDocument();
    expect(container.querySelector('.hr-panel--employees')).toBeInTheDocument();
  });

  it('shows request details and quick actions on the requests tab', () => {
    render(<HrPage />);

    expect(screen.getByText((text) => text.includes(hrRequests[0].summary))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Одобрить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Запросить данные' })).toBeInTheDocument();
  });

  it('shows minimal employee cards on the employees tab', () => {
    render(<HrPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));

    expect(screen.getAllByText('Арман Темирланов').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('09:00-18:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Документы неполные')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('hr-employee-card').length).toBeGreaterThanOrEqual(6);
  });

  it('closes the employee profile panel', () => {
    render(<HrPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));
    expect(screen.getByLabelText('Профиль сотрудника')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(screen.queryByLabelText('Профиль сотрудника')).not.toBeInTheDocument();
  });

  it('edits employee details from the side panel', async () => {
    render(<HrPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать данные' }));
    fireEvent.change(screen.getByLabelText('Должность'), { target: { value: 'HR специалист' } });
    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'hr' } });
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+7 701 000 00 00' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'hr.specialist@example.kz' } });
    fireEvent.change(screen.getByLabelText('График'), { target: { value: '10:00-19:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument());
    expect(screen.getAllByText('HR специалист').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('+7 701 000 00 00')).toBeInTheDocument();
    expect(screen.getAllByText('hr.specialist@example.kz').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('10:00-19:00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows calendar, templates, and archive content', () => {
    render(<HrPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Календарь' }));
    expect(screen.getByLabelText('Календарь кадров')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Шаблоны' }));
    expect(screen.getAllByText(hrTemplates[0].title).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));
    expect(screen.getByRole('columnheader', { name: /Дата/ })).toBeInTheDocument();
  });
  it('approves a backend HR request', async () => {
    const approved = { ...apiRequests[0], status: 'approved' as const, decisionComment: 'Approved' };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue(apiTemplates),
      fetchHrRequests: vi.fn().mockResolvedValue(apiRequests),
      fetchHrEmployees: vi.fn().mockResolvedValue([]),
      decideHrRequest: vi.fn().mockResolvedValue(approved),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn(),
    };

    render(<HrPage apiClient={apiClient as any} />);

    expect(await screen.findByText((text) => text.includes('Annual leave'))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('hr-approve-request'));

    expect(apiClient.decideHrRequest).toHaveBeenCalledWith(31, { status: 'approved', comment: '' });
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  it('updates an existing HR template from the templates tab', async () => {
    const updatedTemplate = {
      ...apiTemplates[0],
      body: 'Please prepare a certificate for {employee_name} to {recipient}.',
      variables: ['employee_name', 'recipient'],
      updatedAt: new Date('2026-05-20T10:00:00Z'),
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue(apiTemplates),
      fetchHrRequests: vi.fn().mockResolvedValue(apiRequests),
      fetchHrEmployees: vi.fn().mockResolvedValue([]),
      decideHrRequest: vi.fn(),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn().mockResolvedValue(updatedTemplate),
    };

    render(<HrPage apiClient={apiClient as any} />);

    fireEvent.click(screen.getAllByRole('tab')[3]);

    expect(await screen.findByDisplayValue('Vacation request')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('employee_name'), {
      target: { value: 'employee_name,recipient' },
    });
    fireEvent.change(screen.getByDisplayValue('Please approve {employee_name}.'), {
      target: { value: 'Please prepare a certificate for {employee_name} to {recipient}.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    await waitFor(() => expect(apiClient.updateHrTemplate).toHaveBeenCalledTimes(1));
    expect(apiClient.updateHrTemplate).toHaveBeenCalledWith(7, {
      title: 'Vacation request',
      type: 'vacation',
      description: '',
      body: 'Please prepare a certificate for {employee_name} to {recipient}.',
      variables: ['employee_name', 'recipient'],
      status: 'active',
    });
    expect(apiClient.createHrTemplate).not.toHaveBeenCalled();
    expect(await screen.findAllByText('Please prepare a certificate for {employee_name} to {recipient}.')).toHaveLength(2);
  });
});
