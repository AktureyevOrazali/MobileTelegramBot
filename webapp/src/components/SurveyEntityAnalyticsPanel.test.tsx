import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SurveyEntityAnalyticsPanel from './SurveyEntityAnalyticsPanel';
import type { SurveyAnalytics } from '../types';

const analytics: SurveyAnalytics = {
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
  topClientRequests: [],
  topTrainingWishes: [],
  employeeRemarks: [],
  questionAnalytics: [
    {
      questionId: 1,
      questionText: 'Оцените консультацию',
      questionType: 'scale',
      topic: 'csat',
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
      questionId: 2,
      questionText: 'Что улучшить?',
      questionType: 'text_comment',
      topic: 'comment',
      sortOrder: 2,
      answerCount: 1,
      averageScore: null,
      scoreDistribution: [],
      topAnswers: [{ label: 'Быстрее отвечать', count: 1 }],
    },
  ],
  monthlySatisfaction: [],
  answers: [
    {
      id: 11,
      sessionId: 7,
      templateId: 3,
      templateTitle: 'Опрос клиента',
      questionId: 1,
      questionText: 'Оцените консультацию',
      questionType: 'scale',
      topic: 'csat',
      numericScore: 5,
      rawText: '',
      selectedOptions: [],
      selectedEmployeeName: null,
      createdAt: new Date('2026-05-05T09:30:00Z'),
      chatId: 100,
      dialogId: 200,
      appealId: null,
      bin: '123456789012',
      organization: 'ТОО Альфа',
      chatTitle: 'Чат с клиентом',
      operators: ['Иван Иванов'],
      isAnonymous: false,
      section: 'support',
    },
  ],
  answersPreviewLimited: false,
  updatedAt: new Date('2026-05-05T10:00:00Z'),
};

describe('SurveyEntityAnalyticsPanel', () => {
  it('loads employee survey analytics by operator name and shows question-level answers', async () => {
    const apiClient = {
      fetchSurveyAnalytics: vi.fn().mockResolvedValue(analytics),
    };

    render(
      <SurveyEntityAnalyticsPanel
        apiClient={apiClient as never}
        open
        target={{ kind: 'employee', label: 'Иван Иванов', operatorName: 'Иван Иванов' }}
      />,
    );

    await waitFor(() => {
      expect(apiClient.fetchSurveyAnalytics).toHaveBeenCalledWith({
        audience: 'client',
        operatorName: 'Иван Иванов',
      });
    });

    expect((await screen.findAllByText('Оцените консультацию')).length).toBeGreaterThan(0);
    expect(screen.getByText('Что улучшить?')).toBeInTheDocument();
    expect(screen.getByText('Быстрее отвечать')).toBeInTheDocument();
    expect(screen.getByText('ТОО Альфа')).toBeInTheDocument();
  });

  it('loads BIN survey analytics by bin and keeps the same question view', async () => {
    const apiClient = {
      fetchSurveyAnalytics: vi.fn().mockResolvedValue(analytics),
    };

    render(
      <SurveyEntityAnalyticsPanel
        apiClient={apiClient as never}
        open
        target={{ kind: 'bin', label: '123456789012', bin: '123456789012' }}
      />,
    );

    await waitFor(() => {
      expect(apiClient.fetchSurveyAnalytics).toHaveBeenCalledWith({
        audience: 'client',
        bin: '123456789012',
      });
    });

    expect((await screen.findAllByText('Оцените консультацию')).length).toBeGreaterThan(0);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('ТОО Альфа')).toBeInTheDocument();
  });
});
