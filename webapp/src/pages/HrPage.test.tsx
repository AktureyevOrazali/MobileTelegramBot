import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    events: [
      {
        id: 101,
        requestId: 31,
        action: 'created',
        actorId: 20,
        actorName: 'Employee User',
        comment: 'Annual leave',
        createdAt: new Date('2026-05-19T10:10:00Z'),
      },
    ],
  },
];

describe('HrPage', () => {
  it('keeps the HR request panels while backend data is loading', () => {
    const apiClient = {
      fetchHrTemplates: vi.fn(() => new Promise<HrTemplate[]>(() => {})),
      fetchHrRequests: vi.fn(() => new Promise<HrRequest[]>(() => {})),
      fetchHrEmployees: vi.fn(() => new Promise<any[]>(() => {})),
      decideHrRequest: vi.fn(),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn(),
    };

    const { container } = render(<HrPage apiClient={apiClient as any} />);

    expect(container.querySelector('.hr-requests-grid')).toBeInTheDocument();
    expect(container.querySelector('.hr-request-list')).toBeInTheDocument();
    expect(container.querySelector('.hr-detail-card')).toBeInTheDocument();
    expect(screen.getAllByTestId('hr-request-row-skeleton')).toHaveLength(7);
    expect(screen.getByTestId('hr-document-preview-skeleton')).toBeInTheDocument();
    expect(container.querySelector('.data-loading-state--dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText(hrRequests[0].employeeName)).not.toBeInTheDocument();
  });

  it.each([
    ['Сотрудники', '.hr-employees-layout', 'hr-employee-card-skeleton'],
    ['Календарь', '.hr-calendar-shell', 'hr-calendar-day-skeleton'],
    ['Шаблоны', '.hr-template-layout', 'hr-template-item-skeleton'],
    ['Архив', '.hr-archive-table-wrap', 'hr-archive-row-skeleton'],
  ])('keeps the %s tab layout while backend data is loading', (tabName, layoutSelector, skeletonTestId) => {
    const apiClient = {
      fetchHrTemplates: vi.fn(() => new Promise<HrTemplate[]>(() => {})),
      fetchHrRequests: vi.fn(() => new Promise<HrRequest[]>(() => {})),
      fetchHrEmployees: vi.fn(() => new Promise<any[]>(() => {})),
      decideHrRequest: vi.fn(),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn(),
    };

    const { container } = render(<HrPage apiClient={apiClient as any} />);

    fireEvent.click(screen.getByRole('tab', { name: tabName }));

    expect(container.querySelector(layoutSelector)).toBeInTheDocument();
    expect(screen.getAllByTestId(skeletonTestId).length).toBeGreaterThan(0);
    expect(container.querySelector('.data-loading-state--dashboard')).not.toBeInTheDocument();
  });

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
    expect(container.querySelector('.hr-panel--requests')).toHaveAttribute('data-hr-tab', 'requests');
    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));

    expect(screen.getByRole('tab', { name: 'Сотрудники' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hr-page-shell')).toBeInTheDocument();
    const employeesPanel = container.querySelector('.hr-panel--employees');
    expect(employeesPanel).toBeInTheDocument();
    expect(employeesPanel).toHaveAttribute('data-hr-tab', 'employees');
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
  it('lets HR assign the employee organization from the side panel', async () => {
    const { container } = render(<HrPage />);

    fireEvent.click(screen.getAllByRole('tab')[1]);
    fireEvent.click(container.querySelector('.hr-side-panel__footer .button') as HTMLButtonElement);
    fireEvent.change(screen.getByLabelText('Организация'), { target: { value: 'ТОО Азия-Сервис' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument());
    expect(screen.getByText('ТОО Азия-Сервис')).toBeInTheDocument();
  });

  it('approves a backend HR request', async () => {
    const approved = {
      ...apiRequests[0],
      status: 'approved' as const,
      decisionComment: 'Approved',
      decidedByName: 'HR User',
      events: [
        ...apiRequests[0].events,
        {
          id: 102,
          requestId: 31,
          action: 'approved',
          actorId: 10,
          actorName: 'HR User',
          comment: 'Approved',
          createdAt: new Date('2026-05-19T10:20:00Z'),
        },
      ],
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue(apiTemplates),
      fetchHrRequests: vi.fn().mockResolvedValue(apiRequests),
      fetchHrEmployees: vi.fn().mockResolvedValue([]),
      decideHrRequest: vi.fn().mockResolvedValue(approved),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn(),
    };

    render(<HrPage apiClient={apiClient as any} />);

    expect((await screen.findAllByText((text) => text.includes('Annual leave'))).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTestId('hr-approve-request'));

    expect(apiClient.decideHrRequest).toHaveBeenCalledWith(31, { status: 'approved', comment: '' });
    await waitFor(() => expect(screen.queryByText('Employee User')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));
    expect(screen.getByRole('cell', { name: 'Employee User' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'HR User' })).toBeInTheDocument();
  });

  it('lets HR change an archived request decision', async () => {
    const approvedRequest: HrRequest = {
      ...apiRequests[0],
      status: 'approved',
      decidedAt: new Date('2026-05-19T10:20:00Z'),
      decidedBy: 10,
      decidedByName: 'HR User',
      decisionComment: 'Approved',
      updatedAt: new Date('2026-05-19T10:20:00Z'),
    };
    const rejectedRequest: HrRequest = {
      ...approvedRequest,
      status: 'rejected',
      decisionComment: 'Changed decision',
      updatedAt: new Date('2026-05-19T10:30:00Z'),
      events: [
        ...approvedRequest.events,
        {
          id: 103,
          requestId: 31,
          action: 'rejected',
          actorId: 10,
          actorName: 'HR User',
          comment: 'Changed decision',
          createdAt: new Date('2026-05-19T10:30:00Z'),
        },
      ],
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue(apiTemplates),
      fetchHrRequests: vi.fn().mockResolvedValue([approvedRequest]),
      fetchHrEmployees: vi.fn().mockResolvedValue([]),
      decideHrRequest: vi.fn().mockResolvedValue(rejectedRequest),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn(),
    };

    render(<HrPage apiClient={apiClient as any} />);

    await waitFor(() => expect(apiClient.fetchHrRequests).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Employee User')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));
    fireEvent.click(screen.getByTestId('hr-archive-reject-31'));

    await waitFor(() => {
      expect(apiClient.decideHrRequest).toHaveBeenCalledWith(31, { status: 'rejected', comment: '' });
    });
    expect(screen.getByRole('cell', { name: 'Employee User' })).toBeInTheDocument();
  });

  it('sends an HR comment when requesting additional data', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue(apiTemplates),
      fetchHrRequests: vi.fn().mockResolvedValue(apiRequests),
      fetchHrEmployees: vi.fn().mockResolvedValue([]),
      decideHrRequest: vi.fn().mockResolvedValue({
        ...apiRequests[0],
        status: 'needsInfo',
        decisionComment: 'Attach certificate',
      }),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn(),
    };

    render(<HrPage apiClient={apiClient as any} />);

    expect((await screen.findAllByText((text) => text.includes('Annual leave'))).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('HR comment'), { target: { value: 'Attach certificate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Запросить данные' }));

    await waitFor(() => {
      expect(apiClient.decideHrRequest).toHaveBeenCalledWith(31, { status: 'needsInfo', comment: 'Attach certificate' });
    });
  });

  it('shows the HR request event history in the detail panel', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue(apiTemplates),
      fetchHrRequests: vi.fn().mockResolvedValue(apiRequests),
      fetchHrEmployees: vi.fn().mockResolvedValue([]),
      decideHrRequest: vi.fn(),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn(),
    };

    render(<HrPage apiClient={apiClient as any} />);

    const history = await screen.findByLabelText('HR request history');
    expect(within(history).getByText('Employee User')).toBeInTheDocument();
    expect(within(history).getByText('Annual leave')).toBeInTheDocument();
  });

  it('renders archive rows from loaded HR requests instead of demo archive items', async () => {
    const approvedRequest: HrRequest = {
      ...apiRequests[0],
      status: 'approved',
      decidedAt: new Date('2026-05-19T10:20:00Z'),
      decidedBy: 10,
      decidedByName: 'HR User',
      decisionComment: 'Approved',
      updatedAt: new Date('2026-05-19T10:20:00Z'),
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue(apiTemplates),
      fetchHrRequests: vi.fn().mockResolvedValue([approvedRequest]),
      fetchHrEmployees: vi.fn().mockResolvedValue([]),
      decideHrRequest: vi.fn(),
      createHrTemplate: vi.fn(),
      updateHrTemplate: vi.fn(),
    };

    render(<HrPage apiClient={apiClient as any} />);

    await waitFor(() => expect(apiClient.fetchHrRequests).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Employee User')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));

    expect(screen.getByRole('cell', { name: 'Employee User' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'HR User' })).toBeInTheDocument();
    expect(screen.queryByText('Р‘РѕС‚Р° РђР№С‚Р¶Р°РЅРѕРІР°')).not.toBeInTheDocument();
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

    expect(await screen.findByLabelText('Предпросмотр шаблона')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Vacation request')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));

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
    expect(await screen.findByLabelText('Предпросмотр шаблона')).toBeInTheDocument();
    expect(screen.getByText('Please prepare a certificate for {employee_name} to {recipient}.')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Please prepare a certificate for {employee_name} to {recipient}.')).not.toBeInTheDocument();
  });

  it('creates HR templates from the plus button in the template list', async () => {
    const newTemplate: HrTemplate = {
      ...apiTemplates[0],
      id: 8,
      title: 'New certificate',
      type: 'certificate',
      body: 'Prepare certificate for {employee_name}.',
      variables: ['employee_name'],
      updatedAt: new Date('2026-05-21T10:00:00Z'),
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue(apiTemplates),
      fetchHrRequests: vi.fn().mockResolvedValue(apiRequests),
      fetchHrEmployees: vi.fn().mockResolvedValue([]),
      decideHrRequest: vi.fn(),
      createHrTemplate: vi.fn().mockResolvedValue(newTemplate),
      updateHrTemplate: vi.fn(),
    };

    render(<HrPage apiClient={apiClient as any} />);

    fireEvent.click(screen.getAllByRole('tab')[3]);
    expect(await screen.findByLabelText('Предпросмотр шаблона')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Новый шаблон' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Добавить шаблон' }));

    expect(await screen.findByRole('heading', { name: 'Новый шаблон' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'New certificate' } });
    fireEvent.change(screen.getByLabelText('Текст шаблона'), { target: { value: 'Prepare certificate for {employee_name}.' } });
    const createForm = screen.getByRole('heading', { name: 'Новый шаблон' }).closest('form') as HTMLFormElement;
    fireEvent.click(within(createForm).getByRole('button', { name: 'Создать шаблон' }));

    await waitFor(() => expect(apiClient.createHrTemplate).toHaveBeenCalledTimes(1));
    expect(apiClient.updateHrTemplate).not.toHaveBeenCalled();
  });
});
