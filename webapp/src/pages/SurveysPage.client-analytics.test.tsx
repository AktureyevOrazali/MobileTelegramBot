import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/ApiClient';
import type { SurveyAnalytics, SurveyTemplate } from '../types';
import SurveysPage from './SurveysPage';

vi.mock('../components/EChartsWrapper', () => ({
  default: ({ option, className }: { option: unknown; className?: string }) => (
    <div data-testid={className ?? 'chart'}>{JSON.stringify(option)}</div>
  ),
}));

const clientAnalytics: SurveyAnalytics = {
  averageScore: 3.25,
  completedSurveyCount: 2,
  answerCount: 3,
  scoreCount: 2,
  positiveCount: 1,
  neutralCount: 0,
  negativeCount: 1,
  positiveShare: 0.5,
  neutralShare: 0,
  negativeShare: 0.5,
  monthlySatisfaction: [
    { month: '2026-02', averageScore: 3.1, count: 1 },
    { month: '2026-03', averageScore: 3.4, count: 2 },
    { month: '2026-04', averageScore: 3.25, count: 1 },
  ],
  topClientRequests: [
    { label: 'Integration help', count: 3 },
    { label: 'Support speed', count: 2 },
  ],
  topTrainingWishes: [
    { label: 'Webinars', count: 2 },
  ],
  employeeRemarks: [
    { label: 'More proactive updates', count: 1 },
  ],
  questionAnalytics: [
    {
      questionId: 101,
      questionText: 'Client response speed',
      questionType: 'scale',
      topic: 'response_speed',
      sortOrder: 1,
      answerCount: 2,
      averageScore: 3.5,
      scoreDistribution: [
        { label: '5', count: 1 },
        { label: '2', count: 1 },
      ],
      topAnswers: [],
    },
    {
      questionId: 102,
      questionText: 'Training format',
      questionType: 'single_choice',
      topic: 'webinars',
      sortOrder: 2,
      answerCount: 1,
      averageScore: null,
      scoreDistribution: [],
      topAnswers: [
        { label: 'Webinars', count: 1 },
      ],
    },
    {
      questionId: 103,
      questionText: 'Requests from clients',
      questionType: 'text_comment',
      topic: 'support_improvements',
      sortOrder: 8,
      answerCount: 3,
      averageScore: null,
      scoreDistribution: [],
      topAnswers: [
        { label: 'Integration help', count: 3 },
        { label: 'Support speed', count: 2 },
      ],
    },
    {
      questionId: 109,
      questionText: 'Ninth question',
      questionType: 'single_choice',
      topic: 'extra',
      sortOrder: 9,
      answerCount: 1,
      averageScore: null,
      scoreDistribution: [],
      topAnswers: [
        { label: 'Yes', count: 1 },
      ],
    },
  ],
  answers: [
    {
      id: 1,
      sessionId: 10,
      templateId: 1,
      templateTitle: 'Client survey',
      questionId: 101,
      questionText: 'Client response speed',
      questionType: 'scale',
      topic: 'response_speed',
      numericScore: 5,
      rawText: '',
      selectedOptions: [],
      selectedEmployeeName: null,
      createdAt: new Date('2026-04-15T00:00:00Z'),
      chatId: 1,
      dialogId: 2,
      appealId: 3,
      bin: '131313131313',
      organization: 'ACME',
      chatTitle: 'ACME chat',
      operators: ['Operator One'],
      isAnonymous: false,
      section: 'Support',
    },
    {
      id: 2,
      sessionId: 11,
      templateId: 1,
      templateTitle: 'Client survey',
      questionId: 101,
      questionText: 'Client response speed',
      questionType: 'scale',
      topic: 'response_speed',
      numericScore: 2,
      rawText: '',
      selectedOptions: [],
      selectedEmployeeName: null,
      createdAt: new Date('2026-04-16T00:00:00Z'),
      chatId: 1,
      dialogId: 2,
      appealId: 3,
      bin: '151515151515',
      organization: 'Beta',
      chatTitle: 'Beta chat',
      operators: ['Operator Two'],
      isAnonymous: false,
      section: 'Support',
    },
    {
      id: 3,
      sessionId: 11,
      templateId: 1,
      templateTitle: 'Client survey',
      questionId: 102,
      questionText: 'Training format',
      questionType: 'single_choice',
      topic: 'webinars',
      numericScore: null,
      rawText: '',
      selectedOptions: ['Webinars'],
      selectedEmployeeName: null,
      createdAt: new Date('2026-04-17T00:00:00Z'),
      chatId: 1,
      dialogId: 2,
      appealId: 3,
      bin: '151515151515',
      organization: 'Beta',
      chatTitle: 'Beta chat',
      operators: ['Operator Two'],
      isAnonymous: false,
      section: 'Training',
    },
  ],
  answersPreviewLimited: false,
  updatedAt: new Date('2026-04-18T00:00:00Z'),
};

const currentClientTemplate: SurveyTemplate = {
  id: 77,
  title: 'Current client survey',
  description: '',
  audience: 'client',
  status: 'active',
  triggerType: 'after_appeal_closed',
  periodicInterval: null,
  scheduledAt: null,
  launchRules: [{ type: 'after_appeal_closed', dates: [] }],
  isAnonymous: false,
  createdBy: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-18T00:00:00Z'),
  questions: [],
};

function renderClientAnalyticsPage() {
  const apiClient = {
    fetchSurveyTemplates: vi.fn().mockResolvedValue([currentClientTemplate]),
    fetchSurveyAnalytics: vi.fn().mockResolvedValue(clientAnalytics),
  } as unknown as ApiClient;

  const result = render(
    <MemoryRouter initialEntries={['/surveys/clients']}>
      <SurveysPage apiClient={apiClient} />
    </MemoryRouter>,
  );

  return { apiClient, ...result };
}

describe('SurveysPage client analytics', () => {
  it('renders client analytics across all client survey templates like the executive summary', async () => {
    const user = userEvent.setup();
    const { container, apiClient } = renderClientAnalyticsPage();

    await waitFor(() => {
      expect(container.querySelector('.surveys-assessment')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(apiClient.fetchSurveyAnalytics).toHaveBeenCalledWith(expect.objectContaining({
        audience: 'client',
      }));
    });
    expect(apiClient.fetchSurveyAnalytics).not.toHaveBeenCalledWith(expect.objectContaining({
      templateId: currentClientTemplate.id,
    }));

    expect(container.querySelector('.surveys-client-overview')).not.toBeInTheDocument();
    expect(container.querySelector('.surveys-score-card')).not.toBeInTheDocument();
    expect(container.querySelector('.surveys-assessment-card--quality')).toBeInTheDocument();
    expect(screen.getByText('Отвеченные опросы')).toBeInTheDocument();
    expect(screen.getByText('Client response speed')).toBeInTheDocument();
    expect(screen.getByText('Training format')).toBeInTheDocument();
    expect(screen.getByText('Ninth question')).toBeInTheDocument();
    expect(screen.getByText('Integration help')).toBeInTheDocument();

    const betaSurvey = screen.getByRole('button', { name: /Beta.*2 вопрос/ });
    await user.click(betaSurvey);
    expect(screen.getAllByText('Client response speed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Training format').length).toBeGreaterThanOrEqual(1);

    const donutOption = JSON.parse(screen.getByTestId('surveys-assessment-donut-chart').textContent ?? '{}');
    expect(donutOption.series[0]).toMatchObject({
      radius: ['75%', '88%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 5,
        borderWidth: 2,
      },
    });
    expect(donutOption.series[0].data.map((item: { value: number }) => item.value)).toEqual([1, 0, 1]);
  });
});
