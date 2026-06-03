import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EmployeeRequestsPage from './EmployeeRequestsPage';
import type { AuthSession, HrRequest, HrTemplate } from '../types';
import { signWithNcalayer } from '../services/ncalayer';

vi.mock('../services/ncalayer', () => ({
  signWithNcalayer: vi.fn(),
}));

const employeeOrganization = 'ТОО Азия-Сервис';

const signature = {
  signature: 'MIICMS',
  signedPayload: '{"action":"submit"}',
  signedAt: '2026-05-26T10:00:00.000Z',
  certificateSubject: 'CN=Employee User',
  certificateSerial: '123456',
  certificatePem: null,
};

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
  values: { start_date: '01.06.2026', end_date: '10.06.2026', organization: employeeOrganization },
  renderedText: 'Please approve Employee User from 01.06.2026.',
  summary: 'Annual leave',
  period: 'с 01.06.2026 по 10.06.2026',
  submittedAt: new Date('2026-05-19T10:10:00Z'),
  updatedAt: new Date('2026-05-19T10:10:00Z'),
  decidedAt: null,
  decidedBy: null,
  decidedByName: null,
  decisionComment: '',
  employeeSignature: signature,
  hrSignature: null,
  events: [],
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
    organization: employeeOrganization,
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
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps template and statement panels while employee request data is loading', () => {
    const apiClient = {
      fetchHrTemplates: vi.fn(() => new Promise<HrTemplate[]>(() => {})),
      fetchHrRequests: vi.fn(() => new Promise<HrRequest[]>(() => {})),
      createHrRequest: vi.fn(),
    };

    const { container } = render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    expect(container.querySelector('.hr-template-list')).toBeInTheDocument();
    expect(container.querySelector('.hr-template-preview')).toBeInTheDocument();
    expect(container.querySelector('.hr-request-list')).toBeInTheDocument();
    expect(screen.getAllByTestId('employee-template-item-skeleton')).toHaveLength(4);
    expect(screen.getByTestId('employee-statement-preview-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('employee-request-row-skeleton')).toHaveLength(3);
    expect(container.querySelector('.data-loading-state--form')).not.toBeInTheDocument();
    expect(container.querySelector('.data-loading-state--list')).not.toBeInTheDocument();
  });

  it('submits an HR request with the organization from the employee profile', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([template]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn().mockResolvedValue(submittedRequest),
    };

    const { container } = render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    expect((await screen.findAllByText('Vacation request')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(employeeOrganization)).toBeInTheDocument();

    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-06-01' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-06-10' } });
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Annual leave' } });
    vi.mocked(signWithNcalayer).mockResolvedValue(signature);
    fireEvent.click(screen.getByRole('button', { name: 'Подписать ЭЦП' }));
    await screen.findByText('ЭЦП подписано');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявление' }));

    await waitFor(() => {
      expect(apiClient.createHrRequest).toHaveBeenCalledWith(expect.objectContaining({
        templateId: 7,
        values: expect.objectContaining({ organization: employeeOrganization }),
        summary: 'Annual leave',
        employeeSignature: signature,
      }));
    });
    const sentRequests = screen.getByLabelText('Мои отправленные заявления');
    expect(await screen.findByText('19.05.2026')).toBeInTheDocument();
    expect(sentRequests).toHaveTextContent('Отпуск');
    expect(sentRequests).toHaveTextContent('Новое');
  });

  it('uses the selected HR template body for preview and submitted statement', async () => {
    const customTemplate: HrTemplate = {
      ...template,
      body: 'Кадровику: оформить отпуск для {employee_name} с {start_date} по {end_date}. Причина: {reason}.',
      variables: ['start_date', 'end_date', 'reason'],
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([customTemplate]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn().mockResolvedValue({
        ...submittedRequest,
        renderedText: 'Кадровику: оформить отпуск для Employee User с 01.06.2026 по 10.06.2026. Причина: Annual leave.',
      }),
    };

    const { container } = render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    await screen.findByText('Vacation request');
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-06-01' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-06-10' } });
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Annual leave' } });

    const expectedStatement = 'Кадровику: оформить отпуск для Employee User с 01.06.2026 по 10.06.2026. Причина: Annual leave.';
    expect(screen.getByText(expectedStatement)).toBeInTheDocument();

    vi.mocked(signWithNcalayer).mockResolvedValue(signature);
    fireEvent.click(screen.getByRole('button', { name: 'Подписать ЭЦП' }));
    await screen.findByText('ЭЦП подписано');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявление' }));

    await waitFor(() => {
      expect(apiClient.createHrRequest).toHaveBeenCalledWith(expect.objectContaining({
        values: expect.objectContaining({ statement: expectedStatement }),
        employeeSignature: signature,
      }));
    });
  });

  it('allows submitting an advance request without dates and keeps the reason text readable', async () => {
    const advanceTemplate: HrTemplate = {
      ...template,
      title: 'Заявление на аванс',
      type: 'advance',
      body: 'Прошу выдать аванс сотруднику {employee_name} в размере {amount}. Причина: {reason}.',
      variables: ['amount', 'reason'],
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([advanceTemplate]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn().mockResolvedValue({
        ...submittedRequest,
        type: 'advance',
        templateTitle: 'Заявление на аванс',
        period: '',
        renderedText: 'Прошу выдать аванс сотруднику Employee User. Причина: Срочно.',
      }),
    };

    const { container } = render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    await screen.findByText('Заявление на аванс');
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Срочно' } });

    const expectedStatement = 'Прошу выдать аванс сотруднику Employee User. Причина: Срочно.';
    expect(screen.getByText(expectedStatement)).toBeInTheDocument();

    vi.mocked(signWithNcalayer).mockResolvedValue(signature);
    fireEvent.click(screen.getByRole('button', { name: 'Подписать ЭЦП' }));
    await screen.findByText('ЭЦП подписано');
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявление' }));

    await waitFor(() => {
      expect(apiClient.createHrRequest).toHaveBeenCalledWith(expect.objectContaining({
        templateId: 7,
        period: '',
        values: expect.objectContaining({ statement: expectedStatement }),
        summary: 'Срочно',
        employeeSignature: signature,
      }));
    });
  });

  it('fills the selected template into the A4 preview before dates are entered', async () => {
    const customTemplate: HrTemplate = {
      ...template,
      body: 'Кадровику: оформить отпуск для {employee_name} с {start_date} по {end_date}. Причина: {reason}.',
      variables: ['employee_name', 'start_date', 'end_date', 'reason'],
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([customTemplate]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn(),
    };

    const { container } = render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    const preview = await screen.findByLabelText('Предпросмотр заявления');
    expect(preview).toHaveTextContent('Кадровику: оформить отпуск для Employee User с дд.мм.гггг по дд.мм.гггг. Причина: укажите причину.');
    const editor = container.querySelector('.hr-employee-request-editor');
    const documentColumn = editor?.querySelector('.hr-employee-request-document-column');
    const documentBody = preview.querySelector('.hr-document-preview__body');
    expect(documentColumn?.firstElementChild).toHaveAttribute('aria-label', 'Предпросмотр заявления');
    expect(documentBody).toContainElement(preview.querySelector('h3'));
    expect(documentBody).toContainElement(preview.querySelector('p'));
    expect(editor?.querySelector('.hr-employee-request-bottom .hr-employee-request-reason')).toBeInTheDocument();
    expect(editor?.querySelector('.hr-employee-request-bottom .hr-template-preview__actions')).toBeInTheDocument();
    expect(editor?.querySelector('.hr-employee-request-fields')).toBeInTheDocument();
    expect(editor?.querySelector('.hr-employee-request-date-stack')).toBeInTheDocument();
  });

  it('shows a clear empty state when HR has not created active templates yet', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn(),
    };

    render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    expect(await screen.findByText('Кадровик еще не создал активные шаблоны заявлений.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отправить заявление' })).not.toBeInTheDocument();
    expect(apiClient.createHrRequest).not.toHaveBeenCalled();
  });

  it('blocks submission when the end date is earlier than the start date', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([template]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn(),
    };

    const { container } = render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    await screen.findByText('Vacation request');
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-06-10' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-06-01' } });
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Annual leave' } });

    expect(screen.getByText('Дата окончания не может быть раньше даты начала.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить заявление' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявление' }));

    expect(apiClient.createHrRequest).not.toHaveBeenCalled();
  });

  it('shows a clear empty state before the employee submits any requests', async () => {
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([template]),
      fetchHrRequests: vi.fn().mockResolvedValue([]),
      createHrRequest: vi.fn(),
    };

    render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    expect(await screen.findByText('Вы еще не отправляли заявления.')).toBeInTheDocument();
  });

  it('shows only the request type, status, and submitted date for an employee', async () => {
    const decidedRequest: HrRequest = {
      ...submittedRequest,
      id: 41,
      status: 'approved',
      renderedText: 'Прошу предоставить отпуск с 01.06.2026 по 10.06.2026.',
      decisionComment: 'Согласовано кадровиком.',
      decidedAt: new Date('2026-05-20T09:00:00Z'),
      decidedBy: 10,
      decidedByName: 'HR Manager',
    };
    const apiClient = {
      fetchHrTemplates: vi.fn().mockResolvedValue([template]),
      fetchHrRequests: vi.fn().mockResolvedValue([decidedRequest]),
      createHrRequest: vi.fn(),
      downloadHrRequestDocument: vi.fn(),
    };

    render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

    const sentRequests = screen.getByLabelText('Мои отправленные заявления');
    await waitFor(() => expect(sentRequests).toHaveTextContent('Отпуск'));
    expect(sentRequests).toHaveTextContent('Одобрено');
    expect(sentRequests).toHaveTextContent('19.05.2026');
    expect(screen.queryByText('Прошу предоставить отпуск с 01.06.2026 по 10.06.2026.')).not.toBeInTheDocument();
    expect(screen.queryByText('Согласовано кадровиком.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Word' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
    expect(apiClient.downloadHrRequestDocument).not.toHaveBeenCalled();
  });
});
