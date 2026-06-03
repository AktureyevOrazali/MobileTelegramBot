import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HrRequest } from '../../types';
import HrRequestsTab from './HrRequestsTab';

const request: HrRequest = {
  id: 1,
  templateId: 10,
  templateTitle: 'Заявление на аванс',
  type: 'advance',
  employeeId: 20,
  employeeName: 'Алия Садыкова',
  department: 'Финансы',
  status: 'new',
  values: {
    organization: 'ТОО Ромашка',
    position: 'Финансовый аналитик',
  },
  renderedText: '',
  summary: '120 000 ₸ за май',
  period: 'Май 2026',
  submittedAt: new Date('2026-05-20T05:06:00Z'),
  updatedAt: new Date('2026-05-20T05:06:00Z'),
  decidedAt: null,
  decidedBy: null,
  decidedByName: null,
  decisionComment: '',
  employeeSignature: null,
  hrSignature: null,
  events: [],
};

describe('HrRequestsTab', () => {
  it('renders loading placeholders inside the request list and document panels', () => {
    const { container } = render(<HrRequestsTab requests={[]} isLoading />);

    expect(container.querySelector('.hr-requests-grid')).toBeInTheDocument();
    expect(container.querySelector('.hr-request-list')).toBeInTheDocument();
    expect(container.querySelector('.hr-detail-card')).toBeInTheDocument();
    expect(screen.getAllByTestId('hr-request-row-skeleton')).toHaveLength(7);
    expect(screen.getByTestId('hr-document-preview-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(request.employeeName)).not.toBeInTheDocument();
  });

  it('renders request type in the list and employee-addressed document details', () => {
    const { container } = render(<HrRequestsTab requests={[request]} />);

    const requestRow = screen.getByRole('button', { name: /Алия Садыкова/ });
    expect(within(requestRow).getByText('Аванс')).toBeInTheDocument();
    expect(within(requestRow).queryByText('Заявление')).not.toBeInTheDocument();

    const detailHeader = container.querySelector('.hr-detail-card__header');
    expect(detailHeader).not.toBeNull();
    expect(within(detailHeader as HTMLElement).getByText('Алия Садыкова')).toBeInTheDocument();
    expect(within(detailHeader as HTMLElement).queryByText('Заявление')).not.toBeInTheDocument();

    const documentPreview = screen.getByLabelText('Форма заявления');
    expect(within(documentPreview).getByText('Директору организации "ТОО Ромашка"')).toBeInTheDocument();
    expect(within(documentPreview).getByText('от Финансовый аналитик Алия Садыкова')).toBeInTheDocument();
    expect(container.querySelector('.hr-meta-list')).not.toBeInTheDocument();
  });
});
