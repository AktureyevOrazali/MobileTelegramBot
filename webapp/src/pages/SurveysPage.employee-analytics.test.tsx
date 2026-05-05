import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/ApiClient';
import type { SurveyAnalytics } from '../types';
import SurveysPage from './SurveysPage';

vi.mock('../components/EChartsWrapper', () => ({
  default: ({ option, className }: { option: unknown; className?: string }) => (
    <div data-testid={className ?? 'chart'}>{JSON.stringify(option)}</div>
  ),
}));

const emptySurveyAnalytics: SurveyAnalytics = {
  averageScore: null,
  completedSurveyCount: 0,
  answerCount: 0,
  scoreCount: 0,
  positiveCount: 0,
  neutralCount: 0,
  negativeCount: 0,
  neutralShare: 0,
  positiveShare: 0,
  negativeShare: 0,
  monthlySatisfaction: [],
  topClientRequests: [],
  topTrainingWishes: [],
  employeeRemarks: [],
  questionAnalytics: [],
  answers: [],
  answersPreviewLimited: false,
  updatedAt: new Date('2026-04-15T00:00:00Z'),
};

const employeeSurveyAnalytics: SurveyAnalytics = {
  averageScore: 4.5,
  completedSurveyCount: 2,
  answerCount: 4,
  scoreCount: 2,
  positiveCount: 2,
  neutralCount: 0,
  negativeCount: 0,
  positiveShare: 1,
  neutralShare: 0,
  negativeShare: 0,
  monthlySatisfaction: [
    { month: '2026-04', averageScore: 4.5, count: 2 },
  ],
  topClientRequests: [],
  topTrainingWishes: [],
  employeeRemarks: [],
  questionAnalytics: [
    {
      questionId: 201,
      questionText: 'Employee survey question',
      questionType: 'scale',
      topic: 'employee_quality',
      sortOrder: 1,
      answerCount: 2,
      averageScore: 4.5,
      scoreDistribution: [
        { label: '5', count: 1 },
        { label: '4', count: 1 },
      ],
      topAnswers: [],
    },
    {
      questionId: 209,
      questionText: 'Employee ninth question',
      questionType: 'text_comment',
      topic: 'extra',
      sortOrder: 9,
      answerCount: 2,
      averageScore: null,
      scoreDistribution: [],
      topAnswers: [
        { label: 'Need clearer scripts', count: 2 },
      ],
    },
  ],
  answers: [],
  answersPreviewLimited: false,
  updatedAt: new Date('2026-04-15T00:00:00Z'),
};

function renderEmployeeAnalyticsPage() {
  const apiClient = {
    fetchSurveyTemplates: vi.fn().mockResolvedValue([]),
    fetchSurveyAnalytics: vi.fn().mockImplementation((options?: { audience?: string | null }) => (
      options?.audience === 'employee'
        ? Promise.resolve(employeeSurveyAnalytics)
        : Promise.resolve(emptySurveyAnalytics)
    )),
  } as unknown as ApiClient;

  const result = render(
    <MemoryRouter initialEntries={['/surveys/employees']}>
      <SurveysPage apiClient={apiClient} />
    </MemoryRouter>,
  );

  return { apiClient, ...result };
}

describe('SurveysPage employee analytics', () => {
  it('renders employee survey-builder question analytics for every configured question', async () => {
    const { container, apiClient } = renderEmployeeAnalyticsPage();

    expect(await screen.findByText('Аналитика опроса сотрудников')).toBeInTheDocument();
    expect(screen.getByText('Средняя оценка сотрудников')).toBeInTheDocument();
    expect(screen.getByText('Employee survey question')).toBeInTheDocument();
    expect(screen.getByText('Employee ninth question')).toBeInTheDocument();
    expect(screen.getByText('Need clearer scripts')).toBeInTheDocument();
    expect(screen.queryByText('Внутренняя оценка взаимодействия с клиентами')).not.toBeInTheDocument();
    expect(container.querySelector('.surveys-assessment-card--quality')).toBeInTheDocument();
    expect(container.querySelector('.surveys-hero .surveys-assessment-filter')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(apiClient.fetchSurveyAnalytics).toHaveBeenCalledWith(expect.objectContaining({ audience: 'employee' }));
    });
  });
});
