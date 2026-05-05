import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/ApiClient';
import type { EmployeeClientAssessmentAnalytics, SurveyAnalytics } from '../types';
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

const employeeAssessmentAnalytics: EmployeeClientAssessmentAnalytics = {
  totalAssessments: 3,
  averageOverallScore: 2.3333333333,
  averageInteractionQualityIndex: 46,
  averageFeedbackDelayHours: 0,
  highScoreShare: 0,
  lowScoreShare: 2 / 3,
  repeatedRequestShare: 1 / 3,
  firstContactShare: 1 / 3,
  hinderedCount: 1,
  withoutClarificationsCount: 2,
  firstTimeFullDataShare: 2 / 3,
  lowScoreReasons: [
    { label: 'Needs clarification', count: 2 },
  ],
  interactionStatuses: [
    { label: 'Full data provided', count: 2 },
  ],
  interactionFlags: [
    { label: 'Constructive interaction', count: 2 },
  ],
  requestRepeatStatuses: [
    { label: 'First contact', count: 1 },
    { label: 'Repeated request', count: 2 },
  ],
  monthlyScores: [
    { month: '2026-04', averageOverallScore: 2.33, averageInteractionQualityIndex: 46, count: 3 },
  ],
  clientRatings: [
    {
      clientName: 'Client Alpha',
      clientBin: '131313131313',
      taskCount: 3,
      averageOverallScore: 2.33,
      averageInteractionQualityIndex: 46,
      highScoreShare: 0,
      lowScoreShare: 2 / 3,
      repeatedRequestShare: 1 / 3,
      firstContactShare: 1 / 3,
      averageFeedbackDelayHours: 0,
      hinderedCount: 1,
      withoutClarificationsCount: 2,
      firstTimeFullDataShare: 2 / 3,
      internalRating: 46,
    },
  ],
  recentAssessments: [
    {
      id: 1,
      clientName: 'Client Alpha',
      clientBin: '131313131313',
      assignedUserName: 'Operator One',
      overallScore: 2.33,
      interactionQualityIndex: 46,
      lowScoreReason: 'Needs clarification',
      submittedAt: new Date('2026-04-15T00:00:00Z'),
      repeatedRequest: true,
      requestRepeatStatus: 'repeated_same_issue',
      clientDataOverdue: false,
      aiAssisted: false,
    },
  ],
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
    fetchEmployeeClientAssessmentAnalytics: vi.fn().mockResolvedValue(employeeAssessmentAnalytics),
  } as unknown as ApiClient;

  const result = render(
    <MemoryRouter initialEntries={['/surveys/employees']}>
      <SurveysPage apiClient={apiClient} />
    </MemoryRouter>,
  );

  return { apiClient, ...result };
}

describe('SurveysPage employee analytics', () => {
  it('renders employee assessment analytics and survey-builder question analytics together', async () => {
    const { container, apiClient } = renderEmployeeAnalyticsPage();

    expect((await screen.findAllByText('Client Alpha')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Employee survey question')).toBeInTheDocument();
    expect(screen.getByText('Employee ninth question')).toBeInTheDocument();
    expect(screen.getByText('Need clearer scripts')).toBeInTheDocument();
    expect(container.querySelector('.surveys-assessment-card--quality')).toBeInTheDocument();
    expect(container.querySelector('.surveys-hero .surveys-assessment-filter')).toBeInTheDocument();

    await waitFor(() => {
      expect(apiClient.fetchSurveyAnalytics).toHaveBeenCalledWith(expect.objectContaining({ audience: 'employee' }));
      expect(apiClient.fetchEmployeeClientAssessmentAnalytics).toHaveBeenCalled();
    });
  });
});
